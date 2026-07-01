import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = any;
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/**
 * NF — Fase 5b: CONTÁBIL / DIÁRIO (partida dobrada). O EFEITO da F5 (que só armazenava o rateio
 * CODCONTABILNF, sem efeito). Reconstrói o LancaDiarioContabil legado (motor em package externo,
 * `TIntegracaoContabilNotaFiscal.Integrar`, UIntegracaoContabil.pas:703) confrontado com o DIARIO real.
 *
 * Lançamentos: (1) PRINCIPAL — uma linha DIARIO por (SITUAÇÃO, centro de custo) do rateio (nf_contabil),
 * com CONTADEBITO/CONTACREDITO pela ITENS_INTEGRACAO_CONTABIL; TIPO='F' (fixa) ou 'A' (crédito=parceiro
 * CODCONTABIL_FOR/CODCONTABIL, débito=ponte PLC.CODCONTABIL via CODCC). (2) IMPOSTO PIS/COFINS — situação
 * do CFOP, base=TOTALNF × rate legal LR não-cumulativo (PIS 1,65 / COFINS 7,6), golden NF 72044/71822.
 * Cada linha é uma partida balanceada (um débito + um crédito de mesmo valor). Gate EMPRESAS.INTEGRACAO=
 * 'AUTOMATICA'. Idempotente (CAS em CONTABILIZADO) e reversível (DELETE por CODORIGEM=12/IDORIGEM, .Estornar
 * L346). Endpoint EXPLÍCITO (como faturar). **Fase-3:** linha de ICMS próprio, CMV (saída), auto-disparo no
 * processar/transmitir, período fechado, PC_CONFIG (base/rate por regime). Spec: uNF-F5b-contabil-diario.md.
 */
@Injectable()
export class NfContabilizacaoService {
  private readonly logger = new Logger(NfContabilizacaoService.name);
  constructor(private readonly dbp: DatabaseProvider) {}

