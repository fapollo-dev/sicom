import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * PEDIDO DE COMPRA — serviço VERTICAL das transições de ESTADO (o CRUD do agregado é o
 * AggregateEngineService). Workflow do legado: rascunho (FECHADO='N') → fechado (FECHADO='S').
 * `fechar` confirma o pedido (exige ao menos 1 item); depois disso o agregado bloqueia edição/
 * exclusão (validar/validarRemocao). `reabrir` volta p/ rascunho (bloqueado se já faturado — a NF de
 * entrada é corte futuro; a guarda fica de pé). Tenant por IDEMPRESA + operador, fail-closed.
 */
@Injectable()
export class PedidoCompraService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number {
    const o = currentTenant().operadorId ?? null;
    if (o == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return o;
  }

  /** fecha o pedido (N→S): exige ≥1 item; CAS em FECHADO p/ evitar duplo-fechamento concorrente. */
  async fechar(codpedcomp: number): Promise<{ codpedcomp: number; fechado: 'S' }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await trx
        .selectFrom('pedidocompra')
        .select(['codpedcomp', 'fechado'])
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E') // pedido excluído (soft-delete) é inexistente
        .forUpdate()
        .executeTakeFirst();
      if (!pc) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
      if ((pc as any).fechado === 'S') throw new BusinessRuleError('PEDIDO_JA_FECHADO', { codpedcomp });

      const itens = await trx
        .selectFrom('pedidocompra_i')
        .select(({ fn }: any) => [fn.count('codpedcompi').as('n')])
        .where('codpedcomp', '=', codpedcomp)
        .executeTakeFirst();
      if (Number((itens as any)?.n ?? 0) === 0) throw new BusinessRuleError('PEDIDO_SEM_ITENS', { codpedcomp });

