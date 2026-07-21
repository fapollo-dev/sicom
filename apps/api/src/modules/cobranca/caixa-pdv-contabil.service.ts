import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// CODORIGEM do fechamento de caixa no DIÁRIO (tocFechamentoCaixa, UIntegracaoContabil.pas:17). Situação 2010.
const CODORIGEM_FECHAMENTO = 17;
const SIT_FECHAMENTO = 2010;

/**
 * CAIXA 2d-c — CONTÁBIL do FECHAMENTO DE CAIXA do PDV por FORMA DE PAGAMENTO (corte-3 do épico PDV/VENDAS).
 * Reconstrói TIntegracaoFechamentoCaixa (UIntegracaoContabilFechamentoCaixa): por CODGRUPO (o fechamento do
 * turno) e por forma, lança no DIÁRIO 1 partida — D <conta da forma (FORMAS_PGTO.CODPLANOCONTAS)> / C 200
 * VENDAS TRANSITORIAS (IIC situação 2010, C fixa / D automática pela forma). Líquido = Σ(VALOR − TROCO).
 * Ignora forma DESTINO='QUE' (quebra) e forma sem conta contábil. Gate EMPRESAS.INTEGRACAO='AUTOMATICA' +
 * período contábil aberto; idempotente (cx_vendas.contabilizado) e reversível por CODGRUPO.
 *
 * A forma casa por MODALIDADE=OPERACAO (CX_VENDAS.CODOPERADORA é o OPERADOR, não a forma). Divergência
 * consciente: contabiliza o LÍQUIDO do PDV (CX_VENDAS), não o CAIXA CONFERIDO do operador; a conferência
 * (conferido≠PDV → quebra/sobra) é o fluxo do caixa_sessao (situação 2019/2002), separado.
 *
 * ADIADO (documentado): DEBITO_CREDITO por linha + filtro de OPERACAO sangria/suprimento/desconto no PDV,
 * conferência CAIXA×CX_VENDAS (SALDO_OPERADOR), quebra-COM-título (situação 785). Ver dossiê uCaixa.md.
 */
