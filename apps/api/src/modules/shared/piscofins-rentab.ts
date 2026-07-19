import { type Kysely } from 'kysely';

type AnyDB = Kysely<any>;
// ROUND 2 casas FIEL ao Oracle (half-away-from-zero). O `Number.EPSILON` (ULP em 1,0) é no-op para valores ≳2 →
// meio-centavo em fronteira exata (ex.: 9,25%×90 = 8,325) truncava PARA BAIXO (8,32) em vez de 8,33. Corrige com
// um epsilon ABSOLUTO no valor escalado (1e-6): maior que o erro de float (~1e-10), menor que a granularidade
// real dos dados (rates/valores ≤4 casas → passo ≥1e-4). Valores aqui são não-negativos (Math.round = away-from-0).
const round2 = (n: number) => {
  const scaled = n * 100;
  return Math.round(scaled + (scaled >= 0 ? 1e-6 : -1e-6)) / 100;
};
const num = (v: unknown): number => {
  const n = v == null || v === '' ? 0 : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * PIS/COFINS de RENTABILIDADE por item (Wave 5). Fórmulas puras (golden PINHEIRAO 99,93%, ROUND 2 casas), fiéis a
 * uDMPrecificacaoProd.pas:215/355 e udmNF.pas:3821/10362. São snapshots de MARGEM (não fiscal-de-registro: a
 * apuração/SPED recomputam de rate×base) — consumidor = relatórios de rentabilidade (qtde×(débito−crédito)).
 */

/** DÉBITO projetado de saída = round((ALIQ_PIS_SAI + ALIQ_COFINS_SAI) × VRVENDA / 100, 2). SN/rate 0 → 0. */
export const debitoPisCofins = (vrvenda: unknown, aliqPisSai: unknown, aliqCofinsSai: unknown): number =>
  round2(((num(aliqPisSai) + num(aliqCofinsSai)) * num(vrvenda)) / 100);

/** CRÉDITO de entrada = round((ALIQ_PIS_ENT + ALIQ_COFINS_ENT) × VRCUSTO / 100, 2). Só CLASSFISCAL='LR' e ent>0. */
export const creditoPisCofins = (vrcusto: unknown, aliqPisEnt: unknown, aliqCofinsEnt: unknown, lr: boolean): number =>
  lr && num(aliqPisEnt) > 0 ? round2(((num(aliqPisEnt) + num(aliqCofinsEnt)) * num(vrcusto)) / 100) : 0;

/**
 * Deriva o snapshot de PIS/COFINS dos ITENS de um PEDIDO (server-authoritative): resolve as alíquotas do catálogo
 * PISCOFINS via produto.idpiscofins e o regime da empresa (CLASSFISCAL='LR' habilita o crédito). Retorna alinhado
 * ao array de entrada (por índice). O pedido não carrega alíquotas na linha → o catálogo é a fonte (fiel ao motor).
 */
export async function derivarPisCofinsRentabPedido(
  trx: AnyDB,
  emp: number | null,
  itens: Array<{ idproduto?: unknown; vrvenda?: unknown; vrcusto?: unknown }>,
): Promise<Array<{ debitopiscofins: number; creditopiscofins: number }>> {
  const zero = itens.map(() => ({ debitopiscofins: 0, creditopiscofins: 0 }));
  if (!itens.length || emp == null) return zero;

  const empRow = (await trx.selectFrom('empresas').select('classfiscal').where('idempresa', '=', emp).executeTakeFirst()) as { classfiscal?: string } | undefined;
  const lr = String(empRow?.classfiscal ?? '') === 'LR';

  const idprods = [...new Set(itens.map((i) => num(i.idproduto)).filter((v) => v > 0))];
  const idpcByProd = new Map<number, number | null>();
  if (idprods.length) {
    const rows = (await trx.selectFrom('produtos').select(['idproduto', 'idpiscofins']).where('idproduto', 'in', idprods).execute()) as Array<{ idproduto: number; idpiscofins?: number | null }>;
    for (const r of rows) idpcByProd.set(num(r.idproduto), r.idpiscofins != null ? num(r.idpiscofins) : null);
  }
  const idpcs = [...new Set([...idpcByProd.values()].filter((v): v is number => v != null))];
  const rateById = new Map<number, { aliq_pis_ent?: unknown; aliq_pis_sai?: unknown; aliq_cofins_ent?: unknown; aliq_cofins_sai?: unknown }>();
  if (idpcs.length) {
    const rows = (await trx.selectFrom('piscofins').select(['idpiscofins', 'aliq_pis_ent', 'aliq_pis_sai', 'aliq_cofins_ent', 'aliq_cofins_sai']).where('idpiscofins', 'in', idpcs).execute()) as Array<Record<string, unknown>>;
    for (const r of rows) rateById.set(num(r.idpiscofins), r);
  }

  return itens.map((it) => {
    const idpc = idpcByProd.get(num(it.idproduto));
    const rate = idpc != null ? rateById.get(idpc) : undefined;
    if (!rate) return { debitopiscofins: 0, creditopiscofins: 0 };
    return {
      debitopiscofins: debitoPisCofins(it.vrvenda, rate.aliq_pis_sai, rate.aliq_cofins_sai),
      creditopiscofins: creditoPisCofins(it.vrcusto, rate.aliq_pis_ent, rate.aliq_cofins_ent, lr),
    };
  });
}
