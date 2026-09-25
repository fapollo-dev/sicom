import { sql, type Kysely } from 'kysely';
import { lojasDoPedido } from './pedido-lojas';

type AnyDB = Kysely<any>;
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
export const CD_COLS = ['cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'] as const;

/**
 * O TOTAL DE CADA LOJA do pedido (`sqqTotalPedido`, udmPedidoCompra.dfm:3939: Σ PEDIDO_COMPRA_QTDE.TOTALCUSTO por
 * IDEMPRESA), em centavos, na ordem da loja. A loja do CSV sem linha entra com zero — o legado a acrescenta ao
 * `cdsTotalPedido` com TOTALCUSTO 0 (uPedidoCompra.pas:857, :4544) e ela ganha parcelas zeradas (222 na produção,
 * 2025-26). Pedido sem linha por loja nenhuma (legado anterior à mig 303): a soma dos itens, na loja dona.
 */
export async function totaisPorLoja(trx: AnyDB, codpedcomp: number, empresas: unknown, idempresa: number | null): Promise<Array<{ idempresa: number; cents: number }>> {
  const rows = (await sql<{ idempresa: number; s: unknown }>`
      SELECT q.idempresa, sum(q.totalcusto) AS s
        FROM pedido_compra_qtde q
        JOIN pedidocompra_i i ON i.codpedcompi = q.codpedcompi
       WHERE i.codpedcomp = ${codpedcomp}
       GROUP BY q.idempresa
       ORDER BY q.idempresa`.execute(trx)).rows;
  const lojas = lojasDoPedido(empresas, idempresa);
  if (!rows.length) {
    const tot = (await trx.selectFrom('pedidocompra_i').select(({ fn }: any) => [fn.sum('totalcusto').as('s')])
      .where('codpedcomp', '=', codpedcomp).executeTakeFirst()) as { s?: unknown } | undefined;
    return [{ idempresa: lojas[0] ?? Number(idempresa), cents: Math.round(num(tot?.s) * 100) }];
  }
  const out = rows.map((r) => ({ idempresa: Number(r.idempresa), cents: Math.round(num(r.s) * 100) }));
  for (const l of lojas) if (!out.some((o) => o.idempresa === l)) out.push({ idempresa: l, cents: 0 });
  return out;
}

/**
 * O RATEIO (`RatearTotalNasParcelas`, uPedidoCompra.pas:8892) — POR LOJA: para cada loja do `cdsTotalPedido`,
 * VALOR = round(total DA LOJA / nº de prazos), a SOBRA na PRIMEIRA (Σ = total da loja ao centavo), a mesma data
 * para todas as lojas (base + CDn; na produção 1.521 de 1.521 parcelas têm a mesma data nas duas lojas).
 * Pedido de uma loja só = um grupo, o comportamento de sempre.
 */
export function rateioPorLoja(totais: Array<{ idempresa: number; cents: number }>, prazos: number[], baseISO: string):
  Array<{ idempresa: number; parcela: number; data: string; valor: number; dias: number }> {
  const out: Array<{ idempresa: number; parcela: number; data: string; valor: number; dias: number }> = [];
  const n = prazos.length;
  for (const t of totais) {
    const valorCents = Math.round(t.cents / n);
    const residuo = t.cents - valorCents * n;
    prazos.forEach((dias, i) => {
      const dt = new Date(`${baseISO}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + dias);
      out.push({ idempresa: t.idempresa, parcela: i + 1, data: dt.toISOString().slice(0, 10), valor: (valorCents + (i === 0 ? residuo : 0)) / 100, dias });
    });
  }
  return out;
}

/** os prazos efetivos: CD1..CD8 do PEDIDO (override); se nenhum, os da CONDIÇÃO (codconpagto). */
export async function prazosDoPedido(trx: AnyDB, pc: Record<string, unknown>): Promise<number[]> {
  let prazos = CD_COLS.map((c) => pc[c]).filter((v) => v != null && v !== '').map((v) => Number(v));
  if (prazos.length === 0 && pc.codconpagto != null) {
    const cond = (await trx.selectFrom('condicoes_pagto').select([...CD_COLS])
      .where('codconpagto', '=', Number(pc.codconpagto)).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (cond) prazos = CD_COLS.map((c) => cond[c]).filter((v) => v != null && v !== '').map((v) => Number(v));
  }
  return prazos;
}


/**
 * O RE-RATEIO A CADA GRAVAÇÃO: o legado chama `RatearTotalNasParcelas(False)` no gravar (uPedidoCompra.pas:6866) e salva as
 * parcelas depois (`EventoDepoisGravar := SalvaParcelas`, :696) — as parcelas acompanham o total editado. O Apollo só as
 * gravava pelo botão "Gerar parcelas" ou quando o dto as trazia; depois de editar os itens ficavam velhas, e são elas que
 * alimentam o limite de valor por dia/semana (auditoria de esqueletos §4.11: 1.385 de 1.658 pedidos). Sem prazos (nem no
 * pedido nem na condição), as parcelas ficam como estão — o `SetParcelas` do legado também não faz nada.
 */
export async function reratearParcelas(trx: AnyDB, codpedcomp: number): Promise<number> {
  const pc = (await trx.selectFrom('pedidocompra')
    .select(['idempresa', 'empresas', 'codconpagto', ...CD_COLS, sql<string>`to_char(coalesce(data_faturamento, data)::date, 'YYYY-MM-DD')`.as('base')])
    .where('codpedcomp', '=', codpedcomp).executeTakeFirst()) as Record<string, unknown> | undefined;
  if (!pc) return 0;
  const prazos = await prazosDoPedido(trx, pc);
  if (!prazos.length) return 0;
  const totais = await totaisPorLoja(trx, codpedcomp, pc.empresas, pc.idempresa as number | null);
  const parcelas = rateioPorLoja(totais, prazos, String(pc.base));
  await trx.deleteFrom('pedidocompra_parcelas').where('codpedcomp', '=', codpedcomp).execute();
  for (const p of parcelas) {
    await trx.insertInto('pedidocompra_parcelas').values({
      codpedcomp, idempresa: p.idempresa, parcela: p.parcela, data: p.data, valor: p.valor, qtdediasaposfaturamento: p.dias,
    }).execute();
  }
  return parcelas.length;
}
