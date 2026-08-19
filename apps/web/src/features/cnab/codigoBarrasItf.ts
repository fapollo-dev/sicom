/**
 * Código de barras do boleto no padrão FEBRABAN: **Intercalado 2 de 5** (ITF), 44 dígitos.
 *
 * O ITF codifica os dígitos em PARES: o 1º do par vira 5 BARRAS e o 2º vira os 5 ESPAÇOS entremeados; em cada
 * grupo de 5, exatamente 2 elementos são largos (a razão larga/estreita do boleto é 3:1, o que a especificação
 * pede entre 2:1 e 3:1). O código começa com o start (barra-espaço-barra-espaço estreitos) e termina com o stop
 * (barra larga, espaço estreito, barra estreita).
 *
 * Como os 44 dígitos são pares, nunca há dígito sobrando — mas a função valida isso em vez de assumir.
 */
const PADRAO: Record<string, string> = {
  '0': 'nnwwn', '1': 'wnnnw', '2': 'nwnnw', '3': 'wwnnn', '4': 'nnwnw',
  '5': 'wnwnn', '6': 'nwwnn', '7': 'nnnww', '8': 'wnnwn', '9': 'nwnwn',
};

/** um elemento do desenho: barra (`true`) ou espaço, com a largura em módulos. */
export interface ElementoBarra { barra: boolean; largura: number }

/** ITF de um código de barras de boleto (44 dígitos) → a lista de barras/espaços a desenhar. */
export function codigoBarrasItf(codigo: string, larguraLarga = 3): ElementoBarra[] {
  const d = String(codigo).replace(/\D/g, '');
  if (d.length !== 44) throw new Error(`código de barras deve ter 44 dígitos (recebido: ${d.length})`);
  const out: ElementoBarra[] = [];
  // start: barra, espaço, barra, espaço — todos estreitos
  for (let i = 0; i < 4; i++) out.push({ barra: i % 2 === 0, largura: 1 });
  for (let i = 0; i < d.length; i += 2) {
    const barras = PADRAO[d[i]];
    const espacos = PADRAO[d[i + 1]];
    for (let k = 0; k < 5; k++) {
      out.push({ barra: true, largura: barras[k] === 'w' ? larguraLarga : 1 });
      out.push({ barra: false, largura: espacos[k] === 'w' ? larguraLarga : 1 });
    }
  }
  // stop: barra larga, espaço estreito, barra estreita
  out.push({ barra: true, largura: larguraLarga });
  out.push({ barra: false, largura: 1 });
  out.push({ barra: true, largura: 1 });
  return out;
}

/** o mesmo desenho como `<svg>` (string), pronto para a impressão da ficha. */
export function svgCodigoBarras(codigo: string, altura = 50, moduloPx = 1.2): string {
  const els = codigoBarrasItf(codigo);
  const total = els.reduce((s, e) => s + e.largura, 0);
  let x = 0;
  const rects = els
    .map((e) => {
      const w = e.largura * moduloPx;
      const r = e.barra ? `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${altura}" fill="#000"/>` : '';
      x += w;
      return r;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${(total * moduloPx).toFixed(2)}" height="${altura}" viewBox="0 0 ${(total * moduloPx).toFixed(2)} ${altura}" role="img" aria-label="Código de barras do boleto">${rects}</svg>`;
}
