import { soDigitos } from './br';

/**
 * Validação e geração da CHAVE DE ACESSO da NFe/NFC-e (44 dígitos) — F6.
 *
 * No legado a chave é montada/conferida pelo ACBr (não há código Pascal próprio);
 * aqui reimplementamos a regra oficial (Manual de Padrões Técnicos da SEFAZ), que é
 * pura e portável. Layout dos 44 dígitos:
 *
 *   cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
 *   └────────────────────── 43 dígitos ──────────────────────┘ └ DV ┘
 *
 * cDV = dígito verificador (módulo 11) sobre os 43 primeiros dígitos: pesos 2..9
 * cíclicos da DIREITA para a esquerda; `resto = soma % 11`; `resto <= 1 ⇒ DV = 0`,
 * senão `DV = 11 - resto`.
 *
 * Política de contorno (igual aos demais validadores): chave vazia/branca → válida
 * (campo opcional; o servidor gera na transmissão); não-numérica, comprimento ≠ 44
 * ou DV incorreto → inválida.
 */

/** preenche `s` à esquerda com '0' até atingir `len` (trunca à direita se exceder). */
function pad(s: string | number, len: number): string {
  const str = String(s);
  if (str.length >= len) return str.slice(str.length - len);
  return '0'.repeat(len - str.length) + str;
}

/**
 * Dígito verificador (mód 11) da chave NFe sobre os 43 primeiros dígitos.
 * Pesos 2,3,4,…,9,2,3,… da direita para a esquerda. Retorna -1 se a base não tiver 43 dígitos.
 */
export function dvChaveNfe(base43: string): number {
  const base = soDigitos(base43);
  if (base.length !== 43) return -1;
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto <= 1 ? 0 : 11 - resto;
}

/**
 * Valida uma chave de acesso NFe (44 dígitos). Vazio/branco → true (opcional).
 * Reprova se houver caractere não-numérico, comprimento ≠ 44 ou DV incorreto.
 */
export function chaveNfeValida(chave: string): boolean {
  if (!chave || !chave.trim()) return true; // opcional
  const d = soDigitos(chave);
  if (d.length !== chave.trim().length) return false; // tinha não-dígitos
  if (d.length !== 44) return false;
  return dvChaveNfe(d.slice(0, 43)) === Number(d[43]);
}

/** componentes para montar a chave de acesso (todos numéricos; zero-pad automático). */
export interface ComponentesChaveNfe {
  cuf: number | string; // código IBGE da UF do emitente (2 díg)
  aamm: number | string; // ano (2) + mês (2) da emissão
  cnpj: string; // CNPJ do emitente (14 díg)
  modelo: number | string; // 55 (NFe) / 65 (NFC-e)
  serie: number | string; // série (3 díg)
  numero: number | string; // nNF — número da nota (9 díg)
  tpEmis: number | string; // tipo de emissão (1 normal / 6,7 contingência)
  cnf: number | string; // código numérico aleatório (8 díg)
}

/**
 * Monta a chave de acesso de 44 dígitos a partir dos componentes (zero-pad em cada campo)
 * e acrescenta o DV (mód 11). Espelha o que o ACBr faz no legado.
 */
export function montarChaveNfe(c: ComponentesChaveNfe): string {
  const base43 =
    pad(soDigitos(String(c.cuf)), 2) +
    pad(soDigitos(String(c.aamm)), 4) +
    pad(soDigitos(c.cnpj), 14) +
    pad(soDigitos(String(c.modelo)), 2) +
    pad(soDigitos(String(c.serie)), 3) +
    pad(soDigitos(String(c.numero)), 9) +
    pad(soDigitos(String(c.tpEmis)), 1) +
    pad(soDigitos(String(c.cnf)), 8);
  return base43 + String(dvChaveNfe(base43));
}
