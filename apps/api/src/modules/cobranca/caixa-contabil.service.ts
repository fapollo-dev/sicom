import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

// CODORIGEM do fechamento de caixa no DIÁRIO (tocFechamentoCaixa, UIntegracaoContabil.pas:17-23).
const CODORIGEM_CAIXA = 17;
const SIT_SOBRA = 2019; // CONFIG_SOBRACAIXA → D 183 CAIXA CENTRAL / C 541 SOBRA DE CAIXA
const SIT_QUEBRA = 2002; // CONFIG_FALTACAIXA (quebra-sem-título) → D 148 / C 183 CAIXA CENTRAL

/**
 * CAIXA corte-2d — CONTÁBIL da quebra/sobra do fechamento. Reconstrói TIntegracaoFechamentoCaixa
 * (UIntegracaoContabilFechamentoCaixa.pas) para a DIVERGÊNCIA, no molde de `nf-contabilizacao.service`:
 * lança 1 partida no DIÁRIO pela situação (contas FIXAS da ITENS_INTEGRACAO_CONTABIL), gate
 * EMPRESAS.INTEGRACAO='AUTOMATICA', período contábil aberto, idempotente (caixa_sessao.contabilizado)
 * e reversível (estorno na reabertura). SOBRA→2019; QUEBRA-sem-título→2002.
 *
 * ADIADO (bloqueado por dependência ausente): fechamento-por-modalidade (situação 2010, crédito na
 * transitória 200 alimentada pelo PDV — fora do escopo retaguarda) e quebra-COM-título (785, delega
 * ao contábil de A Receber, inexistente no monorepo). Ver dossiê uCaixa.md §3.
 */
