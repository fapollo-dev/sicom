import { soDigitos } from './br';

/**
 * Validação de INSCRIÇÃO ESTADUAL (IE) por UF — espelha o legado
 * `ValidaDocumento(docInscEst, ie, uf)`: cada estado tem seu próprio comprimento
 * e algoritmo de dígito(s) verificador(es).
 *
 * Política de contorno (igual ao legado / caller decide obrigatoriedade):
 *  - IE vazia/branca  → true  (campo opcional; quem chama decide se é obrigatório);
 *  - IE "ISENTO"/"ISENTA" → true (não-contribuinte / isento);
 *  - UF desconhecida/vazia → true (sem regra → não há como reprovar);
 *  - caso contrário, normaliza dígitos e valida comprimento + DV(s) da UF.
 *
 * Referência: algoritmos oficiais publicados pelas SEFAZ (mesma base usada pelo
 * SINTEGRA). Onde uma UF aceita mais de um formato, aceitamos os padrões usuais.
 */

/** true se a IE é declarada ISENTO/ISENTA (não-contribuinte). */
export function ieIsenta(ie: string): boolean {
  const v = (ie ?? '').trim().toUpperCase();
  return v === 'ISENTO' || v === 'ISENTA';
}

/** soma(dígitos * pesos) — pesos alinhados pela ESQUERDA com a base. */
function somaPesos(base: string, pesos: number[]): number {
  let soma = 0;
  for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i];
  return soma;
}

/** DV módulo 11 clássico: r = soma%11; dv = (r<2)?0:11-r. */
function dvMod11(base: string, pesos: number[]): number {
  const r = somaPesos(base, pesos) % 11;
  return r < 2 ? 0 : 11 - r;
}

/**
 * DV módulo 11 "SP/CE-style": dv = 11 - (soma%11); se 10/11 → 0.
 * (variante onde resto 0 e 1 viram 0).
 */
function dvMod11SubResto(base: string, pesos: number[]): number {
  const dv = 11 - (somaPesos(base, pesos) % 11);
  return dv >= 10 ? 0 : dv;
}

type Validador = (ie: string) => boolean;

