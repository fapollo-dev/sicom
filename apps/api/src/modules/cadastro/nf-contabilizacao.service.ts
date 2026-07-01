import { Injectable } from '@nestjs/common';
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
  constructor(private readonly dbp: DatabaseProvider) {}

  async contabilizar(codnf: number): Promise<{ codnf: number; linhas: number; codlote: number; total: number }> {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = await trx
        .selectFrom('nf')
        .select(['codnf', 'tipo', 'modelo', 'proc', 'cancelada', 'contabilizado', 'totalnf', 'nronf', 'dtcontabil', 'statusnfe', 'codparceiro', 'cfop'])
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
        .select(['situacao_pis_entradas_nf', 'situacao_pis_saidas_nf', 'situacao_cofins_entradas_nf', 'situacao_cofins_saidas_nf'])
        .where('codcfop', '=', String(nf.cfop ?? ''))
        .executeTakeFirst();
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
        .select(['codnf', 'contabilizado'])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      if (nf.contabilizado !== 'S') throw new BusinessRuleError('NF_NAO_CONTABILIZADA', { codnf });
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
