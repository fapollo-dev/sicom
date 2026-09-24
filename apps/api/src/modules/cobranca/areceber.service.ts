import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
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
    let q = (this.dbp.forTenantRead() as AnyDB).selectFrom('get_areceber').selectAll().where('codempresa', '=', emp);

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
    return q.limit(Math.min(Number(query.limite) || 200, 500)).execute();
  }

  /** Leitura por código (escopo empresa). */
  async read(id: number): Promise<Record<string, unknown> | undefined> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emp = this.emp();
    const v = (await db.selectFrom('get_areceber').selectAll().where('codrcb', '=', id).where('codempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!v) return v;
    // os campos que a tela trava neste título (VerificaCRCadastradaAutomaticamente)
    const x = (await sql<Record<string, unknown>>`SELECT origem, idnf, nfadicmanual, agrupamento FROM areceber WHERE codrcb = ${id}`.execute(db)).rows[0] ?? {};
    return { ...v, campos_bloqueados: await this.camposBloqueados(db, emp, { ...v, ...x }) };
  }

  /** Colunas que o usuário edita (delta) — nunca codrcb/codempresa/estado. */
  private static readonly COLUNAS = [
    'codparceiro', 'dtvenda', 'dtvenc', 'valor', 'txjuros', 'txmulta', 'desconto_boleto',
    'nrodup', 'duplicata', 'tipodoc', 'nroped', 'nrocupom',
    'codvendedor', 'codcobrador', 'idpgto', 'codbco', 'codplc', 'idsituacao_nf', 'obs',
  ];
  private delta(dto: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const c of AreceberService.COLUNAS) if (dto[c] !== undefined) out[c] = dto[c];
    // o Nº do pedido da tela é o NROPEDIDO do legado (12.656 títulos em 2026) — é ele que a contabilização lê para achar a venda
    if (out.nroped !== undefined) out.nropedido = out.nroped;
    return out;
  }

  /** Cria um título MANUAL (cadastrado_manualmente='S', gerado='OPERADOR', quitada='N'). */
  async criar(dto: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const id = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const d = this.delta(dto);
      // trava de período contábil fechado (ValidaPeriodoFechado, DTVENDA × BLOQ_RCB).
      await assertPeriodoNaoFechado(trx, emp, d.dtvenda, 'bloq_rcb');
      // cliente e centro de custo da situação do documento (uCadAReceber.pas:1728/2009; UCadSituacaoNF.md C5)
      await assertRestricoesSituacao(trx, d, {}, { papel: 'cliente' });
      // txjuros default = snapshot da EMPRESAS.TXJUROPADRAO (uCadAReceber: default do padrão da empresa).
      if (d.txjuros == null) {
        const e = await trx.selectFrom('empresas').select('txjuropadrao').where('idempresa', '=', emp).executeTakeFirst();
        d.txjuros = e?.txjuropadrao ?? null;
      }
      const ins = await trx
        .insertInto('areceber')
        .values({
          ...d,
          codempresa: emp,
          quitada: 'N',
          agrupado: 'N',
          consiliado: 'S',
          cadastrado_manualmente: 'S',
          gerado: 'OPERADOR',
          usultalteracao: op,
          dtultimalteracao: sql`now()`,
          dtcadastro: sql`now()`,
        })
        .returning('codrcb')
        .executeTakeFirstOrThrow();
      const codrcb = Number((ins as Record<string, unknown>).codrcb);
      await lancarCaixaDoAreceber(trx, codrcb, emp, 'incluir'); // a CAIXA gerencial do título (uCadAReceber.pas:1075)
      await this.integrarDocumento(trx, emp, codrcb);
      return codrcb;
    });
    return this.read(id);
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
      const ids: number[] = [];
      for (let i = 0; i < numparc; i++) {
        const dup = `${prefixo ? prefixo + ' - ' : ''}${String(i + 1).padStart(3, '0')}/${String(numparc).padStart(3, '0')}`.slice(0, 20);
        const ins = await trx
          .insertInto('areceber')
          .values({
            ...cab,
            dtvenda,
            dtvenc: vencimentos[i],
            valor: valores[i],
            nrodup: i + 1,
            duplicata: dup,
            codempresa: emp,
            quitada: 'N',
            agrupado: 'N',
            consiliado: 'S',
            cadastrado_manualmente: 'S',
            gerado: 'OPERADOR',
            usultalteracao: op,
            dtultimalteracao: sql`now()`,
            dtcadastro: sql`now()`,
          })
          .returning('codrcb')
          .executeTakeFirstOrThrow();
        ids.push(Number((ins as Record<string, unknown>).codrcb));
      }
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
