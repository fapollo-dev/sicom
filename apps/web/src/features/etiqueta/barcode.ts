/**
 * Gerador mínimo de código de barras Code-128B em SVG (sem lib externa). Cobre ASCII 32–126 (dígitos, letras,
 * símbolos) — suficiente p/ codbarra de produto (EAN/numérico) e códigos internos. Code-128B: StartB(104) + valores
 * (char−32) + checksum (mod 103) + Stop(106). Retorna a MARKUP SVG (string) — usável no React (dangerouslySetInnerHTML)
 * e na janela de impressão. O legado renderiza via TfrxBarCodeObject no .fr3; aqui é um SVG imprimível equivalente.
 */

// 107 padrões Code-128 (0–106): larguras alternando BARRA/espaço (11 módulos; o Stop 106 tem 13).
const PAD = [
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

export interface BarcodeOpts {
  height?: number; // altura das barras (px)
  moduleWidth?: number; // largura de 1 módulo (px)
}

/** codifica `texto` em Code-128B e devolve o SVG (string). Chars fora de 32–126 são ignorados. */
export function barcodeSvg(texto: string, opts: BarcodeOpts = {}): string {
  const h = opts.height ?? 40;
  const mw = opts.moduleWidth ?? 1.4;
  const chars = String(texto ?? '')
    .split('')
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
  if (!chars.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="${h}"></svg>`;

  const codes: number[] = [104]; // StartB
  let sum = 104;
  chars.forEach((c, i) => {
    const v = c.charCodeAt(0) - 32;
    codes.push(v);
    sum += v * (i + 1);
  });
  codes.push(sum % 103); // checksum
  codes.push(106); // Stop

  let x = 0;
  let rects = '';
  for (const code of codes) {
    const pat = PAD[code];
    for (let i = 0; i < pat.length; i++) {
      const w = Number(pat[i]) * mw;
      if (i % 2 === 0) rects += `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${h}"/>`; // barra
      x += w;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x.toFixed(2)}" height="${h}" fill="#000">${rects}</svg>`;
}
