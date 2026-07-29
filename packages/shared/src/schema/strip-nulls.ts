/**
 * Remove `null` recursivamente de um objeto/array (→ ausente), tornando um schema de cadastro IDEMPOTENTE
 * com a saída do próprio `read`: ao reabrir um registro, colunas vazias voltam como `null` do pg, e
 * `z.optional()` só aceita `undefined` — sem este preprocess, reabrir+gravar reprova (400 no servidor /
 * no-op silencioso no zodResolver do form). Use como `z.preprocess(stripNulls, base)`.
 *
 * Já era duplicado localmente em produto/parceiro/nf/cfop; extraído aqui p/ os demais cadastros reusarem
 * (varredura da classe "reopen+save 400" — banco/conta-bancária/ncm/bairro/cidade/tabela-preço/marca/…).
 * A coerção numeric-string (pg devolve `numeric` como string) fica no `dec()` por campo, não aqui.
 */
export const stripNulls = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const x = stripNulls(val);
      if (x !== undefined) o[k] = x;
    }
    return o;
  }
  return v === null ? undefined : v;
};