@Injectable()
export class CaixaPdvContabilService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** período contábil FECHADO (status='S' + bloq_nf) barra a contabilização/estorno. */
  private async assertPeriodoAberto(trx: AnyDB, emp: number, data: unknown): Promise<void> {
    if (data == null) return;
    const fechado = await trx
      .selectFrom('periodo_contabil').select('competencia_contabil')
      .where('codempresa', '=', emp).where('status', '=', 'S').where('bloq_nf', '=', 'S')
      .where('data_inicio', '<=', data as never).where('data_fim', '>=', data as never)
      .executeTakeFirst();
    if (fechado) throw new BusinessRuleError('PERIODO_FECHADO', { data });
  }

  /**
   * Contabiliza os fechamentos (CODGRUPO) do PDV não contabilizados no período. Por (grupo, forma): D conta da
   * forma / C 200, valor = Σ(VALOR − TROCO). Marca o grupo inteiro como contabilizado. Retorna o resumo.
   */
  async contabilizar(dtini: string, dtfim: string): Promise<{ grupos: number; lancamentos: number; total: number }> {
    const emp = this.emp();
    if (!dtini || dtini === '' || !dtfim || dtfim === '') throw new BusinessRuleError('RAZAO_PERIODO_OBRIGATORIO');
    if (dtini > dtfim) throw new BusinessRuleError('RAZAO_PERIODO_INVALIDO', { dtini, dtfim });
    const d0 = String(dtini).slice(0, 10);
    const dfimNext = new Date(`${String(dtfim).slice(0, 10)}T00:00:00Z`);
    dfimNext.setUTCDate(dfimNext.getUTCDate() + 1);
    const d1 = dfimNext.toISOString().slice(0, 10);

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const empc = await trx.selectFrom('empresas').select('integracao').where('idempresa', '=', emp).executeTakeFirst();
      if ((empc as any)?.integracao !== 'AUTOMATICA') throw new BusinessRuleError('INTEGRACAO_NAO_AUTOMATICA');

      // IIC 2010: C fixa (conta 200 + codhist) e D automática (resolvida pela forma). Sem ela → não configurada.
      const iic = (await trx.selectFrom('itens_integracao_contabil').select(['natureza', 'codconta_contabil', 'codhistorico']).where('codoperacao', '=', SIT_FECHAMENTO).execute()) as Array<{ natureza: string; codconta_contabil: number | null; codhistorico: number | null }>;
      const cRow = iic.find((r) => r.natureza === 'C');
      if (!cRow?.codconta_contabil) throw new BusinessRuleError('IIC_FECHAMENTO_NAO_CONFIGURADA', { situacao: SIT_FECHAMENTO });
      const contaCredito = Number(cRow.codconta_contabil);
      const codhist = cRow.codhistorico ?? null;

      // LOCK: trava as linhas do período não contabilizadas (serializa `contabilizar` concorrente → sem double-post).
      await trx.selectFrom('cx_vendas').select('codcxvendas')
        .where('idempresa', '=', emp).where('codgrupo', 'is not', null).where(sql`coalesce(contabilizado,'N')`, '<>', 'S')
        .where(sql`data`, '>=', d0).where(sql`data`, '<', d1).forUpdate().execute();

      // FAIL-LOUD (fiel ao rContaAnaliticaNaoInformada do legado): pagamento NÃO-QUE sem forma casada ou sem conta
      // → ABORTA tudo (nada é lançado/marcado; o operador configura a conta e reprocessa). A forma casa por
      // MODALIDADE=OPERACAO (CX_VENDAS.CODOPERADORA é o OPERADOR, não a forma — UIntegracaoContabilFechamentoCaixa).
      const naoResolvida = await trx
        .selectFrom('cx_vendas as cv')
        .leftJoin('formas_pgto as f', (j: any) => j.onRef('f.modalidade', '=', 'cv.operacao').onRef('f.idempresa', '=', 'cv.idempresa'))
        .select('cv.codcxvendas')
        .where('cv.idempresa', '=', emp).where('cv.codgrupo', 'is not', null).where(sql`coalesce(cv.contabilizado,'N')`, '<>', 'S')
        .where(sql`cv.data`, '>=', d0).where(sql`cv.data`, '<', d1)
        .where((eb: any) => eb.or([eb('f.idpgto', 'is', null), eb.and([eb(sql`coalesce(f.destino,'')`, '<>', 'QUE'), eb('f.codplanocontas', 'is', null)])]))
        .limit(1).executeTakeFirst();
      if (naoResolvida) throw new BusinessRuleError('CONTA_FORMA_NAO_INFORMADA');

      // por (grupo, conta-da-forma): líquido do período; só forma com conta e DESTINO<>'QUE', grupo FECHADO.
      const grupos = (await trx
        .selectFrom('cx_vendas as cv')
        .innerJoin('formas_pgto as f', (j: any) => j.onRef('f.modalidade', '=', 'cv.operacao').onRef('f.idempresa', '=', 'cv.idempresa'))
        .select([
          'cv.codgrupo as codgrupo',
          'f.codplanocontas as conta',
          sql`to_char(max(cv.data),'YYYY-MM-DD')`.as('datalan'),
          sql`round(sum(coalesce(cv.valor,0) - coalesce(cv.troco,0)),2)`.as('liquido'),
        ])
        .where('cv.idempresa', '=', emp)
        .where('cv.codgrupo', 'is not', null)
        .where(sql`coalesce(cv.contabilizado,'N')`, '<>', 'S')
        .where(sql`coalesce(f.destino,'')`, '<>', 'QUE')
        .where('f.codplanocontas', 'is not', null)
        .where(sql`cv.data`, '>=', d0)
        .where(sql`cv.data`, '<', d1)
        .groupBy(['cv.codgrupo', 'f.codplanocontas'])
        .having(sql`round(sum(coalesce(cv.valor,0) - coalesce(cv.troco,0)),2)`, '<>', 0)
        .execute()) as Array<{ codgrupo: number; conta: number; datalan: string; liquido: unknown }>;

      let lancamentos = 0;
      let total = 0;
      const processados = new Set<number>();
      for (const g of grupos) {
        const valor = r2(Number(g.liquido) || 0);
        await this.assertPeriodoAberto(trx, emp, g.datalan);
        const lote = await trx
          .insertInto('lote_contabil')
          .values({ desclote: `Fechamento caixa PDV grupo ${g.codgrupo}`, datalote: g.datalan, codorigem: CODORIGEM_FECHAMENTO, codempresa: emp })
          .returning('codlotecontabil').executeTakeFirstOrThrow();
        await trx.insertInto('diario').values({
          datalan: g.datalan, contadebito: Number(g.conta), contacredito: contaCredito, valor,
          codorigem: CODORIGEM_FECHAMENTO, idorigem: Number(g.codgrupo), codoperacao: SIT_FECHAMENTO, codempresa: emp,
          codhist, complemento: 'Fechamento de caixa PDV', codlote: Number((lote as any).codlotecontabil),
        }).execute();
        lancamentos++;
        total = r2(total + valor);
        processados.add(Number(g.codgrupo));
      }
      // marca como contabilizado TODAS as linhas do período (grupo fechado): o fail-loud garantiu que toda forma
      // não-QUE tinha conta → tudo lançado; QUE fica só marcada. Filtro de data evita marcar linhas de outro período.
      await trx.updateTable('cx_vendas').set({ contabilizado: 'S' } as any)
        .where('idempresa', '=', emp).where('codgrupo', 'is not', null).where(sql`coalesce(contabilizado,'N')`, '<>', 'S')
        .where(sql`data`, '>=', d0).where(sql`data`, '<', d1).execute();
      return { grupos: processados.size, lancamentos, total };
    });
  }

  /** estorna a contabilização de um fechamento (CODGRUPO): remove o DIÁRIO e reabre o grupo. */
  async reverter(codgrupo: number): Promise<{ codgrupo: number; removidos: number }> {
    const emp = this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // só as linhas do PDV (codoperacao=2010) — o CODORIGEM 17 é compartilhado com o caixa da retaguarda.
      const linhas = (await trx.selectFrom('diario').select([sql`to_char(datalan,'YYYY-MM-DD')`.as('datalan'), 'codlote'])
        .where('codorigem', '=', CODORIGEM_FECHAMENTO).where('codoperacao', '=', SIT_FECHAMENTO).where('idorigem', '=', codgrupo).where('codempresa', '=', emp).execute()) as Array<{ datalan: string; codlote: number | null }>;
      for (const l of linhas) await this.assertPeriodoAberto(trx, emp, l.datalan); // não estorna em período fechado
      const del = await trx.deleteFrom('diario').where('codorigem', '=', CODORIGEM_FECHAMENTO).where('codoperacao', '=', SIT_FECHAMENTO).where('idorigem', '=', codgrupo).where('codempresa', '=', emp).executeTakeFirst();
      const lotes = [...new Set(linhas.map((l) => Number(l.codlote)).filter((n) => Number.isFinite(n)))];
      if (lotes.length) await trx.deleteFrom('lote_contabil').where('codlotecontabil', 'in', lotes).execute();
      await trx.updateTable('cx_vendas').set({ contabilizado: 'N' } as any).where('idempresa', '=', emp).where('codgrupo', '=', codgrupo).execute();
      return { codgrupo, removidos: Number((del as any)?.numDeletedRows ?? 0) };
    });
  }
}