const REGRAS: Record<string, Validador> = {
  // ── AC: 13 dígitos, prefixo "01", 2 DVs (mod 11, pesos cíclicos 2..9). ──
  AC: (ie) => {
    if (ie.length !== 13 || ie.slice(0, 2) !== '01') return false;
    const p1 = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const p2 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const d1 = dvMod11(ie.slice(0, 11), p1);
    const d2 = dvMod11(ie.slice(0, 12), p2);
    return d1 === Number(ie[11]) && d2 === Number(ie[12]);
  },

  // ── AL: 9 dígitos, prefixo "24", 1 DV. Soma*pesos(9..2), (soma*10)%11, 10→0. ──
  AL: (ie) => {
    if (ie.length !== 9 || ie.slice(0, 2) !== '24') return false;
    const soma = somaPesos(ie.slice(0, 8), [9, 8, 7, 6, 5, 4, 3, 2]);
    let d = (soma * 10) % 11;
    if (d === 10) d = 0;
    return d === Number(ie[8]);
  },

  // ── AP: 9 dígitos, prefixo "03", 1 DV (mod 11) com p/d variável por faixa. ──
  AP: (ie) => {
    if (ie.length !== 9 || ie.slice(0, 2) !== '03') return false;
    const n = Number(ie.slice(0, 8));
    let p = 0;
    let d = 0;
    if (n >= 3000001 && n <= 3017000) {
      p = 5;
      d = 0;
    } else if (n >= 3017001 && n <= 3019022) {
      p = 9;
      d = 1;
    } // n >= 3019023 → p=0, d=0
    let soma = p + somaPesos(ie.slice(0, 8), [9, 8, 7, 6, 5, 4, 3, 2]);
    let dv = 11 - (soma % 11);
    if (dv === 10) dv = 0;
    else if (dv === 11) dv = d;
    return dv === Number(ie[8]);
  },

  // ── AM: 9 dígitos, 1 DV. soma*pesos(9..2): se soma<11 → dv=11-soma; senão r=soma%11, dv=(r<=1?0:11-r). ──
  AM: (ie) => {
    if (ie.length !== 9) return false;
    const soma = somaPesos(ie.slice(0, 8), [9, 8, 7, 6, 5, 4, 3, 2]);
    let d: number;
    if (soma < 11) d = 11 - soma;
    else {
      const r = soma % 11;
      d = r <= 1 ? 0 : 11 - r;
    }
    return d === Number(ie[8]);
  },

  // ── BA: 8 ou 9 dígitos, 2 DVs. Módulo (10 ou 11) escolhido pelo dígito mais à esquerda. ──
  BA: (ie) => {
    if (ie.length !== 8 && ie.length !== 9) return false;
    // No formato de 9 dígitos o "indicador" é o 2º caractere; no de 8, o 1º.
    const indicador = ie.length === 9 ? ie[1] : ie[0];
    const mod = '0123458'.includes(indicador) ? 10 : 11;
    const base = ie.slice(0, ie.length - 2); // sem os 2 DVs
    // DV2 calculado primeiro (sobre a base), DV1 sobre base+DV2.
    const pesos2 = ie.length === 9 ? [8, 7, 6, 5, 4, 3, 2] : [7, 6, 5, 4, 3, 2];
    const pesos1 = ie.length === 9 ? [9, 8, 7, 6, 5, 4, 3, 2] : [8, 7, 6, 5, 4, 3, 2];
    const calc = (b: string, pesos: number[]): number => {
      const r = somaPesos(b, pesos) % mod;
      if (mod === 10) return r === 0 ? 0 : 10 - r;
      return r <= 1 ? 0 : 11 - r;
    };
    const d2 = calc(base, pesos2);
    const d1 = calc(base + String(d2), pesos1);
    return d1 === Number(ie[ie.length - 2]) && d2 === Number(ie[ie.length - 1]);
  },

  // ── CE: 9 dígitos, 1 DV (mod 11, pesos 9..2). ──
  CE: (ie) => {
    if (ie.length !== 9) return false;
    return dvMod11SubResto(ie.slice(0, 8), [9, 8, 7, 6, 5, 4, 3, 2]) === Number(ie[8]);
  },

  // ── DF: 13 dígitos, prefixo "07", 2 DVs (mod 11, pesos cíclicos 2..9). ──
  DF: (ie) => {
    if (ie.length !== 13 || ie.slice(0, 2) !== '07') return false;
    const p1 = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const p2 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const d1 = dvMod11(ie.slice(0, 11), p1);
    const d2 = dvMod11(ie.slice(0, 12), p2);
    return d1 === Number(ie[11]) && d2 === Number(ie[12]);
  },

  // ── ES: 9 dígitos, 1 DV (mod 11, pesos 9..2). ──
  ES: (ie) => {
    if (ie.length !== 9) return false;
    return dvMod11SubResto(ie.slice(0, 8), [9, 8, 7, 6, 5, 4, 3, 2]) === Number(ie[8]);
  },

  // ── GO: 9 dígitos, prefixo 10/11/15, 1 DV (mod 11, pesos 9..2) com faixa de exceção. ──
  GO: (ie) => {
    if (ie.length !== 9) return false;
    const pref = ie.slice(0, 2);
    if (!['10', '11', '15'].includes(pref)) return false;
    const r = somaPesos(ie.slice(0, 8), [9, 8, 7, 6, 5, 4, 3, 2]) % 11;
    let d: number;
    if (r === 0) d = 0;
    else if (r === 1) {
      const n = Number(ie.slice(0, 8));
      d = n >= 10103105 && n <= 10119997 ? 1 : 0;
    } else d = 11 - r;
    return d === Number(ie[8]);
  },

  // ── MA: 9 dígitos, prefixo "12", 1 DV (mod 11, pesos 9..2). ──
  MA: (ie) => {
    if (ie.length !== 9 || ie.slice(0, 2) !== '12') return false;
    return dvMod11(ie.slice(0, 8), [9, 8, 7, 6, 5, 4, 3, 2]) === Number(ie[8]);
  },

  // ── MT: 11 dígitos, 1 DV (mod 11, pesos cíclicos 3,2,9..2). ──
  MT: (ie) => {
    if (ie.length !== 11) return false;
    return dvMod11(ie.slice(0, 10), [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(ie[10]);
  },

  // ── MS: 9 dígitos, prefixo "28", 1 DV (mod 11, pesos 9..2). ──
  MS: (ie) => {
    if (ie.length !== 9 || ie.slice(0, 2) !== '28') return false;
    return dvMod11(ie.slice(0, 8), [9, 8, 7, 6, 5, 4, 3, 2]) === Number(ie[8]);
  },

  // ── MG: 13 dígitos, 2 DVs. DV1 especial (intercala "10" no dígito-cidade); DV2 mod 11. ──
  MG: (ie) => {
    if (ie.length !== 13) return false;
    // DV1: pega os 11 primeiros dígitos, expande inserindo "10" entre 3º e 4º
    // dígito (separador do código de município), multiplica cada por 1/2
    // alternados, soma os dígitos dos produtos, sobe à dezena e subtrai.
    const base1 = ie.slice(0, 3) + '0' + ie.slice(3, 11); // insere o "1" do "10"; o "0" entra como peso
    // Implementação padrão: string = cidade(3)+'0'+numero(8) → 12 chars, pesos 1,2,1,2...
    let soma = 0;
    for (let i = 0; i < base1.length; i++) {
      const prod = Number(base1[i]) * (i % 2 === 0 ? 1 : 2);
      soma += Math.floor(prod / 10) + (prod % 10); // soma dos dígitos do produto
    }
    const dezena = Math.ceil(soma / 10) * 10;
    const d1 = dezena - soma === 10 ? 0 : dezena - soma;
    if (d1 !== Number(ie[11])) return false;
    // DV2: mod 11 sobre os 12 primeiros (11 base + DV1), pesos cíclicos 3,2,9..2.
    const d2 = dvMod11(ie.slice(0, 12), [3, 2, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return d2 === Number(ie[12]);
  },

  // ── PA: 9 dígitos, prefixo "15", 1 DV (mod 11, pesos 9..2). ──
  PA: (ie) => {
    if (ie.length !== 9 || ie.slice(0, 2) !== '15') return false;
    return dvMod11(ie.slice(0, 8), [9, 8, 7, 6, 5, 4, 3, 2]) === Number(ie[8]);
  },

  // ── PB: 9 dígitos, 1 DV (mod 11, pesos 9..2); resto que daria 10 → 0. ──
  PB: (ie) => {
    if (ie.length !== 9) return false;
    return dvMod11SubResto(ie.slice(0, 8), [9, 8, 7, 6, 5, 4, 3, 2]) === Number(ie[8]);
  },

  // ── PR: 10 dígitos, 2 DVs (mod 11, pesos cíclicos 3,2,7..2). ──
  PR: (ie) => {
    if (ie.length !== 10) return false;
    const d1 = dvMod11(ie.slice(0, 8), [3, 2, 7, 6, 5, 4, 3, 2]);
    const d2 = dvMod11(ie.slice(0, 9), [4, 3, 2, 7, 6, 5, 4, 3, 2]);
    return d1 === Number(ie[8]) && d2 === Number(ie[9]);
  },

  // ── PE: 9 dígitos, 2 DVs (mod 11). Formato novo (SINTEGRA). ──
  PE: (ie) => {
    if (ie.length !== 9) return false;
    const calc = (base: string): number => {
      let pesos: number[];
      pesos = base.length === 7 ? [8, 7, 6, 5, 4, 3, 2] : [9, 8, 7, 6, 5, 4, 3, 2];
      const r = somaPesos(base, pesos) % 11;
      const d = 11 - r;
      return d > 9 ? d - 10 : d;
    };
    const d1 = calc(ie.slice(0, 7));
    const d2 = calc(ie.slice(0, 8));
    return d1 === Number(ie[7]) && d2 === Number(ie[8]);
  },

  // ── PI: 9 dígitos, 1 DV (mod 11, pesos 9..2). ──
  PI: (ie) => {
    if (ie.length !== 9) return false;
    return dvMod11(ie.slice(0, 8), [9, 8, 7, 6, 5, 4, 3, 2]) === Number(ie[8]);
  },

  // ── RJ: 8 dígitos, 1 DV (mod 11, pesos cíclicos 2,7,6,5,4,3,2). ──
  RJ: (ie) => {
    if (ie.length !== 8) return false;
    return dvMod11(ie.slice(0, 7), [2, 7, 6, 5, 4, 3, 2]) === Number(ie[7]);
  },

  // ── RN: 9 ou 10 dígitos, prefixo "20", 1 DV. (soma*10)%11, 10→0. ──
  RN: (ie) => {
    if ((ie.length !== 9 && ie.length !== 10) || ie.slice(0, 2) !== '20') return false;
    const base = ie.slice(0, ie.length - 1);
    const pesos =
      ie.length === 9 ? [9, 8, 7, 6, 5, 4, 3, 2] : [10, 9, 8, 7, 6, 5, 4, 3, 2];
    let d = (somaPesos(base, pesos) * 10) % 11;
    if (d === 10) d = 0;
    return d === Number(ie[ie.length - 1]);
  },

  // ── RO: 14 dígitos (formato atual), 1 DV (mod 11, pesos cíclicos 6,5,4,3,2,9..2). ──
  RO: (ie) => {
    if (ie.length !== 14) return false;
    const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let d = 11 - (somaPesos(ie.slice(0, 13), pesos) % 11);
    if (d > 9) d -= 10;
    return d === Number(ie[13]);
  },

  // ── RR: 9 dígitos, prefixo "24", 1 DV (mod 9, pesos 1..8). ──
  RR: (ie) => {
    if (ie.length !== 9 || ie.slice(0, 2) !== '24') return false;
    const d = somaPesos(ie.slice(0, 8), [1, 2, 3, 4, 5, 6, 7, 8]) % 9;
    return d === Number(ie[8]);
  },

  // ── RS: 10 dígitos, 1 DV (mod 11, pesos cíclicos 2,9,8..2). ──
  RS: (ie) => {
    if (ie.length !== 10) return false;
    return dvMod11(ie.slice(0, 9), [2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(ie[9]);
  },

  // ── SC: 9 dígitos, 1 DV (mod 11, pesos 9..2). ──
  SC: (ie) => {
    if (ie.length !== 9) return false;
    return dvMod11(ie.slice(0, 8), [9, 8, 7, 6, 5, 4, 3, 2]) === Number(ie[8]);
  },

  // ── SE: 9 dígitos, 1 DV (mod 11, pesos 9..2); resto que daria 10 → 0. ──
  SE: (ie) => {
    if (ie.length !== 9) return false;
    return dvMod11SubResto(ie.slice(0, 8), [9, 8, 7, 6, 5, 4, 3, 2]) === Number(ie[8]);
  },

  // ── SP: 12 dígitos, 2 DVs (caso numérico padrão "indústria/comércio"). ──
  // Variante RURAL ("P" + 12 dígitos) é simplificada: validamos apenas o 1º DV
  // do bloco numérico — basta para o caso comum; ver comentário abaixo.
  SP: (ie) => {
    if (ie.length !== 12) return false;
    // DV1 (posição 9): pesos 1,3,4,5,6,7,8,10 sobre os 8 primeiros; (soma%11) último dígito.
    const s1 = somaPesos(ie.slice(0, 8), [1, 3, 4, 5, 6, 7, 8, 10]);
    const d1 = (s1 % 11) % 10;
    if (d1 !== Number(ie[8])) return false;
    // DV2 (posição 12): pesos 3,2,10,9,8,7,6,5,4,3,2 sobre os 11 primeiros.
    const s2 = somaPesos(ie.slice(0, 11), [3, 2, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = (s2 % 11) % 10;
    return d2 === Number(ie[11]);
  },

  // ── TO: 9 ou 11 dígitos. No formato de 11, ignoram-se as posições 3 e 4 (tipo). 1 DV mod 11. ──
  TO: (ie) => {
    if (ie.length !== 9 && ie.length !== 11) return false;
    // Normaliza para 9 dígitos relevantes (remove o "tipo" nas pos. 2-3 do formato antigo).
    const base9 = ie.length === 11 ? ie.slice(0, 2) + ie.slice(4) : ie;
    if (base9.length !== 9) return false;
    return dvMod11(base9.slice(0, 8), [9, 8, 7, 6, 5, 4, 3, 2]) === Number(base9[8]);
  },
};

/**
 * Valida a IE para a UF informada. Veja a política de contorno no topo do arquivo.
 */
export function inscricaoEstadualValida(uf: string, ie: string): boolean {
  // IE vazia/branca → quem chama decide se é obrigatória.
  if (!ie || !ie.trim()) return true;
  // ISENTO/ISENTA → válido.
  if (ieIsenta(ie)) return true;

  const sigla = (uf ?? '').trim().toUpperCase();
  if (!sigla) return true; // sem UF não há como checar.

  const regra = REGRAS[sigla];
  if (!regra) return true; // UF desconhecida → não reprova.

  // SP rural começa com "P": valida o bloco numérico (12 dígitos após o "P").
  const isSpRural = sigla === 'SP' && /^P/i.test(ie.trim());
  const digitos = isSpRural ? soDigitos(ie).slice(0, 12) : soDigitos(ie);
  if (!digitos) return false;

  return regra(digitos);
}