      const upd = await trx
        .updateTable('pedidocompra')
        .set({ fechado: 'S', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where((eb: any) => eb.or([eb('fechado', '<>', 'S'), eb('fechado', 'is', null)]))
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('PEDIDO_JA_FECHADO', { codpedcomp });
      return { codpedcomp, fechado: 'S' as const };
    });
  }

  /**
   * corte-2 — GERA as parcelas do pedido a partir da condição de pagamento (RatearTotalNasParcelas,
   * uPedidoCompra.pas:8892). Prazos (dias) = CD1..CD8 do PEDIDO (override local); se nenhum, os da CONDIÇÃO
   * (codconpagto). Para cada CDn não-nulo: 1 parcela; VALOR = round(TOTAL/nParc) com a SOBRA na PRIMEIRA
   * (Σ = total ao centavo); DATA = data_pedido + CDn dias; QTDEDIASAPOSFATURAMENTO = CDn. Substitui as
   * parcelas existentes. Bloqueado em pedido fechado/faturado (é uma edição). Single-empresa.
   */
  async gerarParcelas(codpedcomp: number): Promise<{ codpedcomp: number; parcelas: number; total: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await trx
        .selectFrom('pedidocompra')
        .select(['codpedcomp', 'fechado', 'dtfaturamento', 'data', 'data_faturamento', 'codconpagto', 'cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'])
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .forUpdate()
        .executeTakeFirst();
      if (!pc) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
      if ((pc as any).dtfaturamento != null) throw new BusinessRuleError('PEDIDO_FATURADO', { codpedcomp });
      if ((pc as any).fechado === 'S') throw new BusinessRuleError('PEDIDO_FECHADO', { codpedcomp });

      // prazos: CD1..CD8 do PEDIDO (override); se nenhum, os da CONDIÇÃO (codconpagto).
      const cdCols = ['cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'] as const;
      const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
      let prazos = cdCols.map((c) => num((pc as any)[c])).filter((d): d is number => d != null);
      if (prazos.length === 0 && (pc as any).codconpagto != null) {
        const cond = await trx
          .selectFrom('condicoes_pagto')
          .select(['cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'])
          .where('codconpagto', '=', Number((pc as any).codconpagto))
          .executeTakeFirst();
        if (cond) prazos = cdCols.map((c) => num((cond as any)[c])).filter((d): d is number => d != null);
      }
      if (prazos.length === 0) throw new BusinessRuleError('PEDIDO_SEM_CONDICAO_PAGTO', { codpedcomp });

      // total = Σ VLREMBALAGEM dos itens. NOTA (single-empresa): o legado usa TOTALCUSTO = Σ(QTDE×VLREMBALAGEM)
      // agrupado por loja (PEDIDO_COMPRA_QTDE, o split multi-loja/cross-docking = ADIADO). No modelo reduzido do
      // corte-1 (qtd=FATOREMBALAGEM, VLREMBALAGEM=fator×custo) Σ vlrembalagem é a base consistente.
      const tot = await trx
        .selectFrom('pedidocompra_i')
        .select(({ fn }: any) => [fn.sum('vlrembalagem').as('s')])
        .where('codpedcomp', '=', codpedcomp)
        .executeTakeFirst();
      const totalCents = Math.round(Number((tot as any)?.s ?? 0) * 100);
      if (totalCents <= 0) throw new BusinessRuleError('PEDIDO_SEM_VALOR', { codpedcomp });

      // rateio: valor por parcela + SOBRA na PRIMEIRA (fiel ao RatearTotalNasParcelas:8941). Σ == total.
      const n = prazos.length;
      const valorCents = Math.round(totalCents / n);
      const residuo = totalCents - valorCents * n;
      // data-base do vencimento = DATA_FATURAMENTO (legado edtDtFaturamento→DTFATURAMENTO; golden 99,2%);
      // fallback p/ a data do pedido quando não informada.
      const base = new Date(((pc as any).data_faturamento ?? (pc as any).data) as string | number | Date);

      await trx.deleteFrom('pedidocompra_parcelas').where('codpedcomp', '=', codpedcomp).execute();
      for (let i = 0; i < n; i++) {
        const dias = prazos[i];
        const dt = new Date(base.getTime());
        dt.setUTCDate(dt.getUTCDate() + dias);
        await trx
          .insertInto('pedidocompra_parcelas')
          .values({
            codpedcomp,
            idempresa: emp,
            parcela: i + 1,
            data: dt.toISOString().slice(0, 10),
            valor: (valorCents + (i === 0 ? residuo : 0)) / 100, // sobra na PRIMEIRA
            qtdediasaposfaturamento: dias,
          })
          .execute();
      }

      await trx
        .updateTable('pedidocompra')
        .set({ usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .execute();
      return { codpedcomp, parcelas: n, total: totalCents / 100 };
    });
  }

  /** reabre o pedido (S→N): bloqueado se já faturado (NF de entrada = corte futuro; guarda de pé). */
  async reabrir(codpedcomp: number): Promise<{ codpedcomp: number; fechado: 'N' }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await trx
        .selectFrom('pedidocompra')
        .select(['codpedcomp', 'fechado', 'dtfaturamento'])
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E') // pedido excluído (soft-delete) é inexistente
        .forUpdate()
        .executeTakeFirst();
      if (!pc) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
      if ((pc as any).fechado !== 'S') throw new BusinessRuleError('PEDIDO_NAO_FECHADO', { codpedcomp });
      if ((pc as any).dtfaturamento != null) throw new BusinessRuleError('PEDIDO_FATURADO', { codpedcomp });

      // CAS em FECHADO (cinto-e-suspensório com o forUpdate) — padrão do repo (caixa.reabrir).
      const upd = await trx
        .updateTable('pedidocompra')
        .set({ fechado: 'N', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where('fechado', '=', 'S')
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('PEDIDO_NAO_FECHADO', { codpedcomp });
      return { codpedcomp, fechado: 'N' as const };
    });
  }
}
