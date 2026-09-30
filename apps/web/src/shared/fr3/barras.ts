/**
 * Os códigos de barras do TfrxBarCodeView que os modelos `eti$` usam — EAN-13 (20 objetos), 2 de 5 intercalado (17) e
 * Code-128 (1) — mais EAN-8 e Code-39, desenhados em SVG no tamanho do FastReport: o módulo mede `Zoom` pixels.
 *
 * EAN-13 como o TfrxBarcode com `CalcCheckSum` desligado (o padrão do objeto, e nenhum modelo o liga): o texto é
 * completado com zeros à esquerda até 13 dígitos e codificado como está — o código interno "0610" da banana sai
 * como 0000000000610, igual ao legado. Com `CalcCheckSum`, os 12 primeiros ganham o dígito verificador calculado.
 */
// os 107 padrões do Code-128 (0–106): larguras alternando barra/espaço (11 módulos; o Stop tem 13)
export const PADROES_CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARIDADE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function digitoEan(doze: string): string {
  let s = 0;
  for (let i = 0; i < doze.length; i++) s += Number(doze[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (s % 10)) % 10);
}

export interface Desenho {
  modulos: string; // '1' = barra, '0' = espaço (1 módulo cada)
  guardas?: Set<number>; // módulos que descem até o texto (EAN)
  texto?: Array<{ s: string; x: number; w: number }>; // grupos do texto legível (em módulos, a partir do início das barras)
  recuo?: number; // módulos à esquerda das barras (o 1º dígito do EAN-13)
}

function ean13(valor: string, calc: boolean): Desenho | null {
  let d = valor.replace(/\s/g, '');
  if (!/^\d{1,13}$/.test(d)) return null;
  d = calc ? d.slice(0, 12).padStart(12, '0') : d.padStart(13, '0');
  if (calc) d += digitoEan(d);
  const par = PARIDADE[Number(d[0])];
  let m = '101';
  for (let i = 1; i <= 6; i++) m += (par[i - 1] === 'L' ? L : G)[Number(d[i])];
  m += '01010';
  for (let i = 7; i <= 12; i++) m += R[Number(d[i])];
  m += '101';
  const guardas = new Set<number>([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
  return { modulos: m, guardas, recuo: 8, texto: [{ s: d[0], x: -8, w: 7 }, { s: d.slice(1, 7), x: 3, w: 42 }, { s: d.slice(7), x: 50, w: 42 }] };
}

function ean8(valor: string, calc: boolean): Desenho | null {
  let d = valor.replace(/\s/g, '');
  if (!/^\d{1,8}$/.test(d)) return null;
  d = calc ? d.slice(0, 7).padStart(7, '0') : d.padStart(8, '0');
  if (calc) d += digitoEan(d.padStart(12, '0')).slice(-1);
  let m = '101';
  for (let i = 0; i < 4; i++) m += L[Number(d[i])];
  m += '01010';
  for (let i = 4; i < 8; i++) m += R[Number(d[i])];
  m += '101';
  return { modulos: m, guardas: new Set([0, 1, 2, 31, 32, 33, 34, 35, 64, 65, 66]), texto: [{ s: d.slice(0, 4), x: 3, w: 28 }, { s: d.slice(4), x: 36, w: 28 }] };
}

const ITF = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];
function itf(valor: string, larga: number): Desenho | null {
  let d = valor.replace(/\D/g, '');
  if (!d) return null;
  if (d.length % 2) d = '0' + d;
  const w = Math.max(2, Math.round(larga));
  let m = '1010';
  for (let i = 0; i < d.length; i += 2) {
    const b = ITF[Number(d[i])];
    const e = ITF[Number(d[i + 1])];
    for (let k = 0; k < 5; k++) m += '1'.repeat(b[k] === 'w' ? w : 1) + '0'.repeat(e[k] === 'w' ? w : 1);
  }
  m += '1'.repeat(w) + '0' + '1';
  return { modulos: m, texto: [{ s: d, x: 0, w: m.length }] };
}

function code128(valor: string): Desenho | null {
  const chars = [...valor].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
  if (!chars.length) return null;
  const codes = [104];
  let soma = 104;
  chars.forEach((c, i) => { const v = c.charCodeAt(0) - 32; codes.push(v); soma += v * (i + 1); });
  codes.push(soma % 103, 106);
  let m = '';
  for (const c of codes) [...PADROES_CODE128[c]].forEach((w, i) => { m += (i % 2 === 0 ? '1' : '0').repeat(Number(w)); });
  return { modulos: m, texto: [{ s: chars.join(''), x: 0, w: m.length }] };
}

const C39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn',
  G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww',
  O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw',
  W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
  $: 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn',
};
function code39(valor: string, larga: number): Desenho | null {
  const s = `*${valor.toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '')}*`;
  const w = Math.max(2, Math.round(larga));
  let m = '';
  for (const c of s) { [...C39[c]].forEach((x, i) => { m += (i % 2 === 0 ? '1' : '0').repeat(x === 'w' ? w : 1); }); m += '0'; }
  return { modulos: m, texto: [{ s: valor, x: 0, w: m.length }] };
}

/** o desenho do código de barras do tipo do FastReport; tipo desconhecido ou texto que o tipo não aceita vira Code-128. */
export function desenhar(tipo: string, valor: string, calcCheck: boolean, larga: number): Desenho | null {
  const t = (tipo || '').toLowerCase();
  let d: Desenho | null = null;
  if (t === 'bccodeean13' || t === 'bccodeupc_a') d = ean13(valor, calcCheck);
  else if (t === 'bccodeean8') d = ean8(valor, calcCheck);
  else if (t.startsWith('bccode_2_5') || t === 'bccodeitf14') d = itf(valor, larga);
  else if (t.startsWith('bccode39')) d = code39(valor, larga);
  return d ?? code128(valor);
}
