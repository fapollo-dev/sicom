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
  // CFOPs de venda que disparam o CMV (GetSQLCMVNF, UIntegracaoContabil.pas:427).
  private static readonly CMV_CFOP = new Set(['5102', '6102', '5402', '6402', '5403', '6403', '5405', '6405']);
  // Situação contábil do CMV. No legado vem de CONFIG_INTEGRACAO_CONTABIL.CONFIG_CUSTO_NF_VENDA
  // (UConfigIntegracaoContabil.pas); golden do cliente = 873. Constante até a camada de config
  // chave-valor (CONFIGURACOES_ESPECIFICAS) ser migrada (epic próprio, dossiê §10).
  private static readonly CMV_SITUACAO = 873;
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
      // (1) linhas PRINCIPAIS. O DIÁRIO real CONSOLIDA por situação: uma NF cujo rateio (CODCONTABILNF)
      // tem VÁRIOS centros de custo na MESMA situação gera UMA linha por situação (valor = Σ, codcc nulo).
      // Golden confirmado: CODNF 72296 sit 7 (rateio CC 246 + 3101) → 1 linha valor 41.521,49; idem 84938/
      // 80589 sit 468 (2 CC → 1 linha). O CODCC só influencia a RESOLUÇÃO do débito automático (TIPO='A',
      // ponte PLC): por isso resolvemos as contas por linha de rateio e CONSOLIDAMOS por (situação,
      // contadebito, contacredito), somando o valor. 'F' multi-CC → colapsa em 1 linha (fiel ao DIARIO);
      // 'A' com débito distinto por CC → preserva as linhas realmente distintas. Σ preservado.
      // (UIntegracaoContabil.pas: GetSQLSituacoesNF agrupa por IDSITUACAO_NF, L691-695.)
      const consolidado = new Map<string, { situacao: number; contadebito: number; contacredito: number; valor: number; codhist: unknown }>();
      for (const r of rateio as Record<string, unknown>[]) {
        const situacao = Number(r.idsituacao_nf);
        const codcc = r.codcc != null ? Number(r.codcc) : null;
        const valor = num(r.total);
        if (valor === 0) continue;
        const { d, c } = await this.iicDC(trx, codnf, situacao);
        const contadebito = await this.resolveConta(trx, d, 'D', ctx, codcc, situacao);
        const contacredito = await this.resolveConta(trx, c, 'C', ctx, codcc, situacao);
        const key = `${situacao}|${contadebito}|${contacredito}`;
        const acc = consolidado.get(key);
        if (acc) acc.valor = Math.round((acc.valor + valor) * 100) / 100;
        else consolidado.set(key, { situacao, contadebito, contacredito, valor, codhist: d.codhistorico ?? null });
      }
      for (const l of consolidado.values()) {
        await this.lancar(trx, ctx, l.situacao, l.contadebito, l.contacredito, l.valor, l.codhist, `Nota ${nf.tipo === 'E' ? 'de entrada' : 'de saída'} ${nf.nronf ?? codnf}`);
        linhas++;
        total += l.valor;
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
      // (3b) CMV — custo da venda (F5b-fase4b, GetSQLCMVNF UIntegracaoContabil:427): só SAÍDA, CFOP de
      // venda, valor = Σ(VL_CUSTO×FATOREMBAL×QUANTIDADE) do congelado. Situação 873 (config), D134/C147.
      if (ctx.tipo === 'S' && NfContabilizacaoService.CMV_CFOP.has(String(nf.cfop ?? ''))) {
        const cmvAgg = await trx
          .selectFrom('nf_prod')
          .select((eb: AnyDB) => eb.fn.sum(sql`coalesce(vl_custo * fatorembal * quantidade, 0)`).as('cmv'))
          .where('codnf', '=', codnf)
          .executeTakeFirst();
        const cmv = Math.round(num(cmvAgg?.cmv) * 100) / 100;
        if (cmv > 0) {
          const situacao = NfContabilizacaoService.CMV_SITUACAO;
          const { d, c } = await this.iicDC(trx, codnf, situacao);
          const cd = await this.resolveConta(trx, d, 'D', ctx, null, situacao);
          const cc = await this.resolveConta(trx, c, 'C', ctx, null, situacao);
          await this.lancar(trx, ctx, situacao, cd, cc, cmv, d.codhistorico ?? null, 'Custo de venda da nota de saída');
          linhas++;
        }
      }
      // (4) linhas de imposto PIS/COFINS FIEL (por-item, rate por-produto do catálogo PISCOFINS).
      linhas += await this.lancarPisCofins(trx, ctx, cfopRow, String(nf.cfop ?? ''));

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
   * PIS/COFINS FIEL (F5b-fase4b, GetSQLPisCofins UIntegracaoContabil.pas:527-683): valor POR-ITEM com
   * rate POR-PRODUTO do catálogo PISCOFINS, agregado por SITUAÇÃO (vinda do CFOP do item). 3 branches:
   *  - ENTRADA: item CFOP ∈ PC_CONFIG; base = (vrcusto·qtd−desc) + vricmst + depsacess + vroutrasdesp +
   *    frete/100·descItem + ipi/100·descItem; rate ALIQ_*_ENT de coalesce(nf_prod.idpiscofins, produtos.idpiscofins).
   *  - SAÍDA-específica (header CFOP ∈ {5202,6202,5411,6411}): rate ALIQ_*_SAI de PRODUTOS.idpiscofins (puro).
   *  - SAÍDA-geral (header CFOP ∉ {5202,6202,5411,6411,5929,6929,5927}): rate ALIQ_*_SAI de coalesce.
   * Item saída entra só se CFOP ∈ {5202,6202,5411,6411,5102,6102,5403,6403}. base por item arredondada a 2;
   * a soma por situação é feita no SQL (paridade exata com o golden). Adiado: regra parceiro-PF-CST (entrada),
   * drift histórico de VRCUSTO. Retorna o nº de linhas lançadas.
   */
  private async lancarPisCofins(
    trx: AnyDB,
    ctx: { tipo: string; codparceiro: number; dtcontabil: unknown; nronf: unknown; codnf: number; emp: number; codlote: number },
    cfopRow: Record<string, unknown> | undefined,
    headerCfop: string,
  ): Promise<number> {
    const entrada = ctx.tipo === 'E';
    const saidaEspecifica = !entrada && ['5202', '6202', '5411', '6411'].includes(headerCfop);
    // saída fora do escopo do razão (transferência/acordo) → não lança.
    if (!entrada && !saidaEspecifica && ['5929', '6929', '5927'].includes(headerCfop)) return 0;

    let linhas = 0;
    for (const imposto of ['pis', 'cofins'] as const) {
      // base por item (arredondada a 2), por sentido.
      const descItem = sql`((np.vrcusto - np.vrcusto * coalesce(np.desconto,0)/100) * np.quantidade)`;
      const baseSaida = sql`round(np.vrcusto * np.quantidade - np.vrcusto * np.quantidade * coalesce(np.desconto,0)/100, 2)`;
      const baseEntrada = sql`round((np.vrcusto * np.quantidade - np.vrcusto * np.quantidade * coalesce(np.desconto,0)/100) + coalesce(np.vricmst,0) + coalesce(np.depsacess,0) + coalesce(np.vroutrasdesp,0) + coalesce(np.frete,0)/100 * ${descItem} + coalesce(np.ipi,0)/100 * ${descItem}, 2)`;
      const base = entrada ? baseEntrada : baseSaida;
      // rate por-produto: saída-específica usa produtos.idpiscofins puro; senão coalesce(nf_prod, produtos).
      const pc = saidaEspecifica ? 'pcp' : 'pcc';
      const rateCol = entrada ? `aliq_${imposto}_ent` : `aliq_${imposto}_sai`;
      const rate = sql`coalesce(${sql.raw(pc)}.${sql.raw(rateCol)}, 0)`;
      // GATE do item = ALIQ_PIS>0 (o legado usa PIS p/ AMBOS os impostos, GetSQLPisCofins) — não aliq_cofins.
      const gate = sql`coalesce(${sql.raw(pc)}.${sql.raw(entrada ? 'aliq_pis_ent' : 'aliq_pis_sai')}, 0)`;
      const sitCol = entrada ? `situacao_${imposto}_entradas_nf` : `situacao_${imposto}_saidas_nf`;
      // allow-list de CFOP do item (+ blacklist de entrada, GetSQLPisCofins:586).
      const itemCfopOk = entrada
        ? sql`np.cfop in (select cfop from pc_config) and np.cfop not in ('1407','1556','1653','1908','1910','2556','2910','1949')`
        : sql`np.cfop in ('5202','6202','5411','6411','5102','6102','5403','6403')`;

      // legado: CAST(SUM(base×rate) AS NUMERIC(15,2)) POR (CODNF, CFOP), depois o loop soma as parcelas
      // JÁ ARREDONDADAS por situação. Replicamos: round por (situação, cfop) no SQL, soma por situação no JS.
      const grupos = await trx
        .selectFrom('nf_prod as np')
        .innerJoin('produtos as p', 'p.idproduto', 'np.codproduto')
        .leftJoin('piscofins as pcc', (j: AnyDB) => j.onRef('pcc.idpiscofins', '=', sql`coalesce(np.idpiscofins, p.idpiscofins)`))
        .leftJoin('piscofins as pcp', 'pcp.idpiscofins', 'p.idpiscofins')
        .innerJoin('cfop as cf', 'cf.codcfop', 'np.cfop')
        .select([
          sql`cf.${sql.raw(sitCol)}`.as('situacao'),
          sql<number>`round(coalesce(sum(${base} * ${rate} / 100), 0), 2)`.as('valor'),
        ])
        .where('np.codnf', '=', ctx.codnf)
        .where(sql`p.idpiscofins`, '>', 0)
        .where(gate as AnyDB, '>', 0)
        .where(itemCfopOk as AnyDB)
        .where(sql`cf.${sql.raw(sitCol)}`, 'is not', null)
        .groupBy([sql`cf.${sql.raw(sitCol)}`, sql`np.cfop`]) // por (situação, CFOP) — arredonda a parcela do CFOP
        .execute();

      // soma as parcelas (já arredondadas por CFOP) por SITUAÇÃO.
      const porSituacao = new Map<number, number>();
      for (const g of grupos as Record<string, unknown>[]) {
        const situacao = Number(g.situacao);
        if (!situacao) continue;
        porSituacao.set(situacao, Math.round((((porSituacao.get(situacao) ?? 0) + num(g.valor)) * 100)) / 100);
      }
      for (const [situacao, valor] of porSituacao) {
        if (valor <= 0) continue;
        const { d, c } = await this.iicDC(trx, ctx.codnf, situacao);
        const cd = await this.resolveConta(trx, d, 'D', ctx, null, situacao);
        const cc = await this.resolveConta(trx, c, 'C', ctx, null, situacao);
        await this.lancar(trx, ctx, situacao, cd, cc, valor, d.codhistorico ?? null, `${imposto.toUpperCase()} nota de ${entrada ? 'entrada' : 'saída'} ${ctx.nronf ?? ctx.codnf}`);
        linhas++;
      }
    }
    return linhas;
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