@Injectable()
export class CaixaContabilService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** período contábil FECHADO barra contabilização/estorno (mesma regra da NF). Fail-open. */
  private async assertPeriodoAberto(trx: AnyDB, emp: number, data: unknown): Promise<void> {
    if (data == null) return;
    const fechado = await trx
      .selectFrom('periodo_contabil').select('competencia_contabil')
      .where('codempresa', '=', emp).where('status', '=', 'S').where('bloq_nf', '=', 'S')
      .where('data_inicio', '<=', data).where('data_fim', '>=', data)
      .executeTakeFirst();
    if (fechado) throw new BusinessRuleError('PERIODO_FECHADO', { data });
  }

  /** as duas linhas (D/C) da IIC para a situação (contas fixas 'F'). */
  private async iicDC(trx: AnyDB, situacao: number): Promise<{ d: number; c: number }> {
    const iic = await trx
      .selectFrom('itens_integracao_contabil')
      .select(['natureza', 'tipo', 'codconta_contabil'])
      .where('codoperacao', '=', situacao)
      .execute();
    const d = (iic as Record<string, unknown>[]).find((x) => x.natureza === 'D');
    const c = (iic as Record<string, unknown>[]).find((x) => x.natureza === 'C');
    if (!d?.codconta_contabil || !c?.codconta_contabil) throw new BusinessRuleError('CONTAS_NAO_INFORMADAS', { situacao });
    return { d: Number(d.codconta_contabil), c: Number(c.codconta_contabil) };
  }

  /** Contabiliza a DIVERGÊNCIA do fechamento (sobra/quebra-sem-título) → 1 partida no DIÁRIO. */
  async contabilizarFechamento(codcaixa: number): Promise<{ codcaixa: number; situacao: number; contadebito: number; contacredito: number; valor: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const s = await trx
        .selectFrom('caixa_sessao')
        .select(['codcaixa', 'status', 'diferenca', 'codrcb_quebra', 'dtfechamento', 'contabilizado'])
        .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp)
        .forUpdate().executeTakeFirst();
      if (!s) throw new BusinessRuleError('CAIXA_NAO_ENCONTRADO', { codcaixa });
      if ((s as any).status !== 'F') throw new BusinessRuleError('CAIXA_NAO_FECHADO', { codcaixa });
      if ((s as any).contabilizado === 'S') throw new BusinessRuleError('CAIXA_JA_CONTABILIZADA', { codcaixa });

      // gate: só integra quando a empresa é AUTOMATICA (EMPRESAS.INTEGRACAO).
      const empc = await trx.selectFrom('empresas').select('integracao').where('idempresa', '=', emp).executeTakeFirst();
      if ((empc as any)?.integracao !== 'AUTOMATICA') throw new BusinessRuleError('INTEGRACAO_NAO_AUTOMATICA', { codcaixa });
      await this.assertPeriodoAberto(trx, emp, (s as any).dtfechamento);

      const dif = num((s as any).diferenca);
      if (dif === 0) throw new BusinessRuleError('CAIXA_SEM_DIFERENCA', { codcaixa }); // fechamento-2010 adiado (PDV)
      let situacao: number;
      if (dif > 0) situacao = SIT_SOBRA;
      else if ((s as any).codrcb_quebra == null) situacao = SIT_QUEBRA;
      else throw new BusinessRuleError('CAIXA_CONTABIL_QUEBRA_TITULO', { codcaixa }); // 785→AR contábil (adiado)

      const valor = Math.round(Math.abs(dif) * 100) / 100;
      const { d, c } = await this.iicDC(trx, situacao);
      const lote = await trx
        .insertInto('lote_contabil')
        .values({ desclote: `CAIXA ${codcaixa}`, datalote: (s as any).dtfechamento, codorigem: CODORIGEM_CAIXA, codempresa: emp })
        .returning('codlotecontabil').executeTakeFirstOrThrow();
      await trx
        .insertInto('diario')
        .values({
          datalan: (s as any).dtfechamento, contadebito: d, contacredito: c, valor,
          codorigem: CODORIGEM_CAIXA, idorigem: codcaixa, codoperacao: situacao, codempresa: emp,
          codhist: null, complemento: dif > 0 ? 'Sobra de caixa' : 'Quebra de caixa', codlote: Number((lote as any).codlotecontabil),
        })
        .execute();

      const upd = await trx
        .updateTable('caixa_sessao')
        .set({ contabilizado: 'S', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp)
        .where((eb: any) => eb.or([eb('contabilizado', '<>', 'S'), eb('contabilizado', 'is', null)]))
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('CAIXA_JA_CONTABILIZADA', { codcaixa });

      return { codcaixa, situacao, contadebito: d, contacredito: c, valor };
    });
  }

  /** Estorno standalone (endpoint): valida contabilizado + período, e reverte. */
  async estornarFechamento(codcaixa: number): Promise<{ codcaixa: number; estornado: true }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const s = await trx
        .selectFrom('caixa_sessao').select(['codcaixa', 'contabilizado', 'dtfechamento'])
        .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp)
        .forUpdate().executeTakeFirst();
      if (!s) throw new BusinessRuleError('CAIXA_NAO_ENCONTRADO', { codcaixa });
      if ((s as any).contabilizado !== 'S') throw new BusinessRuleError('CAIXA_NAO_CONTABILIZADA', { codcaixa });
      await this.assertPeriodoAberto(trx, emp, (s as any).dtfechamento);
      await this.estornarNoTrx(trx, emp, codcaixa, op);
      return { codcaixa, estornado: true as const };
    });
  }

  /**
   * Estorno do DIÁRIO do fechamento DENTRO de uma transação já aberta (usado pela REABERTURA do caixa).
   * DELETE por (CODORIGEM=17, IDORIGEM=codcaixa) + lotes órfãos + zera caixa_sessao.contabilizado.
   * Idempotente (no-op se não houver lançamento).
   */
  async estornarNoTrx(trx: AnyDB, emp: number, codcaixa: number, op: number | null): Promise<void> {
    const lotes = await trx
      .selectFrom('diario').select('codlote').distinct()
      .where('codorigem', '=', CODORIGEM_CAIXA).where('idorigem', '=', codcaixa).where('codempresa', '=', emp)
      .execute();
    await trx.deleteFrom('diario').where('codorigem', '=', CODORIGEM_CAIXA).where('idorigem', '=', codcaixa).where('codempresa', '=', emp).execute();
    const ids = (lotes as Record<string, unknown>[]).map((l) => Number(l.codlote)).filter((n) => Number.isFinite(n));
    if (ids.length) await trx.deleteFrom('lote_contabil').where('codlotecontabil', 'in', ids).execute();
    await trx
      .updateTable('caixa_sessao').set({ contabilizado: null, usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp).execute();
  }
}
