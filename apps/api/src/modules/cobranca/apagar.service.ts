import { Injectable } from '@nestjs/common';
import { ErroPlanoParcelas, obsDigitadaDaParcela, planejarParcelasApagar, type GerarParcelasApagarDto, type RateioApagarDto } from '@apollo/shared';
import { gravarLogDaLinha, type CampoLog } from '../../shared/log/registro-log';
import { sql, type Kysely } from 'kysely';
import { apagarRateioDoGrupo, novoGrupo, rateioUnico, refazerCaixaDoGrupo } from './apagar-caixa';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { todasAsEmpresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { assertPeriodoNaoFechado } from '../shared/periodo-contabil';
import { assertRestricoesSituacao } from '../shared/situacao-restricoes';
import { configNaTrx } from '../compras/pedido-heranca';
import { DocumentosContabilService } from './documentos-contabil.service';
import { emSavepoint } from './fechamento-contabil.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;

/**
 * CONTAS A PAGAR — corte-1 (cadastro/gestão do título). Gêmea de `areceber.service.ts` (mesmo molde
 * vertical, tenant por codempresa, travas de estado). Tabela `apagar` (PK codapg), view `get_apagar`.
 * O parceiro é o FORNECEDOR. A BAIXA/pagamento é o `apagar-baixa.service.ts`.
 */
@Injectable()
export class ApagarService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly docs: DocumentosContabilService,
  ) {}

  private async cfg(trx: AnyDB, codigo: string, emp: number): Promise<string | null> {
    return configNaTrx(trx, codigo, { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' });
  }

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private static readonly PESQUISA = new Set([
    'codapg', 'duplicata', 'razao', 'dtvenc', 'dtvenda', 'valor', 'quitada', 'tipodoc',
  ]);

  async list(query: Record<string, string | undefined>): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    // os títulos marcados na Pesquisa do AGRUPAMENTO (paraAgrupar + codigos): de qualquer loja do operador — a Pesquisa do legado não
    // filtra loja e o agrupamento atravessa as lojas; fora isso, a loja do login
    const codigos = query.paraAgrupar === 'S' ? (query.codigos ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 2000) : [];
    const db0 = this.dbp.forTenantRead() as AnyDB;
    let q = codigos.length
      ? db0.selectFrom('get_apagar').selectAll().where('codempresa', 'in', await todasAsEmpresasDoOperador(db0)).where('codapg', 'in', codigos)
      : db0.selectFrom('get_apagar').selectAll().where('codempresa', '=', emp);
    switch (query.situacao) {
      case 'liquidados': q = q.where('quitada', '=', 'S'); break;
      case 'agrupados': q = q.where('agrupado', '=', 'S'); break;
      case 'abertos': q = q.where(sql`coalesce(quitada,'N')`, '=', 'N').where(sql`coalesce(agrupado,'N')`, '=', 'N'); break;
    }
    // a busca da tela de agrupar (`uAgrupaContasAPagar`, GET_APAGAR_AGRUPAR): aberto e não agrupado; o fornecedor e o vencimento
    if (query.paraAgrupar === 'S') q = q.where(sql`coalesce(quitada,'N')`, '=', 'N').where(sql`coalesce(agrupado,'N')`, '=', 'N');
    if (query.codparceiro && Number(query.codparceiro) > 0) q = q.where('codparceiro', '=', Number(query.codparceiro));
    const dia = /^\d{4}-\d{2}-\d{2}$/;
    if (query.vencDe && dia.test(query.vencDe)) q = q.where(sql`dtvenc::date`, '>=', query.vencDe);
    if (query.vencAte && dia.test(query.vencAte)) q = q.where(sql`dtvenc::date`, '<=', query.vencAte);
    const campo = query.campo;
    if (campo && ApagarService.PESQUISA.has(campo) && query.valor != null && query.valor !== '') {
      const col = sql.ref(campo);
      const v = query.valor;
      switch (query.operador ?? 'contem') {
        case 'igual': q = q.where(col as any, '=', v); break;
        case 'comeca': q = q.where(sql`upper(${col})`, 'like', `${v.toUpperCase()}%`); break;
        default: q = q.where(sql`upper(${col})`, 'like', `%${v.toUpperCase()}%`); break;
      }
    }
    if (query.orderBy && ApagarService.PESQUISA.has(query.orderBy)) {
      q = q.orderBy(sql.ref(query.orderBy), query.orderDir === 'desc' ? 'desc' : 'asc');
    } else {
      q = q.orderBy('dtvenc', 'asc');
    }
    return q.limit(codigos.length ? codigos.length : Math.min(Number(query.limite) || 200, 500)).execute();
  }

  async read(id: number): Promise<Record<string, unknown> | undefined> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emp = this.emp();
    const v = (await db.selectFrom('get_apagar').selectAll().where('codapg', '=', id).where('codempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!v) return v;
    // o que a view não traz e a tela edita: desconto, embutidos, OBS — e os campos que ela trava neste título
    const x = (await sql<Record<string, unknown>>`SELECT a.desconto, a.vendor, a.obs, a.gfat, a.adfornecedor, a.agrupamento, a.nrparcela, a.codgrupo, a.status_pendencia,
        a.codparceirocedente, pc.razao AS parceirocedente, a.codgrupo_agrupamento_apg, n.nronf,
        (SELECT max(r.codapg) FROM apagar r WHERE r.codgrupo = a.codgrupo_agrupamento_apg) AS agrupado_em
        FROM apagar a LEFT JOIN parceiros pc ON pc.codparceiro = a.codparceirocedente LEFT JOIN nf n ON n.codnf = a.idnf
       WHERE a.codapg = ${id}`.execute(db)).rows[0] ?? {};
    const t = { ...v, ...x };
    const bloqueados = ApagarService.origemAutomatica(t) && (await this.cfg(db, 'BLOQUEIA_CONTAS_PAGAR_ORIGEM_AUTO', emp)) === 'S'
      ? [...ApagarService.CAMPOS_ORIGEM_AUTO]
      : (t.agrupamento === 'S' ? ['valor'] : []);
    return { ...t, total_doc: r2(num(t.valor) + num(t.vendor) - num(t.desconto)), campos_bloqueados: bloqueados };
  }

  private static readonly COLUNAS = [
    'codparceiro', 'dtvenda', 'dtvenc', 'valor', 'txjuros', 'txmulta', 'desconto_boleto',
    'nrodup', 'duplicata', 'tipodoc', 'nroped', 'nrocupom',
    'idpgto', 'codbco', 'codplc', 'idsituacao_nf', 'obs',
    // o desconto e os embutidos (acréscimo) do título — `edtDesconto`/`edtVendor` da tela (uAPagar.pas:4070-4205)
    'desconto', 'vendor',
    // o NRPARCELA e o fornecedor cedente do boleto (`edtNRPARCELA`/`edtCodParceiroCedente`)
    'nrparcela', 'codparceirocedente',
  ];
  private delta(dto: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const c of ApagarService.COLUNAS) if (dto[c] !== undefined) out[c] = dto[c];
    return out;
  }

  /**
   * a LOG "Contas a pagar" (o form-base do `frmAPagar`, `TLog.GravaLog` com o DataSet): os campos do dataset na ordem do legado
   * (lida na produção, 22/09/2026). O legado grava a LOG de todo título que passa pela tela — 4.600 Inseriu e 5.225 Alterou em 2026.
   */
  static readonly CAMPOS_LOG: readonly CampoLog[] = [
    'codapg', 'duplicata', 'obs', ['DTCOMPRA', 'dtcompra_log'], 'codoperador', 'codparceiro', 'quitada', ['IDEMPRESA', 'codempresa'], 'idnf', 'valor',
    'txjuros', ['DTVENC', 'dtvenc_log'], 'tipodoc', 'gfat', 'nrparcela', 'codgrupo', 'vendor', 'convenio', 'desconto', 'form', 'operacao_convenio_funcionario',
    'codplcfuncionarios', 'idsituacao_nf', 'agrupamento', 'agrupado', 'percjuros', 'mora', 'nrodup', 'codbarrasblt', 'cadastrado_manualmente', 'gerado',
    'origem', 'chavenfe',
  ];
  private async linhaLog(trx: AnyDB, id: number): Promise<Record<string, unknown> | undefined> {
    const emp = this.emp();
    const tz = String((await this.cfg(trx, 'FUSO_HORARIO_ACESSO', emp)) ?? 'America/Sao_Paulo');
    return (await sql<Record<string, unknown>>`SELECT *, to_char(coalesce(dtcompra::timestamp, dtvenda AT TIME ZONE ${tz}), 'DD/MM/YYYY') AS dtcompra_log,
        to_char(dtvenc AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS dtvenc_log FROM apagar WHERE codapg = ${id}`.execute(trx)).rows[0];
  }
  private async logTitulo(trx: AnyDB, acao: 'Inseriu' | 'Alterou', id: number, antes: Record<string, unknown> | undefined, depois: Record<string, unknown> | undefined) {
    if (!depois) return;
    await gravarLogDaLinha(trx, { acao, formulario: 'Contas a pagar', tabela: 'APAGAR', chave: 'CODAPG', valor: id, idempresa: this.emp(), campos: ApagarService.CAMPOS_LOG, antes, depois });
  }

  async criar(dto: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const id = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const d = this.delta(dto);
      await assertPeriodoNaoFechado(trx, emp, d.dtvenda, 'bloq_apg'); // período fechado (DTVENDA × BLOQ_APG)
      // fornecedor e centro de custo da situação do documento (uAPagar.pas:3559/3671; UCadSituacaoNF.md C5)
      await assertRestricoesSituacao(trx, d, {}, { papel: 'fornecedor' });
      if (d.txjuros == null) {
        const e = await trx.selectFrom('empresas').select('txjuropadrao').where('idempresa', '=', emp).executeTakeFirst();
        d.txjuros = e?.txjuropadrao ?? null;
      }
      // o documento nasce com desconto e embutidos zerados, como na tela (e é o "DE: 0" do histórico da primeira alteração)
      d.desconto = d.desconto ?? 0;
      d.vendor = d.vendor ?? 0;
      if (num(d.codparceirocedente) <= 0) d.codparceirocedente = null;
      const codgrupo = await novoGrupo(trx);
      // o DOCUMENTO: uma parcela como digitada, ou as N do PROCESSAR (`GerarDocumentos`) — todas no mesmo grupo
      const parcelas = await this.planoDoDocumento(trx, emp, d, dto.geracao as Record<string, unknown> | undefined);
      const ids = await this.inserirParcelas(trx, emp, op, d, parcelas, codgrupo);
      // o rateio pelo CC digitado e a CAIXA do grupo (o Gravar da tela, CAIXA-escritores.md §2) — com o total do documento
      if (d.codplc != null && Number(d.codplc) > 0) {
        const lancaSeparado = (await this.cfg(trx, 'LANCAR_CENTROCUSTO_DESCACREJRS_CONTAS_PAGAR', emp)) === 'S';
        const liquido = r2(parcelas.reduce((s, p) => s + p.valor + (lancaSeparado ? 0 : p.vendor - p.desconto), 0));
        await rateioUnico(trx, { codapg: ids[0], codgrupo, codcc: Number(d.codplc), valor: liquido, idsituacao_nf: (d.idsituacao_nf as number | null) ?? null });
        await this.sincronizarDescontosEmbutidos(trx, emp, codgrupo);
        await refazerCaixaDoGrupo(trx, codgrupo, op);
      }
      await this.integrarGrupo(trx, emp, codgrupo);
      for (const codapg of ids) await this.logTitulo(trx, 'Inseriu', codapg, undefined, await this.linhaLog(trx, codapg));
      return ids[0];
    });
    return this.read(id);
  }

  /** uma parcela gerada/digitada do documento (as colunas que mudam de parcela para parcela) */
  private static readonly POR_PARCELA = ['nrparcela', 'duplicata', 'dtvenc', 'valor', 'desconto', 'vendor', 'obs'] as const;
  private async modeloDuplicata(trx: AnyDB, emp: number): Promise<number | null> {
    const e = (await sql<{ modelo_duplicata: unknown }>`SELECT modelo_duplicata FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0];
    return e?.modelo_duplicata == null ? null : num(e.modelo_duplicata);
  }
  private async nronfDe(trx: AnyDB, idnf: unknown): Promise<string | null> {
    if (num(idnf) <= 0) return null;
    const n = (await sql<{ nronf: unknown }>`SELECT nronf FROM nf WHERE codnf = ${num(idnf)}`.execute(trx)).rows[0];
    return n?.nronf == null ? null : String(n.nronf);
  }
  /**
   * O PROCESSAR da tela (`btnGeraParcelasClick`/`GerarDocumentos`, uAPagar.pas:1256/…): com N > 1 o `valor` é o TOTAL do documento
   * (o cleTOTALNF) e as parcelas saem do plano puro (`planejarParcelasApagar`); com uma parcela, fica como digitada — NRPARCELA
   * '1/1' (9.702 dos 9.703 títulos de 2026 têm o campo).
   */
  private async planoDoDocumento(trx: AnyDB, emp: number, d: Record<string, unknown>, geracao: Record<string, unknown> | undefined) {
    const n = Math.max(1, Math.trunc(num(d.nrodup) || 1));
    if (n === 1) {
      return [{ nrparcela: String(d.nrparcela ?? '').trim() || '1/1', duplicata: (d.duplicata as string | null) ?? null, dtvenc: String(d.dtvenc),
        valor: num(d.valor), desconto: num(d.desconto), vendor: num(d.vendor), obs: (d.obs as string | null) ?? null }];
    }
    try {
      return planejarParcelasApagar({
        total: num(d.valor), nrodup: n, venc1: String(d.dtvenc), intervalo: num(geracao?.intervalo), diaFixo: num(geracao?.dia_fixo),
        restantesNaUltima: geracao?.restantes_na_ultima === true, desconto: num(d.desconto), vendor: num(d.vendor),
        tipodoc: d.tipodoc as string | null, duplicata: d.duplicata as string | null, nronf: await this.nronfDe(trx, d.idnf),
        modeloDuplicata: await this.modeloDuplicata(trx, emp), dtcompra: String(d.dtvenda ?? '').slice(0, 10), obs: d.obs as string | null,
      });
    } catch (e) {
      if (e instanceof ErroPlanoParcelas) throw new BusinessRuleError(e.code);
      throw e;
    }
  }
  private async inserirParcelas(trx: AnyDB, emp: number, op: number | null, cab: Record<string, unknown>,
    parcelas: Array<{ nrparcela: string; duplicata: string | null; dtvenc: string; valor: number; desconto: number; vendor: number; obs: string | null }>, codgrupo: number): Promise<number[]> {
    const base: Record<string, unknown> = { ...cab };
    for (const c of ApagarService.POR_PARCELA) delete base[c];
    const ids: number[] = [];
    for (const p of parcelas) {
      const ins = await trx
        .insertInto('apagar')
        .values({
          ...base, nrodup: parcelas.length, nrparcela: p.nrparcela, duplicata: p.duplicata, dtvenc: p.dtvenc, valor: p.valor, desconto: p.desconto, vendor: p.vendor, obs: p.obs,
          codempresa: emp, quitada: 'N', agrupado: 'N', consiliado: 'S',
          cadastrado_manualmente: 'S', gerado: 'OPERADOR', codgrupo, codoperador: op, form: 'TfrmAPagar',
          usultalteracao: op, dtultimalteracao: sql`now()`, dtcadastro: sql`now()`,
        })
        .returning('codapg')
        .executeTakeFirstOrThrow();
      ids.push(Number((ins as Record<string, unknown>).codapg));
    }
    return ids;
  }

  // ── as travas da tela (uAPagar) ──────────────────────────────────────────────────────────────────────────────
  /**
   * `FinanceiroOrigemAutomatica` (uAPagar.pas:4243): o título com ORIGEM (quebra, troco, retenção…), o do faturamento da NF
   * (IDNF com GFAT) e o adiantamento a fornecedor. Com `BLOQUEIA_CONTAS_PAGAR_ORIGEM_AUTO`='S' (a produção), a tela trava os
   * campos de `BloquearCampos` (:651-675) — os demais (vencimento, emissão, desconto, embutidos, tipo, banco, forma) seguem
   * editáveis: é assim que o cliente lança o desconto e o juro nos títulos das notas (268 e 198 em 2026).
   */
  private static origemAutomatica(t: Record<string, unknown>): boolean {
    return String(t.origem ?? '').trim() !== '' || (num(t.idnf) > 0 && t.gfat === 'S') || t.adfornecedor === 'S';
  }
  /** os campos de `BloquearCampos` que o Apollo edita (empresa, NF, pago e total da NF não são campos daqui) */
  private static readonly CAMPOS_ORIGEM_AUTO = ['codparceiro', 'valor', 'txjuros', 'obs', 'duplicata', 'nrodup', 'codplc'];

  private async titulo(trx: AnyDB, id: number, emp: number): Promise<Record<string, unknown>> {
    const t = (await sql<Record<string, unknown>>`SELECT * FROM apagar WHERE codapg = ${id} AND codempresa = ${emp} FOR UPDATE`.execute(trx)).rows[0];
    if (!t) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codapg: id });
    return t;
  }

  /** o que bloqueia a tela inteira ao carregar o documento (`edtCodigoExit`, :3193-3232) — editar e excluir */
  private static travasDaTela(t: Record<string, unknown>) {
    if (t.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO'); // "Este documento já está baixado."
    if (t.adcredito === 'S') throw new BusinessRuleError('TITULO_ADCREDITO');
    if (t.agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO');
    // (a trava do convênio de funcionários baixado/agrupado — `ExisteAgrupamentoOuBaixa` — não tem substrato: CONVENIO_FUN
    // tem 0 linhas no cliente)
  }

  /**
   * `VerificaContabilizado` (:5536): título contabilizado sem integração automática não muda; com ela, o contábil do
   * documento (os títulos do grupo) é estornado antes — e volta no fim do gravar (`IntegraApagar`).
   */
  private async estornarSeContabilizado(trx: AnyDB, emp: number, t: Record<string, unknown>): Promise<number> {
    if (t.contabilizado !== 'S') return 0;
    const integracao = (await sql<{ integracao: string | null }>`SELECT integracao FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0]?.integracao;
    if (String(integracao ?? '') !== 'AUTOMATICA') throw new BusinessRuleError('TITULO_CONTABILIZADO');
    const titulos = t.codgrupo == null
      ? [num(t.codapg)]
      : (await sql<{ codapg: number }>`SELECT codapg FROM apagar WHERE codgrupo = ${t.codgrupo} AND contabilizado = 'S' ORDER BY codapg`.execute(trx)).rows.map((r) => num(r.codapg));
    let n = 0;
    for (const codapg of titulos) n += await this.docs.estornarDocumentoNaTrx(trx, 'CP', codapg);
    return n;
  }

  /** `IntegraApagar` (:6654): com integração automática, os títulos do grupo vão ao razão depois do gravar; o erro é calado */
  private async integrarGrupo(trx: AnyDB, emp: number, codgrupo: number | null): Promise<void> {
    if (codgrupo == null) return;
    const integracao = (await sql<{ integracao: string | null }>`SELECT integracao FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0]?.integracao;
    if (String(integracao ?? '') !== 'AUTOMATICA') return;
    const titulos = (await sql<{ codapg: number }>`SELECT codapg FROM apagar WHERE codgrupo = ${codgrupo} AND coalesce(contabilizado, 'N') <> 'S' ORDER BY codapg`.execute(trx)).rows;
    for (const r of titulos) await emSavepoint(trx, 'contabil_apagar', () => this.docs.integrarDocumentoNaTrx(trx, 'CP', num(r.codapg), null));
  }

  /**
   * AS LINHAS D/E DO RATEIO (`InserirLancamentoCentroCusto`, :6537-6645) — com `LANCAR_CENTROCUSTO_DESCACREJRS_CONTAS_PAGAR`
   * = 'S' (a produção, no módulo Retaguarda), o desconto e os embutidos do documento viram linhas próprias no CX_APAGAR: D no
   * CC da situação `CONFIG_DESCONTOS_APG` (1150 → CC 1077), E no da `CONFIG_EMBUTIDOS_APG` (1290 → CC 304), com a soma do
   * grupo (D 268 de 269 e E 213 de 216 batem em 2026); o desconto de acordo comercial já rateado sai do D. Quem as consome é
   * a CAIXA do grupo (o resíduo do último CC) e o contábil do título.
   * ⚠️ divergência consciente: com a soma zerada a linha SAI — o legado não mexia nela e a CAIXA ficava com o desconto velho.
   */
  private async sincronizarDescontosEmbutidos(trx: AnyDB, emp: number, codgrupo: number | null): Promise<void> {
    if (codgrupo == null) return;
    if ((await this.cfg(trx, 'LANCAR_CENTROCUSTO_DESCACREJRS_CONTAS_PAGAR', emp)) !== 'S') return;
    const tot = (await sql<{ d: string; e: string; primeiro: number }>`SELECT coalesce(sum(desconto), 0) AS d, coalesce(sum(vendor), 0) AS e, min(codapg) AS primeiro
        FROM apagar WHERE codgrupo = ${codgrupo}`.execute(trx)).rows[0];
    const icfg = (await sql<Record<string, number | null>>`SELECT config_descontos_apg, config_embutidos_apg, config_acordo_comer_desc_nf FROM config_integracao_contabil LIMIT 1`.execute(trx)).rows[0] ?? {};
    for (const [tipo, soma, chave, nome] of [['D', num(tot?.d), 'config_descontos_apg', 'descontos'], ['E', num(tot?.e), 'config_embutidos_apg', 'embutidos']] as const) {
      let valor = soma;
      if (tipo === 'D' && icfg.config_acordo_comer_desc_nf) {
        const acordo = (await sql<{ t: string }>`SELECT coalesce(sum(x.valor), 0) AS t FROM cx_apagar x
            WHERE x.codgrupo = ${codgrupo} AND coalesce(x.tipo, 'V') = 'V'
              AND x.codcc IN (SELECT codplc FROM situacao_nf_plc WHERE idsituacao_nf = ${icfg.config_acordo_comer_desc_nf})`.execute(trx)).rows[0];
        valor -= num(acordo?.t);
      }
      valor = r2(valor);
      const existente = (await sql<{ codcxapagar: number }>`SELECT codcxapagar FROM cx_apagar WHERE codgrupo = ${codgrupo} AND tipo = ${tipo} ORDER BY codcxapagar`.execute(trx)).rows;
      if (valor <= 0) {
        if (existente.length) await sql`DELETE FROM cx_apagar WHERE codgrupo = ${codgrupo} AND tipo = ${tipo}`.execute(trx);
        continue;
      }
      const situacao = icfg[chave];
      if (!situacao) throw new BusinessRuleError('APAGAR_SITUACAO_DESC_EMBUT_NAO_CONFIGURADA', { tipo: nome });
      const plc = (await sql<{ codplc: number }>`SELECT codplc FROM situacao_nf_plc WHERE idsituacao_nf = ${situacao} ORDER BY codplc LIMIT 1`.execute(trx)).rows[0]?.codplc;
      if (plc == null) throw new BusinessRuleError('APAGAR_SITUACAO_SEM_CC', { situacao });
      if (existente.length) {
        await sql`UPDATE cx_apagar SET valor = ${valor}, codcc = ${plc}, idsituacao_nf = ${situacao}, dtultimalteracao = now() WHERE codcxapagar = ${existente[0].codcxapagar}`.execute(trx);
        if (existente.length > 1) await sql`DELETE FROM cx_apagar WHERE codgrupo = ${codgrupo} AND tipo = ${tipo} AND codcxapagar <> ${existente[0].codcxapagar}`.execute(trx);
      } else {
        await sql`INSERT INTO cx_apagar (codapg, codcc, valor, codgrupo, tipo, idsituacao_nf, dtultimalteracao)
            VALUES (${num(tot?.primeiro)}, ${plc}, ${valor}, ${codgrupo}, ${tipo}, ${situacao}, now())`.execute(trx);
      }
    }
  }

  /**
   * O HISTORICO da edição (`SetaHistorico`, udmPrincipal.pas:3038): uma linha por campo alterado — `ALTERACAO DO CAMPO VENDOR DE:
   * 0 PARA: 1,55` —, com a data do dia, o título e quem gravou (6.771 TIPODOC, 1.241 DTVENC, 1.073 VALOR, 533 DESCONTO, 442
   * VENDOR… desde 2025). Número como o `AsString` do Delphi (vírgula, sem zeros à direita), data dd/mm/aaaa.
   */
  private async historicoDaEdicao(trx: AnyDB, emp: number, antes: Record<string, unknown>, depois: Record<string, unknown>): Promise<void> {
    const op = currentTenant().operadorId ?? null;
    const n = (v: unknown) => (v == null || v === '' ? '' : String(Number(v)).replace('.', ','));
    const i = (v: unknown) => String(Math.trunc(num(v)));
    const t = (v: unknown) => (v == null ? '' : String(v));
    const total = (r: Record<string, unknown>) => r2(num(r.valor) + num(r.vendor) - num(r.desconto));
    const campos: Array<[string, (r: Record<string, unknown>) => string]> = [
      ['CODPARCEIRO', (r) => i(r.codparceiro)], ['DTCOMPRA', (r) => t(r.dtcompra_h)], ['DTVENC', (r) => t(r.dtvenc_h)],
      ['VALOR', (r) => n(r.valor)], ['DESCONTO', (r) => n(r.desconto)], ['VENDOR', (r) => n(r.vendor)], ['TOTAL_DOC', (r) => n(total(r))],
      ['DUPLICATA', (r) => t(r.duplicata)], ['TIPODOC', (r) => t(r.tipodoc)], ['OBS', (r) => t(r.obs)], ['IDNF', (r) => i(r.idnf)],
    ];
    for (const [campo, f] of campos) {
      const a = f(antes);
      const b = f(depois);
      if (a === b) continue;
      await sql`INSERT INTO historico (coddoc, tabela, historico, data, codoperador, codempresa)
          VALUES (${String(num(antes.codapg))}, 'APAGAR', ${`ALTERACAO DO CAMPO ${campo} DE: ${a} PARA: ${b}`.slice(0, 600)}, current_date, ${op}, ${emp})`.execute(trx);
    }
  }

  /** o título com as datas já no formato do histórico (dd/mm/aaaa, o dia no fuso da loja) */
  private async paraHistorico(trx: AnyDB, id: number, emp: number): Promise<Record<string, unknown>> {
    const tz = (await this.cfg(trx, 'FUSO_HORARIO_ACESSO', emp)) ?? 'America/Sao_Paulo';
    return (await sql<Record<string, unknown>>`SELECT *, to_char(dtcompra, 'DD/MM/YYYY') AS dtcompra_h, to_char(dtvenc AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS dtvenc_h
        FROM apagar WHERE codapg = ${id}`.execute(trx)).rows[0] ?? {};
  }

  async atualizar(id: number, dto: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await this.titulo(trx, id, emp);
      const antes = await this.paraHistorico(trx, id, emp);
      const antesLog = await this.linhaLog(trx, id);
      ApagarService.travasDaTela(t);
      // período fechado × BLOQ_APG — trava pela DTVENDA (=DTCOMPRA) atual (uAPagar:1018) E pela nova (:1703).
      await assertPeriodoNaoFechado(trx, emp, t.dtvenda, 'bloq_apg');
      if (dto.dtvenda != null) await assertPeriodoNaoFechado(trx, emp, dto.dtvenda, 'bloq_apg');
      const d = this.delta(dto);
      if (d.codparceirocedente !== undefined && num(d.codparceirocedente) <= 0) d.codparceirocedente = null;
      // os campos travados do título de origem automática (BLOQUEIA_CONTAS_PAGAR_ORIGEM_AUTO): só recusa o que MUDOU
      if (ApagarService.origemAutomatica(t) && (await this.cfg(trx, 'BLOQUEIA_CONTAS_PAGAR_ORIGEM_AUTO', emp)) === 'S') {
        const igual = (a: unknown, b: unknown) => (a == null || a === '' ? '' : String(typeof a === 'number' || typeof b === 'number' ? Number(a) : a).trim())
          === (b == null || b === '' ? '' : String(typeof a === 'number' || typeof b === 'number' ? Number(b) : b).trim());
        for (const campo of ApagarService.CAMPOS_ORIGEM_AUTO) {
          if (d[campo] !== undefined && !igual(d[campo], t[campo])) throw new BusinessRuleError('TITULO_CAMPO_BLOQUEADO', { campo });
        }
      }
      // o valor do título de agrupamento não se digita (`edtVALOR.Enabled := not AGRUPAMENTO`, :1060): é a soma dos agrupados
      // — para mexer no valor, reverte-se o agrupamento
      if (t.agrupamento === 'S' && d.valor !== undefined && num(d.valor) !== num(t.valor)) {
        throw new BusinessRuleError('TITULO_AGRUPAMENTO');
      }
      await assertRestricoesSituacao(trx, d, t as Record<string, unknown>, { papel: 'fornecedor' });
      await this.estornarSeContabilizado(trx, emp, t);
      if (Object.keys(d).length) {
        await trx
          .updateTable('apagar')
          .set({ ...d, usultalteracao: op, dtultimalteracao: sql`now()` })
          .where('codapg', '=', id)
          .where('codempresa', '=', emp)
          .execute();
      }
      // o cedente do boleto vale para todas as parcelas do documento (`edtCodParceiroCedenteExit`: o laço no cdsDocs)
      if (d.codparceirocedente !== undefined && t.codgrupo != null) {
        await sql`UPDATE apagar SET codparceirocedente = ${d.codparceirocedente} WHERE codgrupo = ${t.codgrupo} AND codapg <> ${id}`.execute(trx);
      }
      const depois = await this.paraHistorico(trx, id, emp);
      await this.historicoDaEdicao(trx, emp, antes, depois);
      await this.logTitulo(trx, 'Alterou', id, antesLog, await this.linhaLog(trx, id));

      // o Gravar da tela atualiza o rateio no lugar e refaz a CAIXA do grupo (CAIXA-escritores.md §2)
      const lancaSeparado = (await this.cfg(trx, 'LANCAR_CENTROCUSTO_DESCACREJRS_CONTAS_PAGAR', emp)) === 'S';
      let codgrupo = (depois?.codgrupo as number | null) ?? null;
      if (depois && depois.codplc != null && Number(depois.codplc) > 0) {
        if (codgrupo == null) {
          codgrupo = await novoGrupo(trx);
          await trx.updateTable('apagar').set({ codgrupo }).where('codapg', '=', id).execute();
        }
        // sem as linhas D/E, o desconto e os embutidos vão para dentro do rateio (o "Deseja ratear…?" do legado, :4090-4205)
        const soma = Number((await sql<{ t: string }>`SELECT sum(valor + ${lancaSeparado ? 0 : sql`coalesce(vendor, 0) - coalesce(desconto, 0)`}) AS t
            FROM apagar WHERE codgrupo = ${codgrupo}`.execute(trx)).rows[0]?.t ?? 0);
        // só o rateio de UM centro de custo segue o CC do título; o de vários (o do legado, digitado na grade) fica como está
        const linhasV = (await sql<{ codcxapagar: number; valor: string }>`SELECT codcxapagar, valor FROM cx_apagar WHERE codgrupo = ${codgrupo} AND coalesce(tipo, 'V') = 'V' ORDER BY codcxapagar`.execute(trx)).rows;
        const linha = linhasV.length === 1 ? linhasV[0] : undefined;
        if (linhasV.length > 1) {
          if (!lancaSeparado) await this.ratearDiferenca(trx, linhasV, r2(num(depois.vendor) - num(t.vendor) - (num(depois.desconto) - num(t.desconto))));
        } else if (linha) {
          await sql`UPDATE cx_apagar SET codcc = ${Number(depois.codplc)}, valor = ${soma}, idsituacao_nf = ${(depois.idsituacao_nf as number | null) ?? null}, dtultimalteracao = now()
                    WHERE codcxapagar = ${linha.codcxapagar}`.execute(trx);
        } else {
          await rateioUnico(trx, { codapg: id, codgrupo, codcc: Number(depois.codplc), valor: soma, idsituacao_nf: (depois.idsituacao_nf as number | null) ?? null });
        }
      } else if (codgrupo != null && !lancaSeparado) {
        const linhasV = (await sql<{ codcxapagar: number; valor: string }>`SELECT codcxapagar, valor FROM cx_apagar WHERE codgrupo = ${codgrupo} AND coalesce(tipo, 'V') = 'V' ORDER BY codcxapagar`.execute(trx)).rows;
        if (linhasV.length) await this.ratearDiferenca(trx, linhasV, r2(num(depois?.vendor) - num(t.vendor) - (num(depois?.desconto) - num(t.desconto))));
      }
      await this.sincronizarDescontosEmbutidos(trx, emp, codgrupo);
      await refazerCaixaDoGrupo(trx, codgrupo, op);
      await this.integrarGrupo(trx, emp, codgrupo);
    });
    return this.read(id);
  }

  /** o rateio do desconto/acréscimo pelos centros de custo (:4101-4130): proporcional ao valor de cada um, o resíduo no último */
  private async ratearDiferenca(trx: AnyDB, linhas: Array<{ codcxapagar: number; valor: string }>, delta: number): Promise<void> {
    if (!delta) return;
    const total = linhas.reduce((s, l) => s + num(l.valor), 0);
    if (!total) return;
    let aplicado = 0;
    for (let k = 0; k < linhas.length; k++) {
      let parte = r2((delta * num(linhas[k].valor)) / total);
      if (k === linhas.length - 1) parte = r2(delta - aplicado);
      aplicado = r2(aplicado + parte);
      await sql`UPDATE cx_apagar SET valor = valor + ${parte}, dtultimalteracao = now() WHERE codcxapagar = ${linhas[k].codcxapagar}`.execute(trx);
    }
  }

  /**
   * EXCLUIR (`btnExcluirClick`, :1105-1238): as travas do legado na ordem e o DOCUMENTO inteiro — todas as parcelas do grupo
   * saem, cada uma com o HISTORICO `EXCLUSAO DO REGISTRO FORNECEDOR: …, DOCUMENTO: …, VALOR: …`; o rateio do grupo sai antes
   * (e a trigger CAIXA_APAGAR do Oracle leva a CAIXA). O contábil é estornado com integração automática.
   */
  async excluir(id: number): Promise<void> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await this.titulo(trx, id, emp);
      ApagarService.travasDaTela(t);
      await assertPeriodoNaoFechado(trx, emp, t.dtvenda, 'bloq_apg');
      if (num(t.idnf) > 0 && (await sql`SELECT 1 FROM nf WHERE codnf = ${num(t.idnf)}`.execute(trx)).rows.length) throw new BusinessRuleError('TITULO_DE_NF', { idnf: t.idnf });
      if (num(t.codadiantamento) > 0 && (await sql`SELECT 1 FROM adiantamento_forn WHERE codadiantamento = ${num(t.codadiantamento)}`.execute(trx)).rows.length) {
        throw new BusinessRuleError('TITULO_DE_ADIANTAMENTO', { codadiantamento: t.codadiantamento });
      }
      const grupo = t.codgrupo == null ? null : num(t.codgrupo);
      const pago = grupo == null ? 0 : num((await sql<{ t: string }>`SELECT coalesce(sum(b.valorpg), 0) AS t FROM apagar_bx b JOIN apagar a ON a.codapg = b.codapg
          WHERE a.codgrupo = ${grupo} AND coalesce(b.indr, 'I') = 'I'`.execute(trx)).rows[0]?.t);
      if (pago > 0) throw new BusinessRuleError('TITULO_GRUPO_COM_PAGAMENTO');
      if (t.agrupamento === 'S') throw new BusinessRuleError('TITULO_AGRUPAMENTO');
      if (num(t.cod_desconto_titulo) > 0) throw new BusinessRuleError('TITULO_DESCONTO_VINCULADO');
      if (num(t.codgrupo_desconto_titulo) > 0) throw new BusinessRuleError('TITULO_DE_DESCONTO');
      await this.estornarSeContabilizado(trx, emp, t);
      const titulos = grupo == null
        ? [t]
        : (await sql<Record<string, unknown>>`SELECT a.*, p.razao FROM apagar a LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro
             WHERE a.codgrupo = ${grupo} AND a.codempresa = ${emp} ORDER BY a.codapg`.execute(trx)).rows;
      // o valor sai como o FormatFloat('0,00') do Delphi: inteiro com o separador de milhar (1.068)
      const milhar = (v: unknown) => String(Math.round(num(v))).padStart(3, '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      for (const x of titulos) {
        const razao = x.razao ?? (await sql<{ razao: string | null }>`SELECT razao FROM parceiros WHERE codparceiro = ${num(x.codparceiro)}`.execute(trx)).rows[0]?.razao ?? '';
        await sql`INSERT INTO historico (coddoc, tabela, historico, data, codoperador, codempresa)
            VALUES (${String(num(x.codapg))}, 'APAGAR', ${`EXCLUSAO DO REGISTRO FORNECEDOR: ${num(x.codparceiro)}-${razao}, DOCUMENTO: ${x.duplicata ?? ''}, VALOR: ${milhar(x.valor)}`.slice(0, 600)},
                    current_date, ${op}, ${emp})`.execute(trx);
      }
      await apagarRateioDoGrupo(trx, grupo);
      if (grupo == null) await trx.deleteFrom('apagar').where('codapg', '=', id).where('codempresa', '=', emp).execute();
      else await trx.deleteFrom('apagar').where('codgrupo', '=', grupo).where('codempresa', '=', emp).execute();
    });
  }

  // ── as abas e os grupos da tela (auditoria do uAPagar.dfm, 14/10/2026) ────────────────────────────────────────────

  /** `RetornaTotalPago` (:4318): a soma do VALOR dos títulos do grupo com baixa ativa (APAGAR_BX INDR 'I') */
  private async totalPago(trx: AnyDB, codgrupo: number | null): Promise<number> {
    if (codgrupo == null) return 0;
    const r = (await sql<{ t: unknown }>`SELECT coalesce(sum(a.valor), 0) AS t FROM apagar_bx x LEFT JOIN apagar a ON a.codapg = x.codapg
        WHERE coalesce(x.indr, 'I') = 'I' AND x.codapg IN (SELECT codapg FROM apagar WHERE codgrupo = ${codgrupo})`.execute(trx)).rows[0];
    return r2(num(r?.t));
  }

  /** a aba PARCELAS (`sqqAPagarGrupo`, a grade do documento) + o total do documento, o pago (`edtPago`) e o número de parcelas */
  async parcelas(id: number) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const t = (await sql<Record<string, unknown>>`SELECT codgrupo FROM apagar WHERE codapg = ${id} AND codempresa = ${emp}`.execute(db)).rows[0];
    if (!t) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codapg: id });
    const g = t.codgrupo == null ? null : num(t.codgrupo);
    const linhas = (await sql<Record<string, unknown>>`SELECT a.codapg, a.nrparcela, a.duplicata, a.dtvenda, a.dtcompra, a.dtvenc, a.valor, a.desconto, a.vendor, a.txjuros,
        a.quitada, a.tipodoc, a.codbco, b.banco AS descbanco, a.obs, a.idnf, n.nronf, n.totalnf, a.codparceiro, p.razao AS descforn, a.gfat, a.gerado, a.codoperador, o.nome AS descoperador,
        a.codempresa AS idempresa, a.idsituacao_nf, sn.descricao AS situacao_descricao, a.codparceirocedente, pc.razao AS parceirocedente, a.cadastrado_manualmente,
        (a.valor + coalesce(a.vendor, 0) - coalesce(a.desconto, 0)) AS total_doc
        FROM apagar a LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro LEFT JOIN operadores o ON o.codoperador = a.codoperador
        LEFT JOIN bancos b ON b.codbco = a.codbco LEFT JOIN nf n ON n.codnf = a.idnf LEFT JOIN situacao_nf sn ON sn.idsituacao_nf = a.idsituacao_nf
        LEFT JOIN parceiros pc ON pc.codparceiro = a.codparceirocedente
       WHERE ${g == null ? sql`a.codapg = ${id}` : sql`a.codgrupo = ${g}`} ORDER BY a.codapg`.execute(db)).rows;
    const totais = {
      nrodup: linhas.length,
      total_parcelas: r2(linhas.reduce((s, l) => s + num(l.valor), 0)),
      total_documento: r2(linhas.reduce((s, l) => s + num(l.total_doc), 0)),
      total_pago: await this.totalPago(db, g),
    };
    return { codgrupo: g, parcelas: linhas, totais };
  }

  /**
   * O PROCESSAR sobre um documento gravado (`btnGeraParcelasClick` :1256): "Não será possível processar pois já existem parcelas
   * pagas."; as parcelas do grupo saem (o `cdsRemover_Apagar`) e as novas entram no mesmo grupo com o cabeçalho da 1ª — o total é o
   * informado (o cleTOTALNF) ou a soma das atuais; desconto e embutidos são as somas do grupo, redivididos.
   */
  async gerarParcelas(id: number, dto: GerarParcelasApagarDto) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const ids = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await this.titulo(trx, id, emp);
      ApagarService.travasDaTela(t);
      await assertPeriodoNaoFechado(trx, emp, t.dtvenda, 'bloq_apg');
      // `BloquearCampos` (:651-675) desliga o número de parcelas no título de origem automática; o agrupamento não se reparcela
      if (ApagarService.origemAutomatica(t) && (await this.cfg(trx, 'BLOQUEIA_CONTAS_PAGAR_ORIGEM_AUTO', emp)) === 'S') {
        throw new BusinessRuleError('TITULO_CAMPO_BLOQUEADO', { campo: 'nrodup' });
      }
      if (t.agrupamento === 'S') throw new BusinessRuleError('TITULO_AGRUPAMENTO');
      let codgrupo = t.codgrupo == null ? null : num(t.codgrupo);
      if (codgrupo == null) {
        codgrupo = await novoGrupo(trx);
        await sql`UPDATE apagar SET codgrupo = ${codgrupo} WHERE codapg = ${id}`.execute(trx);
      }
      if ((await this.totalPago(trx, codgrupo)) > 0) throw new BusinessRuleError('APAGAR_PARCELAS_PAGAS');
      const grupo = (await sql<Record<string, unknown>>`SELECT * FROM apagar WHERE codgrupo = ${codgrupo} ORDER BY codapg`.execute(trx)).rows;
      if (grupo.some((g) => g.quitada === 'S')) throw new BusinessRuleError('APAGAR_PARCELAS_PAGAS');
      if (grupo.some((g) => g.agrupado === 'S')) throw new BusinessRuleError('TITULO_AGRUPADO');
      const primeiro = grupo[0];
      const total = dto.total != null ? num(dto.total) : grupo.reduce((s, g) => s + num(g.valor), 0);
      const dtcompra = primeiro.dtcompra instanceof Date
        ? `${primeiro.dtcompra.getFullYear()}-${String(primeiro.dtcompra.getMonth() + 1).padStart(2, '0')}-${String(primeiro.dtcompra.getDate()).padStart(2, '0')}`
        : String(primeiro.dtcompra ?? primeiro.dtvenda ?? '').slice(0, 10);
      let plano;
      try {
        plano = planejarParcelasApagar({
          total, nrodup: dto.nrodup, venc1: dto.dtvenc, intervalo: dto.intervalo, diaFixo: dto.dia_fixo, restantesNaUltima: dto.restantes_na_ultima === true,
          desconto: grupo.reduce((s, g) => s + num(g.desconto), 0), vendor: grupo.reduce((s, g) => s + num(g.vendor), 0),
          tipodoc: primeiro.tipodoc as string | null, duplicata: primeiro.duplicata as string | null, nronf: await this.nronfDe(trx, primeiro.idnf),
          modeloDuplicata: await this.modeloDuplicata(trx, emp), dtcompra, obs: obsDigitadaDaParcela(primeiro.obs as string | null),
        });
      } catch (e) {
        if (e instanceof ErroPlanoParcelas) throw new BusinessRuleError(e.code);
        throw e;
      }
      await this.estornarSeContabilizado(trx, emp, t);
      const cab: Record<string, unknown> = {};
      for (const c of ['codparceiro', 'dtvenda', 'dtcompra', 'txjuros', 'txmulta', 'desconto_boleto', 'tipodoc', 'nroped', 'nrocupom', 'idpgto', 'codbco', 'codplc',
        'idsituacao_nf', 'codparceirocedente', 'idnf', 'gfat'] as const) cab[c] = primeiro[c] ?? null;
      const novos = await this.inserirParcelas(trx, emp, op, cab, plano, codgrupo);
      // o rateio do grupo continua (é por CODGRUPO); o seu título de referência passa a ser a 1ª parcela nova
      await sql`UPDATE cx_apagar SET codapg = ${novos[0]} WHERE codgrupo = ${codgrupo}`.execute(trx);
      await sql`DELETE FROM apagar WHERE codgrupo = ${codgrupo} AND codapg <> ALL(${sql.val(novos)}::numeric[])`.execute(trx);
      // uma linha V só → segue o total do documento (como o Gravar da tela); várias (a grade do legado) ficam como estão
      const lancaSeparado = (await this.cfg(trx, 'LANCAR_CENTROCUSTO_DESCACREJRS_CONTAS_PAGAR', emp)) === 'S';
      const soma = r2(plano.reduce((s, p) => s + p.valor + (lancaSeparado ? 0 : p.vendor - p.desconto), 0));
      const linhasV = (await sql<{ codcxapagar: number }>`SELECT codcxapagar FROM cx_apagar WHERE codgrupo = ${codgrupo} AND coalesce(nullif(trim(tipo), ''), 'V') = 'V' ORDER BY codcxapagar`.execute(trx)).rows;
      if (linhasV.length === 1) await sql`UPDATE cx_apagar SET valor = ${soma}, dtultimalteracao = now() WHERE codcxapagar = ${linhasV[0].codcxapagar}`.execute(trx);
      else if (!linhasV.length && num(primeiro.codplc) > 0) {
        await rateioUnico(trx, { codapg: novos[0], codgrupo, codcc: num(primeiro.codplc), valor: soma, idsituacao_nf: primeiro.idsituacao_nf == null ? null : num(primeiro.idsituacao_nf) });
      }
      await this.sincronizarDescontosEmbutidos(trx, emp, codgrupo);
      await refazerCaixaDoGrupo(trx, codgrupo, op);
      await this.integrarGrupo(trx, emp, codgrupo);
      for (const codapg of novos) await this.logTitulo(trx, 'Inseriu', codapg, undefined, await this.linhaLog(trx, codapg));
      return novos;
    });
    return { codapgs: ids, parcelas: ids.length, titulo: await this.read(ids[0]) };
  }

  /** a aba ULTIMOS LANÇAMENTOS (`FDqUltimosLanc`): os títulos do mesmo fornecedor nos últimos 365 dias de compra, menos este — sem filtro de loja, como o legado */
  async ultimosLancamentos(id: number) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const t = (await sql<Record<string, unknown>>`SELECT codparceiro FROM apagar WHERE codapg = ${id} AND codempresa = ${emp}`.execute(db)).rows[0];
    if (!t) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codapg: id });
    if (num(t.codparceiro) <= 0) return [];
    return (await sql<Record<string, unknown>>`SELECT p.codapg, p.duplicata, p.obs, coalesce(p.dtcompra, p.dtvenda::date) AS dtcompra, p.codoperador, p.codparceiro, p.quitada,
        p.codempresa AS idempresa, p.idnf, p.gerado, p.valor, p.txjuros, p.dtvenc, p.tipodoc, p.codbco, p.gfat, p.convenio, d.razao AS descforn, p.nrparcela, p.codgrupo,
        p.vendor, p.idlote, p.adfornecedor
        FROM apagar p LEFT JOIN parceiros d ON d.codparceiro = p.codparceiro
       WHERE d.codparceiro = ${num(t.codparceiro)} AND p.codapg <> ${id} AND coalesce(p.dtcompra, p.dtvenda::date) >= current_date - 365
       ORDER BY coalesce(p.dtcompra, p.dtvenda::date), p.codapg LIMIT 500`.execute(db)).rows;
  }

  /** a aba PENDÊNCIAS (`sqqPendencias`): os títulos cuja NF foi devolvida/excluída/revertida/cancelada/denegada e ninguém aceitou; o `edtLocalizar` filtra por código, duplicata ou NF */
  async pendencias(localizar?: string) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const texto = String(localizar ?? '').trim();
    const numero = /^\d+$/.test(texto) ? Number(texto) : null;
    const filtro = !texto ? sql`` : numero != null
      ? sql`AND (codapg = ${numero} OR upper(coalesce(duplicata, '')) LIKE ${'%' + texto.toUpperCase() + '%'} OR idnf = ${numero})`
      : sql`AND upper(coalesce(duplicata, '')) LIKE ${'%' + texto.toUpperCase() + '%'}`;
    return (await sql<Record<string, unknown>>`SELECT codapg, duplicata, idnf, dtvenc, obs, valor, nrparcela, codparceiro, codempresa AS idempresa, status_pendencia AS status,
        CASE status_pendencia WHEN 'D' THEN 'Nota Fiscal Devolvida' WHEN 'E' THEN 'Nota Fiscal Excluída' WHEN 'R' THEN 'Nota Fiscal Revertida'
             WHEN 'C' THEN 'Nota Fiscal Cancelada' WHEN 'N' THEN 'Nota Fiscal Denegada' END AS status_pendencia
        FROM apagar WHERE status_pendencia IS NOT NULL AND status_pendencia <> 'A' ${filtro} ORDER BY codapg LIMIT 500`.execute(db)).rows;
  }

  /** "Pendência Resolvida" (`ResolverPendencias` :4284): o aceite do operador — STATUS_PENDENCIA 'A', quem e quando */
  async resolverPendencia(id: number) {
    const op = currentTenant().operadorId ?? null;
    const r = await sql`UPDATE apagar SET status_pendencia = 'A', codoperador_aceite_pendencia = ${op}, data_aceite_pendencia = now()
        WHERE codapg = ${id} AND status_pendencia IS NOT NULL AND status_pendencia <> 'A'`.execute(this.dbp.forTenant() as AnyDB);
    if (!Number(r.numAffectedRows ?? 0)) throw new BusinessRuleError('APAGAR_SEM_PENDENCIA', { codapg: id });
    return { codapg: id, status_pendencia: 'A' as const, codoperador_aceite_pendencia: op };
  }

  /** o grupo "Lançamento centro custo" (`sqqCentroCusto`): as linhas do rateio do documento (V, e as D/E do desconto/embutidos) */
  async rateio(id: number) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const t = (await sql<Record<string, unknown>>`SELECT codgrupo FROM apagar WHERE codapg = ${id} AND codempresa = ${emp}`.execute(db)).rows[0];
    if (!t) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codapg: id });
    if (t.codgrupo == null) return [];
    return (await sql<Record<string, unknown>>`SELECT c.codcxapagar, c.codapg, c.codcc, c.valor, c.codgrupo, c.dtultimalteracao, coalesce(nullif(trim(c.tipo), ''), 'V') AS tipo,
        c.idsituacao_nf, p.desccodplc, p.descricao, s.descricao AS descsituacaonfcc
        FROM cx_apagar c LEFT JOIN plc p ON p.codplc = c.codcc LEFT JOIN situacao_nf s ON s.idsituacao_nf = c.idsituacao_nf
       WHERE c.codgrupo = ${num(t.codgrupo)} ORDER BY c.codcxapagar`.execute(db)).rows;
  }

  /**
   * O GRAVAR das linhas do centro de custo (`btnGravarClick` :1740-1895): cada linha com CC e valor; a soma dos CCs (V + E − D com
   * LANCAR_CENTROCUSTO_DESCACREJRS…='S', senão V + E + D) contra o total das parcelas (valor + embutidos − desconto) segundo
   * VERIFICA_CC_MAIOR_PARCELAS — B bloqueia, A pergunta "Deseja continuar?", N não confere; e o "Centro de custos incompleto!"
   * do título de uma parcela (CC < parcelas + pago) ou do parcelado sem CC. As linhas V do grupo são trocadas pelas novas.
   */
  async gravarRateio(id: number, dto: RateioApagarDto) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await this.titulo(trx, id, emp);
      ApagarService.travasDaTela(t);
      await assertPeriodoNaoFechado(trx, emp, t.dtvenda, 'bloq_apg');
      if (ApagarService.origemAutomatica(t) && (await this.cfg(trx, 'BLOQUEIA_CONTAS_PAGAR_ORIGEM_AUTO', emp)) === 'S') {
        throw new BusinessRuleError('TITULO_CAMPO_BLOQUEADO', { campo: 'codplc' });
      }
      for (const l of dto.linhas) {
        if (!(num(l.codcc) > 0)) throw new BusinessRuleError('APAGAR_CC_SEM_CC');
        if (num(l.valor) === 0) throw new BusinessRuleError('APAGAR_CC_SEM_VALOR');
        if (!(await sql`SELECT 1 FROM plc WHERE codplc = ${num(l.codcc)}`.execute(trx)).rows.length) throw new BusinessRuleError('CENTRO_CUSTO_NAO_ENCONTRADO', { codplc: l.codcc });
      }
      let codgrupo = t.codgrupo == null ? null : num(t.codgrupo);
      if (codgrupo == null) {
        codgrupo = await novoGrupo(trx);
        await sql`UPDATE apagar SET codgrupo = ${codgrupo} WHERE codapg = ${id}`.execute(trx);
      }
      const grupo = (await sql<Record<string, unknown>>`SELECT codapg, valor, desconto, vendor, adfornecedor, agrupamento FROM apagar WHERE codgrupo = ${codgrupo} ORDER BY codapg`.execute(trx)).rows;
      const totalParcelas = r2(grupo.reduce((s, g) => s + num(g.valor) + num(g.vendor) - num(g.desconto), 0));
      const de = (await sql<{ tipo: string; t: unknown }>`SELECT tipo, coalesce(sum(valor), 0) AS t FROM cx_apagar WHERE codgrupo = ${codgrupo} AND tipo IN ('D', 'E') GROUP BY tipo`.execute(trx)).rows;
      const somaD = num(de.find((x) => x.tipo === 'D')?.t);
      const somaE = num(de.find((x) => x.tipo === 'E')?.t);
      const lancaSeparado = (await this.cfg(trx, 'LANCAR_CENTROCUSTO_DESCACREJRS_CONTAS_PAGAR', emp)) === 'S';
      const somaV = dto.linhas.reduce((s, l) => s + num(l.valor), 0);
      const totalCC = r2(lancaSeparado ? somaV + somaE - somaD : somaV + somaE + somaD);
      const umaLinha = dto.linhas.length === 1;
      if (totalCC !== totalParcelas) {
        const modo = String((await this.cfg(trx, 'VERIFICA_CC_MAIOR_PARCELAS', emp)) ?? 'B').trim().toUpperCase();
        if (modo === 'B') {
          throw new BusinessRuleError('APAGAR_CC_DIFERENTE', { informado: totalCC, parcelas: totalParcelas }, umaLinha
            ? 'O valor informado no centro de custo é diferente do total das parcelas.'
            : 'A soma dos valores informados nos centros de custos é diferente do total das parcelas.');
        }
        if (modo === 'A' && !dto.confirmado) {
          throw new BusinessRuleError('APAGAR_CC_MAIOR_CONFIRMAR', { informado: totalCC, parcelas: totalParcelas }, umaLinha
            ? 'O valor informado no centro de custo é maior que o total das parcelas. Deseja continuar?'
            : 'A soma dos valores informados nos centros de custos é maior que o total das parcelas. Deseja continuar?');
        }
      }
      const pago = await this.totalPago(trx, codgrupo);
      if (t.adfornecedor !== 'S') {
        if (grupo.length === 1 && totalCC < r2(totalParcelas + pago)) throw new BusinessRuleError('APAGAR_CC_INCOMPLETO', { informado: totalCC, calculado: r2(totalParcelas + pago) });
        if (grupo.length > 1 && totalCC === 0) throw new BusinessRuleError('APAGAR_CC_INCOMPLETO', { informado: 0, calculado: totalParcelas });
      }
      await this.estornarSeContabilizado(trx, emp, t);
      await sql`DELETE FROM cx_apagar WHERE codgrupo = ${codgrupo} AND coalesce(nullif(trim(tipo), ''), 'V') = 'V'`.execute(trx);
      for (const l of dto.linhas) {
        await sql`INSERT INTO cx_apagar (codapg, codcc, valor, codgrupo, tipo, idsituacao_nf, dtultimalteracao)
            VALUES (${id}, ${num(l.codcc)}, ${r2(num(l.valor))}, ${codgrupo}, 'V', ${l.idsituacao_nf ?? null}, now())`.execute(trx);
      }
      // o CC do título (o que o Gravar da tela sincroniza) passa a ser o da linha única; com várias, fica o da 1ª linha
      await sql`UPDATE apagar SET codplc = ${num(dto.linhas[0].codcc)}, usultalteracao = ${op}, dtultimalteracao = now() WHERE codgrupo = ${codgrupo}`.execute(trx);
      await this.sincronizarDescontosEmbutidos(trx, emp, codgrupo);
      await refazerCaixaDoGrupo(trx, codgrupo, op);
      await this.integrarGrupo(trx, emp, codgrupo);
    });
    return this.rateio(id);
  }
}
