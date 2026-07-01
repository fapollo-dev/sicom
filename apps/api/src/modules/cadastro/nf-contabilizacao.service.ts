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
 * Corte-1 (fiel + bounded): LANÇAMENTO PRINCIPAL — uma linha DIARIO por SITUAÇÃO do rateio (nf_contabil),
 * com CONTADEBITO/CONTACREDITO resolvidos pela ITENS_INTEGRACAO_CONTABIL (D + C por CODOPERACAO). Cada
 * linha JÁ é uma partida balanceada (um débito + um crédito de mesmo valor), então o DIÁRIO gerado é
 * consistente — porém PARCIAL: as linhas de IMPOSTO (ICMS/PIS/COFINS/CMV, que no legado somam ao total)
 * ficam fase-2, então o total contabilizado no corte-1 é o do rateio principal, não o TOTALNF completo.
 * Gate EMPRESAS.INTEGRACAO='AUTOMATICA' (fonte-de-verdade legada). Idempotente (CAS em CONTABILIZADO) e
 * reversível (DELETE por CODORIGEM=12/IDORIGEM=codnf, espelha .Estornar L346). Endpoint EXPLÍCITO
 * (como faturar) — o auto-disparo no processar/transmitir e as linhas de imposto ficam fase-2
 * (spec: docs/.../uNF-F5b-contabil-diario.md). Contas TIPO='A' (parceiro/PLC) = fase-2.
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
        .select(['codnf', 'tipo', 'modelo', 'proc', 'cancelada', 'contabilizado', 'totalnf', 'nronf', 'dtcontabil', 'statusnfe'])
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
        .select(['nc.idsituacao_nf as idsituacao_nf'])
        .select((eb: AnyDB) => eb.fn.sum('nc.valor').as('total'))
        .where('nc.codnf', '=', codnf)
        .where(sql`coalesce(s.nao_realiza_integracao, 'N')`, '<>', 'S')
        .groupBy('nc.idsituacao_nf')
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

      let linhas = 0;
      let total = 0;
      for (const r of rateio as Record<string, unknown>[]) {
        const situacao = Number(r.idsituacao_nf);
        const valor = num(r.total);
        if (valor === 0) continue;
        // ITENS_INTEGRACAO_CONTABIL: 1 'D' + 1 'C' por CODOPERACAO (=situação).
        const iic = await trx
          .selectFrom('itens_integracao_contabil')
          .select(['natureza', 'tipo', 'codconta_contabil', 'codhistorico'])
          .where('codoperacao', '=', situacao)
          .execute();
        const d = (iic as Record<string, unknown>[]).find((x) => x.natureza === 'D');
        const c = (iic as Record<string, unknown>[]).find((x) => x.natureza === 'C');
        if (!d || !c) throw new BusinessRuleError('CONTAS_NAO_INFORMADAS', { codnf, situacao });
        const contadebito = this.contaFixa(d, situacao);
        const contacredito = this.contaFixa(c, situacao);
        await trx
          .insertInto('diario')
          .values({
            datalan: nf.dtcontabil,
            contadebito,
            contacredito,
            valor,
            codorigem: 12,
            idorigem: codnf,
            codoperacao: situacao,
            codempresa: emp,
            codhist: d.codhistorico ?? null,
            complemento: `Nota ${nf.tipo === 'E' ? 'de entrada' : 'de saída'} ${nf.nronf ?? codnf}`,
            codlote,
          })
          .execute();
        linhas++;
        total += valor;
      }

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
  private contaFixa(iic: Record<string, unknown>, situacao: number): number {
    if (iic.tipo !== 'F' || iic.codconta_contabil == null) {
      throw new BusinessRuleError('CONTA_AUTOMATICA_NAO_SUPORTADA', { situacao }); // TIPO='A' → F5b-fase2
    }
    return Number(iic.codconta_contabil);
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
