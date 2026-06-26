import { soDigitos } from './br';

/**
 * Validação de CÓDIGO DE BARRAS (EAN/GTIN) e geração de código interno —
 * espelha o legado da tela de Produto (UCadProduto.pas):
 *  - `CalculaDVCodBarra`  → dígito verificador EAN-13;
 *  - `MontaCodigoBarra` (F8) → gera um EAN-13 interno a partir de um sequencial.
 *
 * Padrão GS1 (mod 10): os pesos alternam 3 e 1 a partir da DIREITA — o dígito de
 * dados mais à direita tem peso 3. Vale para EAN-8, EAN-12 (UPC-A), EAN-13 e
 * EAN-14/GTIN-14; muda apenas o comprimento da base.
 *
 * Política de contorno (caller decide obrigatoriedade):
 *  - código vazio/branco → true (campo opcional; quem chama decide se é obrigatório);
 *  - não-numérico, comprimento inválido ou DV inválido → false.
 *
 * Comprimentos ACEITOS por `eanValido`: 8 (EAN-8), 12 (UPC-A / EAN-12),
 * 13 (EAN-13) e 14 (EAN-14 / GTIN-14).
 */

/** comprimentos de código de barras aceitos (sem o "sem código" vazio). */
const COMPRIMENTOS_VALIDOS = new Set([8, 12, 13, 14]);

/**
 * DV GS1 (mod 10) sobre uma base já só-dígitos de qualquer comprimento.
 * Pesos alternam 3/1 a partir da direita (dígito mais à direita = peso 3).
 */
function dvGs1(base: string): number {
  let soma = 0;
  const n = base.length;
  for (let i = 0; i < n; i++) {
    const aPartirDaDireita = n - i; // posição 1-based contada da direita
    const peso = aPartirDaDireita % 2 === 1 ? 3 : 1;
    soma += Number(base[i]) * peso;
  }
  return (10 - (soma % 10)) % 10;
}

/**
 * Dígito verificador EAN-13 (`CalculaDVCodBarra` do legado): recebe os 12
 * primeiros dígitos e devolve o DV. Pesos 3,1,3,1… da direita; DV = (10 - soma%10) % 10.
 */
export function dvEan13(base12: string): number {
  return dvGs1(soDigitos(base12).slice(0, 12));
}

/**
 * Valida um código de barras EAN/GTIN.
 * Comprimentos aceitos: 8, 12, 13, 14. Normaliza dígitos, confere comprimento e o
 * DV GS1 (mod 10). Vazio/branco → true (campo opcional). Não-numérico, comprimento
 * fora do conjunto ou DV incorreto → false.
 */
export function eanValido(codigo: string): boolean {
  // vazio/branco → quem chama decide se é obrigatório.
  if (!codigo || !codigo.trim()) return true;
  const digitos = soDigitos(codigo);
  // se havia caracteres não-numéricos (ou nenhum dígito), reprova.
  if (digitos.length !== codigo.trim().length) return false;
  if (!COMPRIMENTOS_VALIDOS.has(digitos.length)) return false;
  const base = digitos.slice(0, -1);
  const dv = Number(digitos.slice(-1));
  return dvGs1(base) === dv;
}

/** preenche `s` à esquerda com `ch` até atingir `len`. */
function leftPad(s: string, len: number, ch: string): string {
  let out = s;
  while (out.length < len) out = ch + out;
  return out;
}

/**
 * Gera um EAN-13 interno (`MontaCodigoBarra` / F8 do legado):
 * `'7' + leftPad(<sequencial>, 11, '0')` → base de 12 dígitos → acrescenta o DV
 * EAN-13 → string de 13 dígitos. O prefixo "7" marca código de uso interno.
 */
export function gerarCodigoInternoEan13(sequencial: number | string): string {
  const seq = soDigitos(String(sequencial));
  const base12 = '7' + leftPad(seq, 11, '0');
  return base12 + String(dvEan13(base12));
}

/**
 * (Balança) Valida um PLU de balança: código numérico livre de 1 a 4 dígitos,
 * faixa 1..9999 (não é um EAN — não tem DV).
 */
export function pluBalancaValido(plu: string): boolean {
  const v = (plu ?? '').trim();
  if (!/^\d{1,4}$/.test(v)) return false;
  const n = Number(v);
  return n >= 1 && n <= 9999;
}
