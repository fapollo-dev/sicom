/**
 * Normalização do código de referência do fornecedor (de-para CODREFERENCIA_FOR). Extraído do
 * RecebimentoService (corte-3) para ser REUSADO tanto pelo runtime (match do import de XML) quanto pelo
 * CUTOVER das 16k linhas — a de-dup DEVE normalizar exatamente igual ao match, senão a chave diverge.
 * Fiel ao legado (uNF.pas:12308): GTIN-14 com zero à esquerda casa contra o CODBARRA de 13 dígitos.
 */

/** dígitos de um EAN, com o zero-à-esquerda de GTIN-14 removido (→ GTIN-13). */
export function digEan(e: string): string {
  const d = (e ?? '').replace(/\D/g, '');
  return d.length === 14 && d[0] === '0' ? d.slice(1) : d;
}

/**
 * normaliza um código de referência (cProd/cEAN/codref): trim + tira pontos + zero-à-esquerda de GTIN-14.
 * 'SEM GTIN' (e vazio) → '' (nunca é chave de match nem de de-para — é sentinela textual do legado).
 */
export function normRef(s: string): string {
  const t = (s ?? '').trim().replace(/\./g, '');
  if (!t || t.toUpperCase() === 'SEM GTIN') return '';
  return /^0\d{13}$/.test(t) ? t.slice(1) : t; // GTIN-14 c/ zero à esquerda → GTIN-13 (consistente com digEan)
}
