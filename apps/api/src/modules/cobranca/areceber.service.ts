import { Injectable } from '@nestjs/common';
import { gravarLog, gravarLogDaLinha, type CampoLog } from '../../shared/log/registro-log';
import { ErroPlanoParcelas, duplicataAreceber, planejarParcelasAreceber, type ParcelaAreceberPlanejada, type RegerarParcelasAreceberDto } from '@apollo/shared';
import { novoGrupo } from './apagar-caixa';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { todasAsEmpresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { assertPeriodoNaoFechado } from '../shared/periodo-contabil';
import { assertRestricoesSituacao } from '../shared/situacao-restricoes';
import { lancarCaixaDoAreceber } from './areceber-caixa';
import { configNaTrx } from '../compras/pedido-heranca';
import { DocumentosContabilService } from './documentos-contabil.service';
import { emSavepoint } from './fechamento-contabil.service';
import { SenhaOperacaoService } from '../cadastro/senha-operacao.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** soma `days` dias a uma data ISO 'YYYY-MM-DD' (aritmética em UTC → sem drift de fuso). */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** soma `months` meses a uma data ISO, fixando o dia-do-mês (`fixedDay` ?? dia de `iso`) e clampando ao
 *  último dia do mês-alvo (fiel ao IncMonth do Delphi: 31/jan +1 mês → 28/29 fev). */
function addMonthsClamped(iso: string, months: number, fixedDay?: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dia = fixedDay ?? d;
  const idx = (m - 1) + months;
  const ty = y + Math.floor(idx / 12);
  const tm = ((idx % 12) + 12) % 12; // 0..11
  const ultimoDia = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const diaClamp = Math.min(dia, ultimoDia);
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(diaClamp).padStart(2, '0')}`;
}

/**
 * CONTAS A RECEBER — corte-1 (cadastro/gestão do título). Módulo VERTICAL (não o engine
 * declarativo) porque ARECEBER usa CODEMPRESA (≠ IDEMPRESA que o engine assume) e tem travas
 * de estado próprias — mesma decisão do Lote de Cobrança. Molde de tenant/transação/erro dos
 * serviços da NF (`nf-faturamento.service.ts`): forTenant + BusinessRuleError→422 + fail-closed.
 *
 * Escopo: list/read (via view get_areceber, juros/total já calculados), create (título manual),
 * update/delete com TRAVAS de estado (uCadAReceber VerificaBloqueio/VerificaContabilizado):
 * QUITADA='S' / AGRUPADO='S' / CONTABILIZADO='S' / vindo de NF (IDNF) bloqueiam editar e excluir.
 * A BAIXA é o corte-2.
 */
@Injectable()
export class AreceberService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly docs: DocumentosContabilService,
    private readonly senhaOp: SenhaOperacaoService,
  ) {}

  private async cfg(trx: AnyDB, codigo: string, emp: number): Promise<string | null> {
    return configNaTrx(trx, codigo, { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' });
  }

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN'); // fail-closed (título é por empresa)
    return e;
  }

  /** whitelist de colunas filtráveis/ordenáveis da Pesquisa (anti-injection). */
  private static readonly PESQUISA = new Set([
    'codrcb', 'duplicata', 'razao', 'dtvenc', 'dtvenda', 'valor', 'quitada', 'tipodoc',
  ]);

  /** Listagem: view get_areceber, sempre no escopo da empresa + filtro campo/operador/valor + situação. */
  async list(query: Record<string, string | undefined>): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    // os títulos marcados na Pesquisa do AGRUPAMENTO (paraAgrupar + codigos): de qualquer loja do operador — a Pesquisa do legado não
    // filtra loja e o agrupamento atravessa as lojas; fora isso, a loja do login
    const codigos = query.paraAgrupar === 'S' ? (query.codigos ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 2000) : [];
    const db0 = this.dbp.forTenantRead() as AnyDB;
    let q = codigos.length
      ? db0.selectFrom('get_areceber').selectAll().where('codempresa', 'in', await todasAsEmpresasDoOperador(db0)).where('codrcb', 'in', codigos)
      : db0.selectFrom('get_areceber').selectAll().where('codempresa', '=', emp);

    // situação (F3 do legado): abertos (não quitado e não agrupado) / liquidados / agrupados / todos.
    switch (query.situacao) {
      case 'liquidados':
        q = q.where('quitada', '=', 'S');
        break;
      case 'agrupados':
        q = q.where('agrupado', '=', 'S');
        break;
      case 'abertos':
        q = q.where(sql`coalesce(quitada,'N')`, '=', 'N').where(sql`coalesce(agrupado,'N')`, '=', 'N');
        break;
      // 'todos' / ausente → sem filtro de estado
    }
    // a busca da tela de agrupar (`uAgrupaContasAReceber`, GET_RCB): aberto e não agrupado — e, com o fechamento de caixa da
    // empresa, só o conciliado na tesouraria; mais o cliente e os períodos de venda/vencimento
    if (query.paraAgrupar === 'S') {
      q = q.where(sql`coalesce(quitada,'N')`, '=', 'N').where(sql`coalesce(agrupado,'N')`, '=', 'N');
      const fc = (await (this.dbp.forTenantRead() as AnyDB).selectFrom('empresas').select('fechamento_caixa').where('idempresa', '=', emp).executeTakeFirst()) as { fechamento_caixa?: string } | undefined;
      if (fc?.fechamento_caixa === 'S') q = q.where('consiliado', '=', 'S');
    }
    if (query.codparceiro && Number(query.codparceiro) > 0) q = q.where('codparceiro', '=', Number(query.codparceiro));
    const dia = /^\d{4}-\d{2}-\d{2}$/;
    if (query.vencDe && dia.test(query.vencDe)) q = q.where(sql`dtvenc::date`, '>=', query.vencDe);
    if (query.vencAte && dia.test(query.vencAte)) q = q.where(sql`dtvenc::date`, '<=', query.vencAte);
    if (query.vendaDe && dia.test(query.vendaDe)) q = q.where(sql`dtvenda::date`, '>=', query.vendaDe);
    if (query.vendaAte && dia.test(query.vendaAte)) q = q.where(sql`dtvenda::date`, '<=', query.vendaAte);

    const campo = query.campo;
    if (campo && AreceberService.PESQUISA.has(campo) && query.valor != null && query.valor !== '') {
      const col = sql.ref(campo);
      const v = query.valor;
      switch (query.operador ?? 'contem') {
        case 'igual': q = q.where(col as any, '=', v); break;
        case 'comeca': q = q.where(sql`upper(${col})`, 'like', `${v.toUpperCase()}%`); break;
        default: q = q.where(sql`upper(${col})`, 'like', `%${v.toUpperCase()}%`); break;
      }
    }
    if (query.orderBy && AreceberService.PESQUISA.has(query.orderBy)) {
      q = q.orderBy(sql.ref(query.orderBy), query.orderDir === 'desc' ? 'desc' : 'asc');
    } else {
      q = q.orderBy('dtvenc', 'asc');
    }
    return q.limit(codigos.length ? codigos.length : Math.min(Number(query.limite) || 200, 500)).execute();
  }

  /** Leitura por código (escopo empresa). */
  async read(id: number): Promise<Record<string, unknown> | undefined> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emp = this.emp();
    const v = (await db.selectFrom('get_areceber').selectAll().where('codrcb', '=', id).where('codempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!v) return v;
    // os campos que a tela trava neste título (VerificaCRCadastradaAutomaticamente)
    const x = (await sql<Record<string, unknown>>`SELECT a.origem, a.idnf, a.nfadicmanual, a.agrupamento, a.total AS total_documento, a.docnf, a.codgrupo, a.nrodup, a.status_pendencia,
        a.nropedido, a.codgrupo_agrupamento_rcb, a.codgrupo_agrupamento_apg, a.adfornecedor, a.codadiantamento, n.nronf,
        (SELECT max(r.codrcb) FROM areceber r WHERE r.codgrupo = a.codgrupo_agrupamento_rcb) AS agrupado_em_rcb,
        (SELECT max(p.codapg) FROM apagar p WHERE p.codgrupo = a.codgrupo_agrupamento_apg) AS agrupado_em_apg
        FROM areceber a LEFT JOIN nf n ON n.codnf = a.idnf WHERE a.codrcb = ${id}`.execute(db)).rows[0] ?? {};
    return { ...v, ...x, campos_bloqueados: await this.camposBloqueados(db, emp, { ...v, ...x }) };
  }

  /** Colunas que o usuário edita (delta) — nunca codrcb/codempresa/estado. */
  private static readonly COLUNAS = [
    'codparceiro', 'dtvenda', 'dtvenc', 'valor', 'txjuros', 'txmulta', 'desconto_boleto',
    'nrodup', 'duplicata', 'tipodoc', 'nroped', 'nrocupom',
    'codvendedor', 'codcobrador', 'idpgto', 'codbco', 'codplc', 'idsituacao_nf', 'obs',
    // a auditoria do uCadAReceber.dfm (14/10/2026): a "Nota fiscal (nº)" do título (o "Valor total" é do documento: `inserirParcelas`)
    'docnf', 'idnf',
  ];
  private delta(dto: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const c of AreceberService.COLUNAS) if (dto[c] !== undefined) out[c] = dto[c];
    // o Nº do pedido da tela é o NROPEDIDO do legado (12.656 títulos em 2026) — é ele que a contabilização lê para achar a venda
    if (out.nroped !== undefined) out.nropedido = out.nroped;
    return out;
  }

  /** Cria um título MANUAL (cadastrado_manualmente='S', gerado='OPERADOR', quitada='N'). */
  /**
   * a LOG "Contas a receber" (o form-base do `frmCadAReceber`, `TLog.GravaLog` com o DataSet): os campos do dataset na ordem do
   * legado (lida na produção, 21/09/2026) — 1.108 Inseriu e 725 Alterou em 2026.
   */
  static readonly CAMPOS_LOG: readonly CampoLog[] = [
    'codrcb', 'dtvenda', 'codoperador', 'codparceiro', 'quitada', 'logado', 'codempresa', 'gerado', 'valor', 'txjuros', 'dtvenc', 'tipodoc', 'nrodup',
    'total', 'codgrupo', 'codoperadorman', 'codbco', 'idpgto', 'consiliado', 'codplc', 'desconto_boleto', 'cadastrado_manualmente', 'usultalteracao',
    'dtultimalteracao', 'dtcadastro', 'idsituacao_nf', 'nfadicmanual', 'total_brt', 'txmulta', 'valor_perc_multa', 'dtagendamento', 'obs', 'duplicata',
    'nrocupom', 'origem', 'chave', 'codpdv',
  ];
  private async logTitulo(trx: AnyDB, acao: 'Inseriu' | 'Alterou', id: number, antes: Record<string, unknown> | undefined) {
    const depois = (await sql<Record<string, unknown>>`SELECT * FROM areceber WHERE codrcb = ${id}`.execute(trx)).rows[0];
    if (!depois) return;
    await gravarLogDaLinha(trx, { acao, formulario: 'Contas a receber', tabela: 'ARECEBER', chave: 'CODRCB', valor: id, idempresa: this.emp(), campos: AreceberService.CAMPOS_LOG, antes, depois });
  }

  async criar(dto: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const id = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const d = this.delta(dto);
      // trava de período contábil fechado (ValidaPeriodoFechado, DTVENDA × BLOQ_RCB).
      await assertPeriodoNaoFechado(trx, emp, d.dtvenda, 'bloq_rcb');
      // o Gravar da tela (:920-960): a forma de pagamento, o cliente (ou fornecedor) e a situação obrigatória pela configuração
      await this.validarCadastro(trx, emp, d, undefined);
      // cliente e centro de custo da situação do documento (uCadAReceber.pas:1728/2009; UCadSituacaoNF.md C5)
      await assertRestricoesSituacao(trx, d, {}, { papel: 'cliente' });
      // txjuros default = snapshot da EMPRESAS.TXJUROPADRAO (uCadAReceber: default do padrão da empresa).
      if (d.txjuros == null) {
        const e = await trx.selectFrom('empresas').select('txjuropadrao').where('idempresa', '=', emp).executeTakeFirst();
        d.txjuros = e?.txjuropadrao ?? null;
      }
      // o banco padrão da configuração no título novo (`SetaBancoPadrao` :4041 — a produção não o define)
      if (d.codbco == null) {
        const b = num(await this.cfg(trx, 'BANCO_PADRAO_CR', emp));
        if (b > 0) d.codbco = b;
      }
      // "Nota fiscal (nº)": a NF da conta pelo número (edtNumeNotaExit :2269) ou pelo código (btnNRONF)
      await this.resolverNf(trx, emp, d, undefined);
      // o DOCUMENTO: a parcela única como digitada (duplicata `NF - 001/001`), ou as N do "&Parcelas" — todas no mesmo grupo
      const n = Math.max(1, Math.trunc(num(d.nrodup) || 1));
      const plano = this.planoDoDocumento({ ...d, total: dto.total }, n, dto.geracao as Record<string, unknown> | undefined);
      const codgrupo = await novoGrupo(trx);
      const ids = await this.inserirParcelas(trx, emp, op, d, plano, codgrupo);
      // uma CAIXA para o DOCUMENTO, com o total das parcelas, no 1º título (GetTotalDoc; uCadAReceber.pas:1075)
      await lancarCaixaDoAreceber(trx, ids[0], emp, 'incluir', n > 1 ? plano.total : undefined);
      for (const codrcb of ids) {
        await this.integrarDocumento(trx, emp, codrcb);
        await this.logTitulo(trx, 'Inseriu', codrcb, undefined);
      }
      return ids;
    });
    return this.read(id[0]);
  }

  // ── a auditoria do uCadAReceber.dfm (14/10/2026): o Gravar, a NF da conta, as parcelas ───────────────────────────
  /**
   * O Gravar da tela (:920-960): "A Forma de pagamento deve ser informada" (771 de 771 títulos manuais de 2026 têm IDPGTO),
   * `VerificarClienteFornecedor` (:1673 — CLI ou FRN) e, com INFORMA_SITUACAO_DOC_CONTAS_RECEBER (N; o módulo Retaguarda = S), a
   * situação F05 do documento — uma só entra sozinha (`InformaSituacaoDocumento` :3076), várias exigem a escolha.
   */
  private async validarCadastro(trx: AnyDB, emp: number, d: Record<string, unknown>, antes: Record<string, unknown> | undefined): Promise<void> {
    // no título novo sempre; no gravado, quando a tela a zera (os títulos antigos sem forma — da carga ou de outros processos — seguem editáveis)
    if (antes == null ? !(num(d.idpgto) > 0) : (d.idpgto !== undefined && !(num(d.idpgto) > 0))) throw new BusinessRuleError('ARECEBER_FORMA_OBRIGATORIA');
    const codparceiro = d.codparceiro !== undefined ? d.codparceiro : antes?.codparceiro;
    if (num(codparceiro) > 0) {
      const p = (await sql<{ cli: string | null; frn: string | null }>`SELECT cli, frn FROM parceiros WHERE codparceiro = ${num(codparceiro)}`.execute(trx)).rows[0];
      if (!p || (p.cli !== 'S' && p.frn !== 'S')) throw new BusinessRuleError('ARECEBER_PARCEIRO_NAO_CLIENTE');
    }
    const situacao = d.idsituacao_nf !== undefined ? d.idsituacao_nf : antes?.idsituacao_nf;
    if (situacao == null && (await this.cfg(trx, 'INFORMA_SITUACAO_DOC_CONTAS_RECEBER', emp)) === 'S') {
      const f05 = (await sql<{ idsituacao_nf: number }>`SELECT idsituacao_nf FROM situacao_nf WHERE tipo_operacao = 'F05' AND coalesce(tipo, 'S') = 'S' ORDER BY idsituacao_nf`.execute(trx)).rows;
      if (f05.length === 1) d.idsituacao_nf = num(f05[0].idsituacao_nf);
      else if (f05.length > 1) throw new BusinessRuleError('ARECEBER_SITUACAO_OBRIGATORIA');
    }
  }

  /**
   * A NF da conta (`edtNumeNotaExit` :2269 / `btnNRONFClick` :1275): pelo número — a NF processada da loja, do cliente informado;
   * uma só preenche IDNF e o cliente (NFADICMANUAL 'S'); várias pedem a escolha ("SELECIONE A NOTA FISCAL CORRETA"); nenhuma,
   * "Nota fiscal não existe. Verifique!". Pelo código (a Pesquisa da GET_NF), o cliente vem da nota. O número vazio limpa a NF.
   */
  private async resolverNf(trx: AnyDB, emp: number, d: Record<string, unknown>, antes: Record<string, unknown> | undefined): Promise<void> {
    if (d.idnf !== undefined && num(d.idnf) > 0) {
      const nf = (await sql<{ codnf: number; nronf: unknown; codparceiro: number | null }>`SELECT codnf, nronf, codparceiro FROM nf WHERE codnf = ${num(d.idnf)} AND idempresa = ${emp}`.execute(trx)).rows[0];
      if (!nf) throw new BusinessRuleError('ARECEBER_NF_NAO_EXISTE');
      d.docnf = nf.nronf == null ? null : String(nf.nronf);
      if (num(nf.codparceiro) > 0) d.codparceiro = num(nf.codparceiro);
      d.nfadicmanual = 'S';
      return;
    }
    if (d.docnf === undefined) return;
    const numero = String(d.docnf ?? '').trim();
    if (!numero) { d.docnf = null; d.idnf = null; return; }
    if (antes && String(antes.docnf ?? '').trim() === numero && num(antes.idnf) > 0) return;
    const codparceiro = d.codparceiro !== undefined ? num(d.codparceiro) : num(antes?.codparceiro);
    const soProcessada = !(num(antes?.idnf) > 0);
    const nfs = await this.nfsPeloNumero(trx, emp, numero, codparceiro > 0 ? codparceiro : null, soProcessada);
    if (!nfs.length) throw new BusinessRuleError('ARECEBER_NF_NAO_EXISTE');
    if (nfs.length > 1) throw new BusinessRuleError('ARECEBER_NF_AMBIGUA', { opcoes: nfs });
    d.idnf = num(nfs[0].codnf);
    d.docnf = String(nfs[0].nronf ?? numero);
    if (num(nfs[0].codparceiro) > 0) d.codparceiro = num(nfs[0].codparceiro);
    d.nfadicmanual = 'S';
  }

  private async nfsPeloNumero(db: AnyDB, emp: number, numero: string, codparceiro: number | null, soProcessada: boolean) {
    return (await sql<{ codnf: number; nronf: unknown; codparceiro: number | null; razao: string | null }>`SELECT n.codnf, n.nronf, n.codparceiro, p.razao
        FROM nf n LEFT JOIN parceiros p ON p.codparceiro = n.codparceiro
       WHERE n.nronf::text = ${numero} AND n.idempresa = ${emp}
         AND (${codparceiro}::int IS NULL OR n.codparceiro = ${codparceiro}::int)
         AND (${soProcessada}::boolean = false OR n.proc = 'S')
       ORDER BY n.codnf LIMIT 50`.execute(db)).rows;
  }

  /** o apoio da tela: as NFs do número (para a escolha quando há mais de uma) */
  async apoioNf(nronf: string, codparceiro?: number) {
    const emp = this.emp();
    const numero = String(nronf ?? '').trim();
    if (!numero) return [];
    return this.nfsPeloNumero(this.dbp.forTenantRead() as AnyDB, emp, numero, codparceiro && codparceiro > 0 ? codparceiro : null, true);
  }

  /** o plano das parcelas do documento: uma como digitada, N pelo `BuildParcelas` (o total vazio é Vr. parcela × Parcelas — edtVlrDocExit :2506) */
  private planoDoDocumento(d: Record<string, unknown>, n: number, geracao: Record<string, unknown> | undefined): { total: number; parcelas: ParcelaAreceberPlanejada[] } {
    const dto_total = (x: Record<string, unknown>) => x.total;
    const total = n === 1 ? num(d.valor) : (num(dto_total(d)) > 0 ? r2(num(dto_total(d))) : r2(num(d.valor) * n));
    try {
      return {
        total,
        parcelas: planejarParcelasAreceber({ total, nrodup: n, venc1: String(d.dtvenc), intervalo: num(geracao?.intervalo), diaFixo: num(geracao?.dia_fixo),
          duplicata: d.duplicata as string | null, docnf: d.docnf as string | null }),
      };
    } catch (e) {
      if (e instanceof ErroPlanoParcelas) throw new BusinessRuleError(e.code);
      throw e;
    }
  }

  private async inserirParcelas(trx: AnyDB, emp: number, op: number | null, cab: Record<string, unknown>, plano: { total: number; parcelas: ParcelaAreceberPlanejada[] }, codgrupo: number): Promise<number[]> {
    const base: Record<string, unknown> = { ...cab };
    for (const c of ['duplicata', 'dtvenc', 'valor', 'total', 'nrodup']) delete base[c];
    const ids: number[] = [];
    for (const p of plano.parcelas) {
      const ins = await trx
        .insertInto('areceber')
        .values({
          ...base, nrodup: plano.parcelas.length, duplicata: p.duplicata, dtvenc: p.dtvenc, valor: p.valor, total: plano.total, codgrupo,
          codempresa: emp, quitada: 'N', agrupado: 'N', consiliado: 'S', cadastrado_manualmente: 'S', gerado: 'OPERADOR',
          usultalteracao: op, dtultimalteracao: sql`now()`, dtcadastro: sql`now()`,
        })
        .returning('codrcb')
        .executeTakeFirstOrThrow();
      ids.push(Number((ins as Record<string, unknown>).codrcb));
    }
    return ids;
  }

  /** a grade `dbgParcelas` (o documento inteiro, pelo CODGRUPO) com os totais */
  async parcelas(id: number) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const t = (await sql<Record<string, unknown>>`SELECT codgrupo FROM areceber WHERE codrcb = ${id} AND codempresa = ${emp}`.execute(db)).rows[0];
    if (!t) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codrcb: id });
    const g = t.codgrupo == null ? null : num(t.codgrupo);
    const linhas = (await sql<Record<string, unknown>>`SELECT r.codrcb, r.duplicata, r.nrodup, r.dtvenda, r.dtvenc, r.valor, r.total, r.txjuros, r.quitada, r.tipodoc,
        r.idpgto, f.modalidade, r.codbco, b.banco, r.obs, r.idnf, r.docnf, r.codparceiro, p.razao AS nomecliente, r.codempresa, r.cadastrado_manualmente, r.origem
        FROM areceber r LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro LEFT JOIN formas_pgto f ON f.idpgto = r.idpgto LEFT JOIN bancos b ON b.codbco = r.codbco
       WHERE ${g == null ? sql`r.codrcb = ${id}` : sql`r.codgrupo = ${g}`} ORDER BY r.codrcb`.execute(db)).rows;
    return {
      codgrupo: g,
      parcelas: linhas,
      totais: { nrodup: linhas.length, total_parcelas: r2(linhas.reduce((s, l) => s + num(l.valor), 0)), total_documento: num(linhas[0]?.total) || r2(linhas.reduce((s, l) => s + num(l.valor), 0)) },
    };
  }

  /**
   * O "&Parcelas" sobre o documento gravado (btnGeraParcelasClick :700): refaz as parcelas do grupo — nenhuma recebida ou agrupada, e
   * só o documento manual ("Não é permitido alterar a quantidade de parcelas vindas do faturamento."). A duplicata e a NF são as da 1ª.
   */
  async regerarParcelas(id: number, dto: RegerarParcelasAreceberDto) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const ids = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await this.titulo(trx, id, emp);
      if (t.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO');
      if (t.agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO');
      if (t.agrupamento === 'S') throw new BusinessRuleError('TITULO_AGRUPAMENTO');
      await assertPeriodoNaoFechado(trx, emp, t.dtvenda, 'bloq_rcb');
      let codgrupo = t.codgrupo == null ? null : num(t.codgrupo);
      if (codgrupo == null) {
        codgrupo = await novoGrupo(trx);
        await sql`UPDATE areceber SET codgrupo = ${codgrupo} WHERE codrcb = ${id}`.execute(trx);
      }
      const grupo = (await sql<Record<string, unknown>>`SELECT * FROM areceber WHERE codgrupo = ${codgrupo} AND codempresa = ${emp} ORDER BY codrcb`.execute(trx)).rows;
      if (grupo.some((g) => g.quitada === 'S')) throw new BusinessRuleError('TITULO_JA_BAIXADO');
      if (grupo.some((g) => g.agrupado === 'S')) throw new BusinessRuleError('TITULO_AGRUPADO');
      if (grupo.some((g) => g.cadastrado_manualmente !== 'S' || String(g.origem ?? '') !== '' || (num(g.idnf) > 0 && g.nfadicmanual !== 'S'))) {
        throw new BusinessRuleError('ARECEBER_PARCELAS_FATURAMENTO');
      }
      const primeiro = grupo[0];
      const total = dto.total != null ? num(dto.total) : r2(grupo.reduce((s, g) => s + num(g.valor), 0));
      let plano;
      try {
        plano = planejarParcelasAreceber({ total, nrodup: dto.nrodup, venc1: dto.dtvenc, intervalo: dto.intervalo, diaFixo: dto.dia_fixo,
          duplicata: primeiro.duplicata as string | null, docnf: primeiro.docnf as string | null });
      } catch (e) {
        if (e instanceof ErroPlanoParcelas) throw new BusinessRuleError(e.code);
        throw e;
      }
      for (const g of grupo) if (g.contabilizado === 'S') await this.estornarSeContabilizado(trx, emp, g);
      const cab: Record<string, unknown> = {};
      for (const c of ['codparceiro', 'dtvenda', 'txjuros', 'txmulta', 'desconto_boleto', 'tipodoc', 'nropedido', 'nrocupom', 'codvendedor', 'codcobrador', 'idpgto',
        'codbco', 'codplc', 'idsituacao_nf', 'obs', 'docnf', 'idnf', 'nfadicmanual'] as const) cab[c] = primeiro[c] ?? null;
      const antigos = grupo.map((g) => num(g.codrcb));
      const novos = await this.inserirParcelas(trx, emp, op, cab, { total, parcelas: plano }, codgrupo);
      await sql`DELETE FROM caixa WHERE codrcb = ANY(${sql.val(antigos)}::numeric[])`.execute(trx);
      await sql`DELETE FROM areceber WHERE codrcb = ANY(${sql.val(antigos)}::numeric[])`.execute(trx);
      await lancarCaixaDoAreceber(trx, novos[0], emp, 'incluir', total);
      for (const codrcb of novos) {
        await this.integrarDocumento(trx, emp, codrcb);
        await this.logTitulo(trx, 'Inseriu', codrcb, undefined);
      }
      return novos;
    });
    return { codrcbs: ids, parcelas: ids.length, titulo: await this.read(ids[0]) };
  }

  /**
   * T1.6 — GERA N parcelas manuais a partir de um TOTAL (uCadAReceber.btnGeraParcelasClick:700 + BuildParcelas).
   * Uma única transação: 1 trava de período (na dtvenda) + 1 default de txjuros, depois N inserts. Cada título
   * = valor da parcela (rateio round(total/N), sobra na 1ª — mesmo motor do pedido), dtvenc calculada (modo
   * intervalo-dias OU dia-fixo-mensal), duplicata "i/N". Σ parcelas == total. Devolve os títulos criados.
   */
  async gerarParcelas(dto: Record<string, unknown>): Promise<{ parcelas: number; total: number; codrcbs: number[]; titulos: Array<Record<string, unknown> | undefined> }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;

    const numparc = Number(dto.numparc);
    const total = Number(dto.total);
    const venc1 = String(dto.venc1);
    const dtvenda = String(dto.dtvenda);
    const intervalo = dto.intervalo != null ? Number(dto.intervalo) : 0;
    const diafixo = dto.diafixo != null ? Number(dto.diafixo) : undefined;
    // a duplicata segue a regra da tela (`duplicataAreceber`): o "prefixo" do contrato antigo é a duplicata digitada
    const prefixo = dto.prefixoDuplicata != null ? String(dto.prefixoDuplicata).trim() : '';

    // datas: intervalo>0 → soma dias (diafixo é ignorado); senão → mensal no dia-do-mês de venc1 (ou diafixo),
    // clampando fim-de-mês. `vencimentos[0]` é sempre o MAIS CEDO (ambos os modos crescem).
    const vencimentos: string[] = [];
    for (let i = 0; i < numparc; i++) {
      vencimentos.push(intervalo > 0 ? addDays(venc1, i * intervalo) : addMonthsClamped(venc1, i, diafixo));
    }
    // venc≥venda (uCadAReceber:958): no modo dia-fixo, um `diafixo` menor que o dia de venc1 pode jogar a 1ª
    // parcela para ANTES da dtvenda — o schema só valida venc1, então reforça aqui sobre a data efetiva.
    if (vencimentos[0] < dtvenda.slice(0, 10)) throw new BusinessRuleError('PARCELA_VENC_ANTERIOR_VENDA', { venc: vencimentos[0], dtvenda });
    // rateio: floor(total/N) por parcela + a SOBRA (sempre ≥ 0) na PRIMEIRA (RatearTotalNasParcelas:8941).
    // floor (não round) garante que a 1ª é a MAIOR e nenhuma parcela fica ≤ 0 — round poderia deixar resíduo
    // negativo e zerar/negativar a 1ª, furando a invariante valor>0 da AR (o insert em lote burla o schema).
    // Guarda: cada parcela precisa de ≥ 1 centavo (senão AR title com valor 0). Σ == total.
    const totalCents = Math.round(total * 100);
    if (totalCents < numparc) throw new BusinessRuleError('PARCELA_VALOR_INSUFICIENTE', { total: r2(total), numparc });
    const porCents = Math.floor(totalCents / numparc);
    const residuo = totalCents - porCents * numparc; // ∈ [0, numparc-1]
    const valores: number[] = [];
    for (let i = 0; i < numparc; i++) valores.push((porCents + (i === 0 ? residuo : 0)) / 100);

    // campos de cabeçalho compartilhados (só os presentes).
    const cab: Record<string, unknown> = {};
    for (const c of ['codparceiro', 'tipodoc', 'txjuros', 'txmulta', 'desconto_boleto', 'codvendedor', 'codcobrador', 'idpgto', 'codbco', 'codplc', 'nroped', 'obs'] as const) {
      if (dto[c] !== undefined) cab[c] = dto[c];
    }
    if (cab.nroped !== undefined) cab.nropedido = cab.nroped; // o NROPEDIDO do legado (ver `delta`)

    const codrcbs = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // trava de período contábil fechado (uma vez, na dtvenda × BLOQ_RCB).
      await assertPeriodoNaoFechado(trx, emp, dtvenda, 'bloq_rcb');
      // txjuros default = snapshot da EMPRESAS.TXJUROPADRAO (uma vez).
      if (cab.txjuros == null) {
        const e = await trx.selectFrom('empresas').select('txjuropadrao').where('idempresa', '=', emp).executeTakeFirst();
        cab.txjuros = (e as { txjuropadrao?: unknown } | undefined)?.txjuropadrao ?? null;
      }
      // o Gravar da tela: a forma de pagamento e o cliente/fornecedor valem aqui também
      await this.validarCadastro(trx, emp, cab, undefined);
      const codgrupo = await novoGrupo(trx);
      const ids = await this.inserirParcelas(trx, emp, op, { ...cab, dtvenda }, {
        total: r2(total),
        parcelas: vencimentos.map((dtvenc, i) => ({ duplicata: duplicataAreceber(numparc, i + 1, prefixo, null), dtvenc, valor: valores[i] })),
      }, codgrupo);
      // uma CAIXA para o DOCUMENTO, com o total das parcelas, no primeiro título (GetTotalDoc; uCadAReceber.pas:1075)
      if (ids.length) await lancarCaixaDoAreceber(trx, ids[0], emp, 'incluir', r2(total));
      return ids;
    });

    const titulos = await Promise.all(codrcbs.map((id) => this.read(id)));
    return { parcelas: numparc, total: r2(total), codrcbs, titulos };
  }

  // ── as travas da tela (uCadAReceber) ────────────────────────────────────────────────────────────────────────
  /**
   * `VerificaCRCadastradaAutomaticamente` (uCadAReceber.pas:4115-4146): o título de ORIGEM Q/O/C (quebra, convênio, caixa) e o da
   * NF (IDNF, fora a NF adicionada à mão) é "de outro processo". Com `BLOQUEIA_CONTAS_RECEBER_ORIGEM_AUTO`='S' (a produção), a tela
   * trava os campos de `DesabilitaCampos` — o vencimento, a forma, o banco e o tipo seguem editáveis; no título da NF ainda
   * aberto, o desconto do boleto e a taxa de juros voltam.
   */
  private static origemAutomatica(t: Record<string, unknown>): boolean {
    return ['Q', 'O', 'C'].includes(String(t.origem ?? '')) || (num(t.idnf) !== 0 && t.nfadicmanual !== 'S');
  }
  private static readonly CAMPOS_ORIGEM_AUTO = [
    'nroped', 'nrocupom', 'txjuros', 'duplicata', 'dtvenda', 'nrodup', 'valor', 'desconto_boleto',
    'codparceiro', 'codplc', 'codcobrador', 'codvendedor', 'obs',
  ];
  private async camposBloqueados(trx: AnyDB, emp: number, t: Record<string, unknown>): Promise<string[]> {
    if (AreceberService.origemAutomatica(t) && (await this.cfg(trx, 'BLOQUEIA_CONTAS_RECEBER_ORIGEM_AUTO', emp)) === 'S') {
      const livres = num(t.idnf) !== 0 ? new Set(['desconto_boleto', 'txjuros']) : new Set<string>();
      return AreceberService.CAMPOS_ORIGEM_AUTO.filter((c) => !livres.has(c));
    }
    return t.agrupamento === 'S' ? ['valor'] : [];
  }

  private async titulo(trx: AnyDB, id: number, emp: number): Promise<Record<string, unknown>> {
    const t = (await sql<Record<string, unknown>>`SELECT * FROM areceber WHERE codrcb = ${id} AND codempresa = ${emp} FOR UPDATE`.execute(trx)).rows[0];
    if (!t) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codrcb: id });
    return t;
  }

  /** `VerificaBloqueio` (:4163-4172): pago ou agrupado trava a tela — editar e excluir */
  private static travasDaTela(t: Record<string, unknown>) {
    if (t.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO'); // baixado — estorne a baixa antes
    if (t.agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO'); // remova do agrupamento antes
  }

  /** `VerificaContabilizado` (:4083): sem integração automática não muda; com ela, o contábil do título é estornado antes */
  private async estornarSeContabilizado(trx: AnyDB, emp: number, t: Record<string, unknown>): Promise<void> {
    if (t.contabilizado !== 'S') return;
    const integracao = (await sql<{ integracao: string | null }>`SELECT integracao FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0]?.integracao;
    if (String(integracao ?? '') !== 'AUTOMATICA') throw new BusinessRuleError('TITULO_CONTABILIZADO');
    await this.docs.estornarDocumentoNaTrx(trx, 'CR', num(t.codrcb));
  }

  /** `IntegraReceber` (:3130): com integração automática, o gravar contabiliza os títulos do grupo; o erro é calado */
  private async integrarDocumento(trx: AnyDB, emp: number, codrcb: number): Promise<void> {
    const integracao = (await sql<{ integracao: string | null }>`SELECT integracao FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0]?.integracao;
    if (String(integracao ?? '') !== 'AUTOMATICA') return;
    const titulos = (await sql<{ codrcb: number }>`SELECT r.codrcb FROM areceber r, (SELECT codgrupo FROM areceber WHERE codrcb = ${codrcb}) g
        WHERE (r.codrcb = ${codrcb} OR (g.codgrupo IS NOT NULL AND r.codgrupo = g.codgrupo)) AND coalesce(r.contabilizado, 'N') <> 'S' ORDER BY r.codrcb`.execute(trx)).rows;
    for (const r of titulos) await emSavepoint(trx, 'contabil_areceber', () => this.docs.integrarDocumentoNaTrx(trx, 'CR', num(r.codrcb), null));
  }

  /** o título com os campos já no formato do histórico (dd/mm/aaaa, o dia no fuso da loja) */
  private async paraHistorico(trx: AnyDB, id: number, emp: number): Promise<Record<string, unknown>> {
    const tz = (await this.cfg(trx, 'FUSO_HORARIO_ACESSO', emp)) ?? 'America/Sao_Paulo';
    return (await sql<Record<string, unknown>>`SELECT *, to_char(dtvenda AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS dtvenda_h,
        to_char(dtvenc AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS dtvenc_h FROM areceber WHERE codrcb = ${id}`.execute(trx)).rows[0] ?? {};
  }

  /** o HISTORICO da edição (`SetaHistorico`, udmPrincipal.pas:3038): uma linha por campo alterado, como no contas a pagar */
  private async historicoDaEdicao(trx: AnyDB, emp: number, antes: Record<string, unknown>, depois: Record<string, unknown>): Promise<void> {
    const op = currentTenant().operadorId ?? null;
    const n = (v: unknown) => (v == null || v === '' ? '' : String(Number(v)).replace('.', ','));
    const i = (v: unknown) => String(Math.trunc(num(v)));
    const t = (v: unknown) => (v == null ? '' : String(v));
    const campos: Array<[string, (r: Record<string, unknown>) => string]> = [
      ['CODPARCEIRO', (r) => i(r.codparceiro)], ['DTVENDA', (r) => t(r.dtvenda_h)], ['DTVENC', (r) => t(r.dtvenc_h)],
      ['VALOR', (r) => n(r.valor)], ['DUPLICATA', (r) => t(r.duplicata)], ['OBS', (r) => t(r.obs)],
    ];
    for (const [campo, f] of campos) {
      const a = f(antes);
      const b = f(depois);
      if (a === b) continue;
      await sql`INSERT INTO historico (coddoc, tabela, historico, data, codoperador, codempresa)
          VALUES (${String(num(antes.codrcb))}, 'ARECEBER', ${`ALTERACAO DO CAMPO ${campo} DE: ${a} PARA: ${b}`.slice(0, 600)}, current_date, ${op}, ${emp})`.execute(trx);
    }
  }

  async atualizar(id: number, dto: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await this.titulo(trx, id, emp);
      AreceberService.travasDaTela(t);
      // período fechado × BLOQ_RCB — o legado trava a ABERTURA da edição pela data ATUAL (uCadAReceber:3470)
      // E o SALVAR pela data nova (:965). Barrar se a DTVENDA gravada OU a nova cair em período fechado
      // (senão dá para "resgatar"/mover um título ancorado num período já fechado).
      await assertPeriodoNaoFechado(trx, emp, t.dtvenda, 'bloq_rcb');
      if (dto.dtvenda != null) await assertPeriodoNaoFechado(trx, emp, dto.dtvenda, 'bloq_rcb');
      const d = this.delta(dto);
      await this.validarCadastro(trx, emp, d, t);
      await this.resolverNf(trx, emp, d, t);
      // a troca do CLIENTE (VerificaAlteracaoCliente :881 / InsereLogAlteracaoCliente :836): com EXIGE_MOTIVO_ALTERACAO_CLIENTE_CR (N; o módulo
      // Retaguarda = S) pede o motivo de operação CR; a LOG ganha "Alteração do cliente, de X para Y. Motivo: Z"; com
      // ATUALIZA_CLIENTE_OUTRAS_CR (S) as outras parcelas do grupo trocam junto (cada uma com a sua LOG)
      let trocaCliente: { de: string; para: string; motivo: string | null } | null = null;
      if (d.codparceiro !== undefined && num(d.codparceiro) !== num(t.codparceiro)) {
        let motivo: string | null = null;
        if ((await this.cfg(trx, 'EXIGE_MOTIVO_ALTERACAO_CLIENTE_CR', emp)) === 'S') {
          const motivos = (await sql<{ codmotivoop: number; descricao: string }>`SELECT codmotivoop, descricao FROM motivos_operacao WHERE tipo_operacao = 'CR' ORDER BY codmotivoop`.execute(trx)).rows;
          const m = motivos.find((x) => num(x.codmotivoop) === num(dto.codmotivoop));
          if (!m) throw new BusinessRuleError('ARECEBER_MOTIVO_OBRIGATORIO', { motivos });
          motivo = m.descricao;
        }
        const fant = async (cod: unknown) => String((await sql<{ f: string | null }>`SELECT coalesce(nullif(fantasia, ''), razao) AS f FROM parceiros WHERE codparceiro = ${num(cod)}`.execute(trx)).rows[0]?.f ?? '');
        trocaCliente = { de: await fant(t.codparceiro), para: await fant(d.codparceiro), motivo };
      }
      // os campos travados (só recusa o que MUDOU); o valor do agrupamento é a soma dos agrupados
      const igual = (a: unknown, b: unknown) => {
        const norm = (v: unknown) => (v == null || v === '' ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? 10 : undefined).trim());
        const na = norm(a); const nb = norm(b);
        return na === nb || (na !== '' && nb !== '' && !Number.isNaN(Number(na)) && Number(na) === Number(nb));
      };
      for (const campo of await this.camposBloqueados(trx, emp, t)) {
        if (d[campo] !== undefined && !igual(d[campo], t[campo])) {
          throw new BusinessRuleError(campo === 'valor' && (t.agrupamento === 'S') ? 'TITULO_AGRUPAMENTO' : 'TITULO_CAMPO_BLOQUEADO', { campo });
        }
      }
      await assertRestricoesSituacao(trx, d, t as Record<string, unknown>, { papel: 'cliente' });
      await this.estornarSeContabilizado(trx, emp, t);
      const antes = await this.paraHistorico(trx, id, emp);
      const antesLog = (await sql<Record<string, unknown>>`SELECT * FROM areceber WHERE codrcb = ${id}`.execute(trx)).rows[0];
      if (Object.keys(d).length) {
        await trx
          .updateTable('areceber')
          .set({ ...d, usultalteracao: op, dtultimalteracao: sql`now()` })
          .where('codrcb', '=', id)
          .where('codempresa', '=', emp)
          .execute();
        await lancarCaixaDoAreceber(trx, id, emp, 'editar'); // a edição apaga e relança a CAIXA do título (:1102)
      }
      await this.historicoDaEdicao(trx, emp, antes, await this.paraHistorico(trx, id, emp));
      await this.integrarDocumento(trx, emp, id);
      if (Object.keys(d).length) await this.logTitulo(trx, 'Alterou', id, antesLog);
      if (trocaCliente) {
        const historico = `Alteração do cliente, de ${trocaCliente.de} para ${trocaCliente.para}.${trocaCliente.motivo ? ` \r\nMotivo: ${trocaCliente.motivo}` : ''}`;
        await gravarLog(trx, { acao: 'Alterou', formulario: 'Contas a receber', tabela: 'ARECEBER', chave: 'CODRCB', valor: id, historico, idempresa: emp });
        if (t.codgrupo != null && (await this.cfg(trx, 'ATUALIZA_CLIENTE_OUTRAS_CR', emp)) === 'S') {
          const outras = (await sql<{ codrcb: number }>`SELECT codrcb FROM areceber WHERE codgrupo = ${t.codgrupo} AND codrcb <> ${id} AND codempresa = ${emp} ORDER BY codrcb`.execute(trx)).rows;
          for (const o of outras) {
            await sql`UPDATE areceber SET codparceiro = ${num(d.codparceiro)} WHERE codrcb = ${num(o.codrcb)}`.execute(trx);
            await gravarLog(trx, { acao: 'Alterou', formulario: 'Contas a receber', tabela: 'ARECEBER', chave: 'CODRCB', valor: num(o.codrcb), historico, idempresa: emp });
          }
        }
      }
    });
    return this.read(id);
  }

  /**
   * EXCLUIR (`btnExcluirClick`, uCadAReceber.pas:3524-3645), as travas na ordem do legado: gerado por outro processo; agrupamento;
   * desconto de títulos; contabilizado (estorna com integração automática); período fechado; conciliado na tesouraria (só com a
   * senha administrativa, `SenhaAdministrativa('ADM')`); criado pela NF; criado por adiantamento. Saem o HISTARECEBER, o
   * título, a CAIXA dele e fica o HISTORICO `EXCLUSAO DO REGISTRO CLIENTE: …, DOCUMENTO: …, VALOR: …`.
   */
  async excluir(id: number, senhaAdm?: string): Promise<void> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await this.titulo(trx, id, emp);
      AreceberService.travasDaTela(t);
      if (AreceberService.origemAutomatica(t) && (await this.cfg(trx, 'BLOQUEIA_CONTAS_RECEBER_ORIGEM_AUTO', emp)) === 'S') {
        throw new BusinessRuleError('TITULO_ORIGEM_AUTO', { origem: t.origem ?? null, idnf: t.idnf ?? null });
      }
      if (t.agrupamento === 'S') throw new BusinessRuleError('TITULO_AGRUPAMENTO');
      if (num(t.codgrupo_desconto_titulo) > 0) throw new BusinessRuleError('TITULO_DE_DESCONTO');
      if (num(t.cod_desconto_titulo) > 0) throw new BusinessRuleError('TITULO_DESCONTO_VINCULADO');
      await this.estornarSeContabilizado(trx, emp, t);
      await assertPeriodoNaoFechado(trx, emp, t.dtvenda, 'bloq_rcb'); // não excluir título de período fechado
      if (t.consiliado === 'S' && t.cadastrado_manualmente !== 'S') {
        if (!senhaAdm) throw new BusinessRuleError('TITULO_CONCILIADO');
        const { ok } = await this.senhaOp.verificar('admin', senhaAdm);
        if (!ok) throw new BusinessRuleError('SENHA_ADM_INVALIDA', { tipo: 'admin' });
      }
      if (num(t.idnf) > 0 && t.nfadicmanual !== 'S' && (await sql`SELECT 1 FROM nf WHERE codnf = ${num(t.idnf)}`.execute(trx)).rows.length) {
        throw new BusinessRuleError('TITULO_DE_NF', { idnf: t.idnf });
      }
      if (num(t.codadiantamento) > 0 && (await sql`SELECT 1 FROM adiantamento_forn WHERE codadiantamento = ${num(t.codadiantamento)}`.execute(trx)).rows.length) {
        throw new BusinessRuleError('TITULO_DE_ADIANTAMENTO', { codadiantamento: t.codadiantamento });
      }
      await sql`DELETE FROM histareceber WHERE codrcb = ${id}`.execute(trx);
      await trx.deleteFrom('areceber').where('codrcb', '=', id).where('codempresa', '=', emp).execute();
      await trx.deleteFrom('caixa').where('codrcb', '=', id).execute(); // a CAIXA do título sai junto (uCadAReceber.pas:3632)
      const nome = (await sql<{ razao: string | null }>`SELECT razao FROM parceiros WHERE codparceiro = ${num(t.codparceiro)}`.execute(trx)).rows[0]?.razao ?? '';
      const milhar = (v: unknown) => String(Math.round(num(v))).padStart(3, '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      await sql`INSERT INTO historico (coddoc, tabela, historico, data, codoperador, codempresa)
          VALUES (${String(id)}, 'ARECEBER', ${`EXCLUSAO DO REGISTRO CLIENTE: ${num(t.codparceiro)}-${nome}, DOCUMENTO: ${t.duplicata ?? ''}, VALOR: ${milhar(t.valor)}`.slice(0, 600)},
                  current_date, ${op}, ${emp})`.execute(trx);
    });
  }

}
