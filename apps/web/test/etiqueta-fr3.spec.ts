import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentoDeImpressao, paginasDoModelo, cor } from '../src/shared/fr3/render';
import { formatFloat, formatDelphi } from '../src/shared/fr3/formato';
import { desenhar } from '../src/shared/fr3/barras';

/** os modelos vêm da tabela RELATORIOS da produção (o .fr3 que o legado carrega em Uetiqueta.pas:1407) */
const modelo = (arq: string) => readFileSync(resolve(__dirname, 'fixtures/etiquetas', arq), 'utf8');
const agora = new Date(2026, 8, 29, 11, 23, 46);
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** o registro de impressão que o servidor monta (o cdsPrint2 do legado) */
const reg = (x: Record<string, unknown>) => ({ CODBARRA: '7891150198807', DESCRICAO: 'SABAO LIQ OMO 3L UN', VRVENDA: 29.99, VRVENDA1: 24.99, VRPROMO: 24.99, QTDE: 1, MODELO: 'GONDULA PINHEIRAO', ...x });

describe('formatação do Delphi (pt-BR)', () => {
  it('FormatFloat e Format %n como o DisplayFormat dos memos', () => {
    expect(formatFloat('0.00', 24.99)).toBe('24,99');
    expect(formatFloat('#,##0.00', 1234.5)).toBe('1.234,50');
    expect(formatFloat('0.00,;"("0.00,")"', 1234.5)).toBe('1.234,50'); // a vírgula depois dos decimais também liga o milhar
    expect(formatFloat('0.00,;"("0.00,")"', -1234.5)).toBe('(1.234,50)');
    expect(formatFloat('#,##.00', 0.0056)).toBe(',01'); // o "R$ ,01" do log da produção (VLR_APRESENTACAO)
    expect(formatDelphi('%2.2n', 1234.5)).toBe('1.234,50');
    expect(formatDelphi('%2.2n', 7.49)).toBe('7,49');
    expect(formatFloat('0.00', 2.675)).toBe('2,68');
  });
  it('TColor BGR, cor do sistema e clNone', () => {
    expect(cor('255')).toBe('#ff0000');
    expect(cor('16777215')).toBe('#ffffff');
    expect(cor('-16777208')).toBe('#000000'); // clWindowText
    expect(cor('536870911')).toBeNull(); // clNone
  });
});

describe('códigos de barras do FastReport', () => {
  it('EAN-13 com 95 módulos, guardas e o 1º dígito à esquerda', () => {
    const d = desenhar('bcCodeEAN13', '7891150198807', false, 2)!;
    expect(d.modulos).toHaveLength(95);
    expect(d.modulos.startsWith('101')).toBe(true);
    expect(d.modulos.slice(45, 50)).toBe('01010');
    expect(d.texto?.[0].s).toBe('7');
  });
  it('EAN-13 sem CalcCheckSum completa com zeros como o TfrxBarcode (o código interno da banana)', () => {
    const d = desenhar('bcCodeEAN13', '0610', false, 2)!;
    expect(d.texto?.map((t) => t.s).join('')).toBe('0000000000610');
  });
  it('texto que o EAN não aceita cai no Code-128', () => {
    const d = desenhar('bcCodeEAN13', 'CX-12', false, 2)!;
    expect(d.guardas).toBeUndefined();
    expect(d.modulos.length).toBeGreaterThan(30);
  });
});