  async contabilizar(codnf: number): Promise<{ codnf: number; linhas: number; codlote: number; total: number }> {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = await trx
        .selectFrom('nf')
        .select(['codnf', 'tipo', 'modelo', 'proc', 'cancelada', 'contabilizado', 'totalnf', 'totalicm', 'nronf', 'dtcontabil', 'statusnfe', 'codparceiro', 'cfop'])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      // elegibilidade (GetSQLNF, UIntegracaoContabil.pas:500-507).
      if (nf.cancelada === 'S' || nf.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA', { codnf });
      if (nf.proc !== 'S') throw new BusinessRuleError('NF_NAO_PROCESSADA', { codnf }); // financeiro/contábil nascem processados
      if (num(nf.totalnf) <= 0) throw new BusinessRuleError('NF_SEM_VALOR', { codnf });
      if (String(nf.nronf ?? '') === '000000') throw new BusinessRuleError('NF_SEM_NUMERO', { codnf }); // GetSQLNF:506
      if (!nf.dtcontabil) throw new BusinessRuleError('NF_SEM_DTCONTABIL', { codnf }); // datalan NOT NULL no diario
      // saída NFe (modelo 55) só contabiliza depois de AUTORIZADA (GetSQLNF:502).
      if (nf.tipo === 'S' && Number(nf.modelo) === 55 && nf.statusnfe !== 'P') throw new BusinessRuleError('NF_NAO_AUTORIZADA', { codnf });
      if (nf.contabilizado === 'S') throw new BusinessRuleError('NF_JA_CONTABILIZADA', { codnf });

      // gate: só integra quando a empresa é AUTOMATICA (EMPRESA.INTEGRACAO, udmNF.pas:7778).
      const empc = await trx.selectFrom('empresas').select('integracao').where('idempresa', '=', emp).executeTakeFirst();
      if (empc?.integracao !== 'AUTOMATICA') throw new BusinessRuleError('INTEGRACAO_NAO_AUTOMATICA', { codnf });
      await this.assertPeriodoAberto(trx, emp, nf.dtcontabil); // período contábil fechado barra contabilização

      // rateio por SITUAÇÃO (nf_contabil, Σ valor) — a base das linhas principais do DIÁRIO. Exclui
      // situações marcadas SITUACAO_NF.NAO_REALIZA_INTEGRACAO='S' (GetSQLNF:507).
      const rateio = await trx
        .selectFrom('nf_contabil as nc')
        .innerJoin('situacao_nf as s', 's.idsituacao_nf', 'nc.idsituacao_nf')
        .select(['nc.idsituacao_nf as idsituacao_nf', 'nc.codcc as codcc'])
        .select((eb: AnyDB) => eb.fn.sum('nc.valor').as('total'))
        .where('nc.codnf', '=', codnf)
        .where(sql`coalesce(s.nao_realiza_integracao, 'N')`, '<>', 'S')
        .groupBy(['nc.idsituacao_nf', 'nc.codcc']) // codcc entra p/ resolver o débito automático (ponte PLC)
        .execute();
      if (!rateio.length) throw new BusinessRuleError('NF_SEM_RATEIO_CONTABIL', { codnf });

      // 1 lote por NF (corte-1). LOTE_CONTABIL de fechamento = fase-2.
      const lote = await trx
        .insertInto('lote_contabil')
        .values({
          desclote: `NF ${nf.nronf ?? codnf}`,
          datalote: nf.dtcontabil,
          codorigem: 12, // Nota Fiscal
          codempresa: emp,
        })
        .returning('codlotecontabil')
        .executeTakeFirstOrThrow();
      const codlote = Number(lote.codlotecontabil);

      const ctx = { tipo: String(nf.tipo), codparceiro: Number(nf.codparceiro), dtcontabil: nf.dtcontabil, nronf: nf.nronf, codnf, emp, codlote };
      let linhas = 0;
      let total = 0;
      // (1) linhas PRINCIPAIS: uma por (situação, centro de custo) do rateio.
      for (const r of rateio as Record<string, unknown>[]) {
        const situacao = Number(r.idsituacao_nf);
        const codcc = r.codcc != null ? Number(r.codcc) : null;
        const valor = num(r.total);
        if (valor === 0) continue;
        const { d, c } = await this.iicDC(trx, codnf, situacao);
        const contadebito = await this.resolveConta(trx, d, 'D', ctx, codcc, situacao);
        const contacredito = await this.resolveConta(trx, c, 'C', ctx, codcc, situacao);
        await this.lancar(trx, ctx, situacao, contadebito, contacredito, valor, d.codhistorico ?? null, `Nota ${nf.tipo === 'E' ? 'de entrada' : 'de saída'} ${nf.nronf ?? codnf}`);
        linhas++;
        total += valor;
      }

      // (2) linhas de IMPOSTO PIS/COFINS (situação vem do CFOP; rate legal LR não-cumulativo; base=totalnf,
      // golden NF 72044/71822). ICMS-line/CMV = fase-3. Só lança se o CFOP tiver a situação + IIC.
      const cfopRow = await trx
        .selectFrom('cfop')
        .select([
          'situacao_pis_entradas_nf', 'situacao_pis_saidas_nf', 'situacao_cofins_entradas_nf', 'situacao_cofins_saidas_nf',
          'situacao_icms_entradas_nf', 'situacao_icms_saidas_nf',
        ])
        .where('codcfop', '=', String(nf.cfop ?? ''))
        .executeTakeFirst();
      // (3) linha de ICMS próprio (F5b-fase3). Valor = Σ dos ITENS (NÃO o header NF.TOTALICM): soma
      // VRICM só de itens TRIBUTADOS (ALIQUOTA começa com 'T') e de CFOP NÃO-cupom (PROC_CUPOM≠'S') —
      // fórmula exata de GetSQLNF (UIntegracaoContabil.pas:483-492). O header inclui cupom/não-'T' e
      // diverge (~8% + omite NFs de header-zero que têm ICMS real). Golden: 500/500 pela soma dos itens.
      const icmsAgg = await trx
        .selectFrom('nf_prod as np')
        .leftJoin('cfop as cf', 'cf.codcfop', 'np.cfop')
        .select((eb: AnyDB) =>
          eb.fn
            .sum(sql`case when coalesce(cf.proc_cupom, 'N') = 'S' then 0 when substr(np.aliquota, 1, 1) = 'T' then np.vricm else 0 end`)
            .as('vicms'),
        )
        .where('np.codnf', '=', codnf)
        .executeTakeFirst();
      const vicms = Math.round(num(icmsAgg?.vicms) * 100) / 100;
      const sitIcms = cfopRow?.[ctx.tipo === 'E' ? 'situacao_icms_entradas_nf' : 'situacao_icms_saidas_nf'];
      if (vicms > 0) {
        // ICMS devido mas CFOP sem situação configurada → erro de config (GetSQLNF aborta na nota-única).
        if (sitIcms == null) throw new BusinessRuleError('ICMS_SEM_SITUACAO', { codnf, cfop: nf.cfop });
        const situacao = Number(sitIcms);
        const { d, c } = await this.iicDC(trx, codnf, situacao);
        const contadebito = await this.resolveConta(trx, d, 'D', ctx, null, situacao);
        const contacredito = await this.resolveConta(trx, c, 'C', ctx, null, situacao);
        await this.lancar(trx, ctx, situacao, contadebito, contacredito, vicms, d.codhistorico ?? null, `ICMS NF ${nf.nronf ?? codnf}`);
        linhas++;
      }
      // (4) linhas de imposto PIS/COFINS (base=totalnf×rate — golden ENTRADA; base de saída por regime = fase-4).
      linhas += await this.lancarImposto(trx, ctx, cfopRow, num(nf.totalnf), 'pis', 1.65);
      linhas += await this.lancarImposto(trx, ctx, cfopRow, num(nf.totalnf), 'cofins', 7.6);

      const upd = await trx
        .updateTable('nf')
        .set({ contabilizado: 'S', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .where((eb: AnyDB) => eb.or([eb('contabilizado', '<>', 'S'), eb('contabilizado', 'is', null)]))
        .executeTakeFirst();
      if (Number(upd?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('NF_JA_CONTABILIZADA', { codnf });

      return { codnf, linhas, codlote, total: Math.round(total * 100) / 100 };
    });
  }

  /** conta fixa (TIPO='F'). TIPO='A' (parceiro/PLC automático) = fase-2 (não seedado no corte-1). */
  /**
   * AUTO-DISPARO best-effort (F5b-fase3): contabiliza se a NF for elegível; engole as regras de
   * NÃO-elegibilidade (não-AUTOMATICA / sem rateio / já contabilizada / não-autorizada) — espelha o
   * legado, que integra no processar/envio e apenas AVISA se não integrar (não aborta o fluxo).
   * Erros técnicos (não-BusinessRuleError) sobem. Chamado após processar (entrada) e transmitir (saída).
   */
  async tentarContabilizar(codnf: number): Promise<void> {
    try {
      await this.contabilizar(codnf);
    } catch (e) {
      if (!(e instanceof BusinessRuleError)) throw e;
      // best-effort: regra de negócio (inelegível/config) NÃO aborta o processar/envio — só deixa
      // trilha (o legado avisa no log de integração). O operador pode contabilizar explicitamente depois.
      this.logger.warn(`auto-disparo contábil pulou NF ${codnf}: ${e.code ?? e.message}`);
    }
  }

  /**
   * Barra contabilização/estorno quando a DTCONTABIL cai em período contábil FECHADO para NF
   * (PERIODO_CONTABIL: STATUS='S' AND BLOQ_NF='S', data em [DATA_INICIO, DATA_FIM]). Fiel ao legado
   * FECHADO por dia (uNF.pas:4565) / CHAVEAMENTO_PERIODO por data-limite (UIntegracaoContabil.pas:286).
   * Fail-open: sem período fechado casando a data → segue (CHAVEAMENTO_PERIODO NULL = nada fechado).
   */
  private async assertPeriodoAberto(trx: AnyDB, emp: number, dtcontabil: unknown): Promise<void> {
    if (dtcontabil == null) return;
    const fechado = await trx
      .selectFrom('periodo_contabil')
      .select('competencia_contabil')
      .where('codempresa', '=', emp)
      .where('status', '=', 'S')
      .where('bloq_nf', '=', 'S')
      .where('data_inicio', '<=', dtcontabil)
      .where('data_fim', '>=', dtcontabil)
      .executeTakeFirst();
    if (fechado) throw new BusinessRuleError('PERIODO_FECHADO', { dtcontabil, competencia: fechado.competencia_contabil });
  }

  /** as duas linhas (D e C) da IIC para a situação — 1 'D' + 1 'C' por CODOPERACAO no legado. */
  private async iicDC(trx: AnyDB, codnf: number, situacao: number): Promise<{ d: Record<string, unknown>; c: Record<string, unknown> }> {
    const iic = await trx
      .selectFrom('itens_integracao_contabil')
      .select(['natureza', 'tipo', 'codconta_contabil', 'codhistorico'])
      .where('codoperacao', '=', situacao)
      .execute();
    const d = (iic as Record<string, unknown>[]).find((x) => x.natureza === 'D');
    const c = (iic as Record<string, unknown>[]).find((x) => x.natureza === 'C');
    if (!d || !c) throw new BusinessRuleError('CONTAS_NAO_INFORMADAS', { codnf, situacao });
    return { d, c };
  }

  /**
   * Resolve a conta contábil de uma linha IIC. TIPO='F' → conta fixa (codconta_contabil). TIPO='A':
   * crédito automático = conta do PARCEIRO (entrada→CODCONTABIL_FOR / saída→CODCONTABIL, GetSQLCodContabilParceiro
   * L457); débito automático = ponte gerencial→formal PLC.CODCONTABIL a partir do CODCC (GetSQLCodContabilNF L446).
   */
  private async resolveConta(
    trx: AnyDB,
    iic: Record<string, unknown>,
    natureza: 'D' | 'C',
    ctx: { tipo: string; codparceiro: number },
    codcc: number | null,
    situacao: number,
  ): Promise<number> {
    if (iic.tipo === 'F') {
      if (iic.codconta_contabil == null) throw new BusinessRuleError('CONTAS_NAO_INFORMADAS', { situacao });
      return Number(iic.codconta_contabil);
    }
    if (natureza === 'C') {
      const p = await trx.selectFrom('parceiros').select(['codcontabil', 'codcontabil_for']).where('codparceiro', '=', ctx.codparceiro).executeTakeFirst();
      const conta = ctx.tipo === 'E' ? p?.codcontabil_for : p?.codcontabil; // entrada→fornecedor / saída→cliente
      const n = Number(conta);
      if (!conta || !Number.isFinite(n)) throw new BusinessRuleError('CONTA_PARCEIRO_NAO_DEFINIDA', { situacao, codparceiro: ctx.codparceiro });
      return n;
    }
    // débito automático → ponte PLC (CODCC → PLC.CODCONTABIL).
    if (codcc == null) throw new BusinessRuleError('CONTA_AUTOMATICA_NAO_SUPORTADA', { situacao });
    const plc = await trx.selectFrom('plc').select('codcontabil').where('codplc', '=', codcc).executeTakeFirst();
    if (plc?.codcontabil == null) throw new BusinessRuleError('CONTA_PLC_NAO_DEFINIDA', { situacao, codcc });
    return Number(plc.codcontabil);
  }

  /** insere uma linha no DIÁRIO (CODORIGEM=12 Nota Fiscal). */
  private async lancar(
    trx: AnyDB,
    ctx: { dtcontabil: unknown; codnf: number; emp: number; codlote: number },
    situacao: number,
    contadebito: number,
    contacredito: number,
    valor: number,
    codhist: unknown,
    complemento: string,
  ): Promise<void> {
    await trx
      .insertInto('diario')
      .values({
        datalan: ctx.dtcontabil,
        contadebito,
        contacredito,
        valor,
        codorigem: 12,
        idorigem: ctx.codnf,
        codoperacao: situacao,
        codempresa: ctx.emp,
        codhist: codhist ?? null,
        complemento,
        codlote: ctx.codlote,
      })
      .execute();
  }

  /**
   * Linha de imposto PIS/COFINS: valor = base(totalnf) × rate% (golden LR não-cumulativo: PIS 1,65 /
   * COFINS 7,6 — NF 72044/71822). Situação vem do CFOP (por sentido). Só lança se o CFOP tiver a situação
   * e a IIC existir. Rate/base fixos = fase-3 (PC_CONFIG/regime). Retorna 1 se lançou, 0 senão.
   */
  private async lancarImposto(
    trx: AnyDB,
    ctx: { tipo: string; codparceiro: number; dtcontabil: unknown; nronf: unknown; codnf: number; emp: number; codlote: number },
    cfopRow: Record<string, unknown> | undefined,
    totalnf: number,
    imposto: 'pis' | 'cofins',
    rate: number,
  ): Promise<number> {
    const col = ctx.tipo === 'E' ? `situacao_${imposto}_entradas_nf` : `situacao_${imposto}_saidas_nf`;
    const situacao = cfopRow?.[col] != null ? Number(cfopRow[col]) : null;
    if (situacao == null) return 0;
    const valor = Math.round(totalnf * rate) / 100; // totalnf × rate/100, 2 casas
    if (valor <= 0) return 0;
    const { d, c } = await this.iicDC(trx, ctx.codnf, situacao);
    const contadebito = await this.resolveConta(trx, d, 'D', ctx, null, situacao);
    const contacredito = await this.resolveConta(trx, c, 'C', ctx, null, situacao);
    await this.lancar(trx, ctx, situacao, contadebito, contacredito, valor, d.codhistorico ?? null, `${imposto.toUpperCase()} NF ${ctx.nronf ?? ctx.codnf}`);
    return 1;
  }

  /** estorno do DIÁRIO (endpoint explícito). Espelha .Estornar (UIntegracaoContabil.pas:346). */
  async estornarContabilizacao(codnf: number): Promise<void> {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = await trx
        .selectFrom('nf')
        .select(['codnf', 'contabilizado', 'dtcontabil'])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      if (nf.contabilizado !== 'S') throw new BusinessRuleError('NF_NAO_CONTABILIZADA', { codnf });
      await this.assertPeriodoAberto(trx, emp, nf.dtcontabil); // não estorna em período fechado
      await this.estornarNoTrx(trx, codnf, emp, op);
    });
  }

  /**
   * Estorno do DIÁRIO DENTRO de uma transação já aberta (usado pelo cancelamento da NFe). Deleta as
   * linhas por (CODORIGEM=12, IDORIGEM=codnf) + os lotes órfãos e reabre CONTABILIZADO. Idempotente.
   */
  async estornarNoTrx(trx: AnyDB, codnf: number, emp: number, op: number | null): Promise<void> {
    const lotes = await trx
      .selectFrom('diario')
      .select('codlote')
      .distinct()
      .where('codorigem', '=', 12)
      .where('idorigem', '=', codnf)
      .where('codempresa', '=', emp)
      .execute();
    await trx.deleteFrom('diario').where('codorigem', '=', 12).where('idorigem', '=', codnf).where('codempresa', '=', emp).execute();
    const ids = (lotes as Record<string, unknown>[]).map((l) => Number(l.codlote)).filter((n) => Number.isFinite(n));
    if (ids.length) await trx.deleteFrom('lote_contabil').where('codlotecontabil', 'in', ids).execute();
    await trx
      .updateTable('nf')
      .set({ contabilizado: null, usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codnf', '=', codnf)
      .where('idempresa', '=', emp)
      .execute();
  }
}