describe('modelo GONDULA PINHEIRAO (99,8% das impressões de 2026)', () => {
  const xml = modelo('gondula-pinheirao.fr3');

  it('uma etiqueta por página de 105×30 mm (banda de 24,8 mm não cabe duas)', () => {
    const pgs = paginasDoModelo(xml, [reg({}), reg({ CODBARRA: '7896098906750', DESCRICAO: 'CAFE PILAO 500G UN', VRPROMO: 22.99, VRVENDA1: 22.99 })], agora);
    expect(pgs).toHaveLength(2);
    expect(pgs[0].larguraMm).toBe(105);
    expect(pgs[0].alturaMm).toBe(30);
  });

  it('preço = IIF(VRPROMO > 0, VRPROMO, VRVENDA1) com o DisplayFormat %2.2n, a descrição, "R$" e a data/hora da impressão', () => {
    const [p] = paginasDoModelo(xml, [reg({})], agora);
    const t = texto(p.html.join(''));
    expect(t).toContain('SABAO LIQ OMO 3L UN');
    expect(t).toContain('24,99');
    expect(t).toContain('R$');
    expect(t).toContain('29/09/2026 - 11:23:46');
    expect(t).not.toContain('29,99'); // o preço de venda não aparece neste modelo
  });

  it('sem promoção, VRPROMO do registro de impressão já é o preço de venda (Uetiqueta.pas:1276)', () => {
    const [p] = paginasDoModelo(xml, [reg({ VRPROMO: 8.99, VRVENDA1: 8.99, VRVENDA: 8.99 })], agora);
    expect(texto(p.html.join(''))).toContain('8,99');
  });

  it('o código de barras EAN-13 sai em SVG com o número legível', () => {
    const [p] = paginasDoModelo(xml, [reg({})], agora);
    const h = p.html.join('');
    expect(h).toContain('<svg');
    expect(h).toContain('>891150<'); // EAN-13: 7 | 891150 | 198807
  });

  it('documento: @page nomeada no tamanho do papel e uma section por etiqueta', () => {
    const doc = documentoDeImpressao([{ modelo: 'GONDULA PINHEIRAO', registros: [reg({}), reg({}), reg({})] }], { 'GONDULA PINHEIRAO': xml }, agora);
    expect(doc.paginas).toBe(3);
    expect(doc.html).toContain('@page p105x30{size:105mm 30mm;margin:0}');
    expect((doc.html.match(/<section class="pg"/g) ?? []).length).toBe(3);
    expect(doc.avisos).toEqual([]);
  });
});

describe('script PascalScript nos eventos (Gondula Promocao 2)', () => {
  const xml = modelo('gondula-promocao-2.fr3');
  it('com promoção: o evento do MemoVenda mostra "DE R$" e escreve o "POR R$" no outro memo', () => {
    const [p] = paginasDoModelo(xml, [reg({ VRVENDA: 9.99, VRPROMO: 7.99 })], agora);
    const t = texto(p.html.join(''));
    expect(t).toContain('DE R$ 9.99'.replace('.', ','));
    expect(t).toContain('POR R$ 7,99');
  });
  it('sem promoção: MemoVenda fica invisível e o preço sai "R$ 9,99"', () => {
    const [p] = paginasDoModelo(xml, [reg({ VRVENDA: 9.99, VRPROMO: 0 })], agora);
    const t = texto(p.html.join(''));
    expect(t).not.toContain('DE R$');
    expect(t).toContain('R$ 9,99');
  });
});

describe('etiqueta atacarejo — páginas ligadas às variáveis PAGINA1..4 no OnStartReport', () => {
  const xml = modelo('etiqueta-atacarejo.fr3');
  it('as variáveis do arquivo (PAGINA1=S, PAGINA2=S) ligam só as duas primeiras páginas', () => {
    const pgs = paginasDoModelo(xml, [reg({ ATACAREJO_QTD_VALORES: 0 })], agora);
    expect(pgs.length).toBe(2);
  });
  it('as variáveis que o legado passa (Uetiqueta.pas:1456) mandam', () => {
    const pgs = paginasDoModelo(xml, [reg({ ATACAREJO_QTD_VALORES: 0 })], agora, { PAGINA1: "'S'", PAGINA2: "'N'", PAGINA3: "'N'", PAGINA4: "'N'" });
    expect(pgs.length).toBe(1);
  });
});

describe('folha A4 com colunas (etiqueta 3 colunas A4)', () => {
  const xml = modelo('etiqueta-3-colunas-a4.fr3');
  it('três etiquetas lado a lado na mesma linha, a quarta desce', () => {
    const [p] = paginasDoModelo(xml, [1, 2, 3, 4].map((i) => reg({ DESCRICAO: `PRODUTO ${i}` })), agora);
    const tops = p.html.map((h) => /top:([\d.]+)px/.exec(h)?.[1]);
    expect(tops.slice(0, 3)).toEqual([tops[0], tops[0], tops[0]]);
    expect(Number(tops[3])).toBeGreaterThan(Number(tops[0]));
    expect(texto(p.html.join(''))).toContain('8,33'); // [<VRVENDA1> / 3] com %2.2n
  });
});
