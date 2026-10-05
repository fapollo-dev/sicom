/**
 * O `TfrxChartView` do FastReport: o `PropData` é o stream binário do Delphi (`TWriter`) com duas propriedades — `Chart` (o TChart do
 * TeeChart serializado, `TPF0`) e `SeriesData` (uma string de atributos por série: o dataset, a fonte do X e do Y, a ordem, o TopN). Aqui
 * se lê o stream e se desenha o gráfico em SVG: pizza, barras (verticais e horizontais) e linha — os quatro tipos que os modelos do
 * cliente usam (TPieSeries 23, TBarSeries 18, TFastLineSeries 2, TLineSeries 1, na RELATORIOS da produção).
 *
 * Os padrões do TeeChart que o stream não grava (só o que difere do padrão vai para o DFM): legenda visível à direita com o valor à
 * esquerda do rótulo (`ltsLeftValue`), marcas invisíveis no estilo rótulo (`smsLabel`), formato de valor `#,##0.###`, eixos visíveis.
 * O 3D do TeeChart vira plano — a forma muda, os números não.
 */
import { formatFloat } from './formato';

export type ValorDfm = null | boolean | number | string | { id: string } | ValorDfm[] | Uint8Array | { colecao: Record<string, ValorDfm>[] } | { conjunto: string[] };
export interface ObjetoDfm { classe: string; nome: string; props: Record<string, ValorDfm>; filhos: ObjetoDfm[] }

class Leitor {
  i = 0;
  constructor(private readonly b: Uint8Array) {}
  get fim() { return this.i >= this.b.length; }
  byte() { return this.b[this.i++]; }
  espia() { return this.b[this.i]; }
  int(n: 1 | 2 | 4) {
    const dv = new DataView(this.b.buffer, this.b.byteOffset + this.i, n);
    this.i += n;
    return n === 1 ? dv.getInt8(0) : n === 2 ? dv.getInt16(0, true) : dv.getInt32(0, true);
  }
  bytes(n: number) { const r = this.b.subarray(this.i, this.i + n); this.i += n; return r; }
  latin1(n: number) { let s = ''; for (const c of this.bytes(n)) s += String.fromCharCode(c); return s; }
  curta() { return this.latin1(this.byte()); }
  valor(): ValorDfm {
    const t = this.byte();
    switch (t) {
      case 0: return null;
      case 1: { const l: ValorDfm[] = []; while (this.espia() !== 0) l.push(this.valor()); this.i++; return l; }
      case 2: return this.int(1);
      case 3: return this.int(2);
      case 4: return this.int(4);
      case 5: { // Extended (80 bits): mantissa de 64 bits + expoente de 15
        const b = this.bytes(10);
        let m = 0;
        for (let k = 7; k >= 0; k--) m = m * 256 + b[k];
        const e = ((b[9] & 0x7f) << 8) | b[8];
        const v = e === 0 && m === 0 ? 0 : m * 2 ** (e - 16383 - 63);
        return b[9] & 0x80 ? -v : v;
      }
      case 6: return this.curta();
      case 7: return { id: this.curta() };
      case 8: return false;
      case 9: return true;
      case 10: return this.bytes(this.int(4)).slice();
      case 11: { const s: string[] = []; while (this.espia() !== 0) s.push(this.curta()); this.i++; return { conjunto: s }; }
      case 12: case 20: { const n = this.int(4); const raw = this.bytes(n); return t === 20 ? new TextDecoder().decode(raw) : Array.from(raw, (c) => String.fromCharCode(c)).join(''); }
      case 13: return null;
      case 14: {
        const itens: Record<string, ValorDfm>[] = [];
        while (this.espia() !== 0) {
          if ([2, 3, 4].includes(this.espia())) this.valor();
          this.i++; // vaList
          const p: Record<string, ValorDfm> = {};
          while (this.espia() !== 0) { const k = this.curta(); p[k] = this.valor(); }
          this.i++;
          itens.push(p);
        }
        this.i++;
        return { colecao: itens };
      }
      case 15: { const dv = new DataView(this.b.buffer, this.b.byteOffset + this.i, 4); this.i += 4; return dv.getFloat32(0, true); }
      case 16: case 17: case 19: case 21: {
        const dv = new DataView(this.b.buffer, this.b.byteOffset + this.i, 8); this.i += 8;
        if (t === 21 || t === 17) return dv.getFloat64(0, true);
        const v = Number(dv.getBigInt64(0, true));
        return t === 16 ? v / 10000 : v;
      }
      case 18: { const n = this.int(4); let s = ''; for (let k = 0; k < n; k++) s += String.fromCharCode(this.int(2) & 0xffff); return s; }
      default: throw new Error(`tipo de valor DFM desconhecido: ${t}`);
    }
  }
  objeto(): ObjetoDfm {
    if ((this.espia() & 0xf0) === 0xf0) { const f = this.byte(); if (f & 2) this.valor(); }
    const classe = this.curta();
    const nome = this.curta();
    const props: Record<string, ValorDfm> = {};
    while (this.espia() !== 0) { const k = this.curta(); props[k] = this.valor(); }
    this.i++;
    const filhos: ObjetoDfm[] = [];
    while (!this.fim && this.espia() !== 0) filhos.push(this.objeto());
    this.i++;
    return { classe, nome, props, filhos };
  }
}

const hexParaBytes = (hex: string): Uint8Array => {
  const h = hex.replace(/\s/g, '');
  const b = new Uint8Array(h.length >> 1);
  for (let k = 0; k < b.length; k++) b[k] = parseInt(h.substr(k * 2, 2), 16);
  return b;
};

/** as propriedades gravadas por `DefineProperties` (nome + valor, até o fim) */
export function lerPropriedades(hex: string): Record<string, ValorDfm> {
  const l = new Leitor(hexParaBytes(hex));
  const out: Record<string, ValorDfm> = {};
  while (!l.fim && l.espia() !== 0) { const k = l.curta(); out[k] = l.valor(); }
  return out;
}

/** um componente serializado (`TPF0` + objeto) */
export function lerObjeto(b: Uint8Array): ObjetoDfm {
  const l = new Leitor(b);
  if (l.latin1(4) !== 'TPF0') l.i = 0;
  return l.objeto();
}

export interface SerieGrafico { classe: string; props: Record<string, ValorDfm>; fonte: Record<string, string> }
export interface DefinicaoGrafico { chart: Record<string, ValorDfm>; series: SerieGrafico[] }

const desescapa = (s: string) => s.replace(/&#34;/g, '"').replace(/&quot;/g, '"').replace(/&#38;|&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** o TChart e as séries com a fonte dos dados de cada uma */
export function definicaoGrafico(propData: string | undefined): DefinicaoGrafico | null {
  if (!propData) return null;
  try {
    const p = lerPropriedades(propData);
    const bin = p.Chart;
    if (!(bin instanceof Uint8Array)) return null;
    const chart = lerObjeto(bin);
    const textos: string[] = [];
    const junta = (v: ValorDfm) => {
      if (typeof v === 'string') textos.push(v);
      else if (Array.isArray(v)) v.forEach(junta);
    };
    junta(p.SeriesData ?? null);
    const fontes = textos.map((t) => Object.fromEntries([...t.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], desescapa(m[2])])));
    return { chart: chart.props, series: chart.filhos.map((f, k) => ({ classe: f.classe, props: f.props, fonte: fontes[k] ?? {} })) };
  } catch {
    return null;
  }
}

export interface Ponto { x: string; y: number }

/** a paleta padrão do TeeChart (TeeChart `ColorPalette`) */
const PALETA = ['#ff0000', '#008000', '#ffff00', '#0000ff', '#ffffff', '#808080', '#ff00ff', '#008080', '#000080', '#800000', '#00ff00', '#808000', '#800080', '#c0c0c0', '#00ffff', '#000000'];
const CORES: Record<string, string> = { clred: '#ff0000', clgreen: '#008000', clyellow: '#ffff00', clblue: '#0000ff', clwhite: '#ffffff', clgray: '#808080', clfuchsia: '#ff00ff', clteal: '#008080', clnavy: '#000080', clmaroon: '#800000', cllime: '#00ff00', clolive: '#808000', clpurple: '#800080', clsilver: '#c0c0c0', claqua: '#00ffff', clblack: '#000000' };
const corDfm = (v: ValorDfm | undefined): string | null => {
  if (v && typeof v === 'object' && 'id' in v) return CORES[v.id.toLowerCase()] ?? null;
  if (typeof v === 'number') { const u = v >>> 0; return `#${[u & 0xff, (u >> 8) & 0xff, (u >> 16) & 0xff].map((x) => x.toString(16).padStart(2, '0')).join('')}`; }
  return null;
};
const id = (v: ValorDfm | undefined): string => (v && typeof v === 'object' && 'id' in v ? v.id : '');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** os passos "redondos" do eixo (1, 2, 5 × 10^n) */
function escala(min: number, max: number, alvo = 6): { ini: number; fim: number; passo: number } {
  if (min === max) { if (max === 0) return { ini: 0, fim: 1, passo: 0.2 }; min = Math.min(0, min); max = Math.max(0, max); }
  const bruto = (max - min) / alvo;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 5, 10].map((m) => m * mag).find((p) => p >= bruto) ?? 10 * mag;
  return { ini: Math.floor(min / passo) * passo, fim: Math.ceil(max / passo) * passo, passo };
}

/** o gráfico em SVG, do tamanho do objeto do relatório */
export function svgGrafico(def: DefinicaoGrafico, pontos: Ponto[][], W: number, H: number): string {
  const c = def.chart;
  const series = def.series.map((s, k) => ({ ...s, pts: pontos[k] ?? [] })).filter((s) => s.props.Active !== false);
  const fundo = corDfm(c.Color) ?? '#ffffff';
  const fonte = 'font-family="Tahoma, Arial, sans-serif"';
  const partes: string[] = [`<rect width="${W}" height="${H}" fill="${fundo}"/>`];
  let topo = 4;
  const titulo = Array.isArray(c['Title.Text.Strings']) ? (c['Title.Text.Strings'] as ValorDfm[]).filter((x) => typeof x === 'string').join(' ') : '';
  if (titulo && c['Title.Visible'] !== false) {
    partes.push(`<text x="${W / 2}" y="${topo + 12}" text-anchor="middle" font-size="12" font-weight="bold" ${fonte}>${esc(titulo)}</text>`);
    topo += 18;
  }
  if (c['Border.Visible'] === true) partes.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#000"/>`);
  const fmt = (s: SerieGrafico, v: number) => formatFloat(typeof s.props.ValueFormat === 'string' ? s.props.ValueFormat : '#,##0.###', v);
  const pizza = series.find((s) => s.classe === 'TPieSeries');
  const porPonto = !!pizza || series.some((s) => s.props.ColorEachPoint === true);
  const corPonto = (k: number) => PALETA[k % PALETA.length];

  // a legenda: os pontos (pizza / ColorEachPoint) ou as séries
  const legendaVisivel = c['Legend.Visible'] !== false && series.length > 0;
  const estilo = id(c['Legend.TextStyle']) || 'ltsLeftValue';
  const alinhamento = id(c['Legend.Alignment']) || 'laRight';
  const base = porPonto ? (pizza ?? series[0]) : null;
  const itensLegenda = porPonto && base
    ? base.pts.map((p, k) => ({ cor: corPonto(k), texto: estilo === 'ltsRightValue' ? `${p.x} ${fmt(base, p.y)}` : estilo === 'ltsLabelOnly' ? p.x : estilo === 'ltsValue' ? fmt(base, p.y) : `${fmt(base, p.y)} ${p.x}` }))
    : series.map((s, k) => ({ cor: corDfm(s.props.SeriesColor) ?? corDfm(s.props['LinePen.Color']) ?? PALETA[k % PALETA.length], texto: typeof s.props.Title === 'string' ? s.props.Title : `Series${k + 1}` }));
  let area = { x: 6, y: topo, w: W - 12, h: H - topo - 6 };
  if (legendaVisivel && itensLegenda.length) {
    const fs = 10;
    const larg = Math.min(W * 0.4, Math.max(...itensLegenda.map((i) => i.texto.length)) * fs * 0.55 + 22);
    const alt = itensLegenda.length * (fs + 4) + 8;
    let lx: number; let ly: number;
    if (alinhamento === 'laLeft') { lx = 4; ly = topo; area = { ...area, x: larg + 10, w: area.w - larg - 6 }; }
    else if (alinhamento === 'laTop' || alinhamento === 'laBottom') {
      const linha = itensLegenda.map((i) => i.texto.length * fs * 0.55 + 22).reduce((a, b) => a + b, 0);
      lx = Math.max(4, (W - linha) / 2);
      ly = alinhamento === 'laTop' ? topo : H - fs - 10;
      if (alinhamento === 'laTop') area = { ...area, y: area.y + fs + 10, h: area.h - fs - 10 }; else area = { ...area, h: area.h - fs - 12 };
      let x = lx;
      const g: string[] = [];
      for (const i of itensLegenda) {
        g.push(`<rect x="${x}" y="${ly + 2}" width="9" height="9" fill="${i.cor}" stroke="#000" stroke-width="0.5"/><text x="${x + 12}" y="${ly + 10}" font-size="${fs}" ${fonte}>${esc(i.texto)}</text>`);
        x += i.texto.length * fs * 0.55 + 22;
      }
      partes.push(...g);
      lx = -1;
    } else { lx = W - larg - 4; ly = topo + Math.max(0, (H - topo - alt) / 2); area = { ...area, w: area.w - larg - 6 }; }
    if (lx >= 0) {
      partes.push(`<rect x="${lx}" y="${ly}" width="${larg}" height="${alt}" fill="#fff" stroke="#000" stroke-width="0.5"/>`);
      itensLegenda.forEach((i, k) => {
        const y = ly + 4 + k * (fs + 4);
        partes.push(`<rect x="${lx + 4}" y="${y + 1}" width="9" height="9" fill="${i.cor}" stroke="#000" stroke-width="0.5"/><text x="${lx + 17}" y="${y + 9}" font-size="${fs}" ${fonte}>${esc(i.texto)}</text>`);
      });
    }
  }

  const marca = (s: SerieGrafico, p: Ponto, total: number): string => {
    const st = id(s.props['Marks.Style']) || 'smsLabel';
    const pct = total ? `${formatFloat('0', (p.y / total) * 100)} %` : '0 %';
    switch (st) {
      case 'smsValue': return fmt(s, p.y);
      case 'smsPercent': return pct;
      case 'smsLabelPercent': return `${p.x} ${pct}`;
      case 'smsLabelValue': return `${p.x} ${fmt(s, p.y)}`;
      case 'smsPercentTotal': return `${pct} de ${fmt(s, total)}`;
      default: return p.x || fmt(s, p.y);
    }
  };

  if (pizza) {
    const pts = pizza.pts.filter((p) => p.y > 0);
    const total = pts.reduce((a, p) => a + p.y, 0);
    const r = Math.max(4, Math.min(area.w, area.h) / 2 - (pizza.props['Marks.Visible'] === true ? 14 : 4));
    const cx = area.x + area.w / 2; const cy = area.y + area.h / 2;
    let ang = -Math.PI / 2;
    pizza.pts.forEach((p, k) => {
      if (!(p.y > 0) || !total) return;
      const a = (p.y / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang);
      const x2 = cx + r * Math.cos(ang + a), y2 = cy + r * Math.sin(ang + a);
      partes.push(a >= Math.PI * 2 - 1e-9
        ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${corPonto(k)}" stroke="#000" stroke-width="0.5"/>`
        : `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${corPonto(k)}" stroke="#000" stroke-width="0.5"/>`);
      if (pizza.props['Marks.Visible'] === true) {
        const m = ang + a / 2;
        const tx = cx + (r + 8) * Math.cos(m), ty = cy + (r + 8) * Math.sin(m);
        partes.push(`<text x="${tx.toFixed(2)}" y="${(ty + 3).toFixed(2)}" text-anchor="${Math.cos(m) >= 0 ? 'start' : 'end'}" font-size="9" ${fonte}>${esc(marca(pizza, p, total))}</text>`);
      }
      ang += a;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(2)}" height="${H.toFixed(2)}" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}">${partes.join('')}</svg>`;
  }

  // barras e linhas: os eixos
  const todos = series.flatMap((s) => s.pts.map((p) => p.y));
  const rotulos = (series[0]?.pts ?? []).map((p) => p.x);
  const horizontal = series.some((s) => s.classe === 'THorizBarSeries');
  const { ini, fim, passo } = escala(Math.min(0, ...todos), Math.max(0, ...todos));
  const eixos = c.AxisVisible !== false;
  const margemEsq = eixos ? Math.max(...[ini, fim].map((v) => formatFloat('#,##0.###', v).length)) * 6 + 10 : 4;
  const plot = { x: area.x + (horizontal ? Math.max(...rotulos.map((r) => r.length), 2) * 5.5 + 8 : margemEsq), y: area.y + 8, w: 0, h: 0 };
  plot.w = Math.max(10, area.x + area.w - plot.x - 6);
  plot.h = Math.max(10, area.y + area.h - plot.y - (eixos && !horizontal ? 16 : 6));
  const escalaV = (v: number) => (horizontal ? plot.x + ((v - ini) / (fim - ini)) * plot.w : plot.y + plot.h - ((v - ini) / (fim - ini)) * plot.h);
  if (eixos) {
    for (let v = ini; v <= fim + passo / 2; v += passo) {
      const p = escalaV(v);
      partes.push(horizontal
        ? `<line x1="${p}" y1="${plot.y}" x2="${p}" y2="${plot.y + plot.h}" stroke="#ddd"/><text x="${p}" y="${plot.y + plot.h + 11}" text-anchor="middle" font-size="9" ${fonte}>${esc(formatFloat('#,##0.###', v))}</text>`
        : `<line x1="${plot.x}" y1="${p}" x2="${plot.x + plot.w}" y2="${p}" stroke="#ddd"/><text x="${plot.x - 4}" y="${p + 3}" text-anchor="end" font-size="9" ${fonte}>${esc(formatFloat('#,##0.###', v))}</text>`);
    }
    partes.push(`<line x1="${plot.x}" y1="${plot.y}" x2="${plot.x}" y2="${plot.y + plot.h}" stroke="#000"/><line x1="${plot.x}" y1="${plot.y + plot.h}" x2="${plot.x + plot.w}" y2="${plot.y + plot.h}" stroke="#000"/>`);
  }
  const n = Math.max(1, rotulos.length);
  const faixa = (horizontal ? plot.h : plot.w) / n;
  if (eixos) {
    rotulos.forEach((r, k) => {
      const meio = (horizontal ? plot.y : plot.x) + faixa * (k + 0.5);
      partes.push(horizontal
        ? `<text x="${plot.x - 4}" y="${meio + 3}" text-anchor="end" font-size="9" ${fonte}>${esc(r)}</text>`
        : `<text x="${meio}" y="${plot.y + plot.h + 11}" text-anchor="middle" font-size="9" ${fonte}>${esc(r)}</text>`);
    });
  }
  const barras = series.filter((s) => s.classe === 'TBarSeries' || s.classe === 'THorizBarSeries');
  barras.forEach((s, ks) => {
    const total = s.pts.reduce((a, p) => a + p.y, 0);
    const largura = (faixa * (typeof s.props.BarWidthPercent === 'number' ? s.props.BarWidthPercent : 70)) / 100;
    const cada = largura / barras.length;
    const corSerie = corDfm(s.props.SeriesColor) ?? PALETA[ks % PALETA.length];
    s.pts.forEach((p, k) => {
      const corB = s.props.ColorEachPoint === true ? corPonto(k) : corSerie;
      const p0 = escalaV(0), p1 = escalaV(p.y);
      const pos = (horizontal ? plot.y : plot.x) + faixa * k + (faixa - largura) / 2 + cada * ks;
      partes.push(horizontal
        ? `<rect x="${Math.min(p0, p1).toFixed(2)}" y="${pos.toFixed(2)}" width="${Math.abs(p1 - p0).toFixed(2)}" height="${cada.toFixed(2)}" fill="${corB}" stroke="#000" stroke-width="0.5"/>`
        : `<rect x="${pos.toFixed(2)}" y="${Math.min(p0, p1).toFixed(2)}" width="${cada.toFixed(2)}" height="${Math.abs(p1 - p0).toFixed(2)}" fill="${corB}" stroke="#000" stroke-width="0.5"/>`);
      if (s.props['Marks.Visible'] === true) {
        const t = esc(marca(s, p, total));
        partes.push(horizontal
          ? `<text x="${(Math.max(p0, p1) + 3).toFixed(2)}" y="${(pos + cada / 2 + 3).toFixed(2)}" font-size="9" ${fonte}>${t}</text>`
          : `<text x="${(pos + cada / 2).toFixed(2)}" y="${(Math.min(p0, p1) - 3).toFixed(2)}" text-anchor="middle" font-size="9" ${fonte}>${t}</text>`);
      }
    });
  });
  series.filter((s) => s.classe === 'TLineSeries' || s.classe === 'TFastLineSeries' || s.classe === 'TAreaSeries').forEach((s, ks) => {
    const corL = corDfm(s.props['LinePen.Color']) ?? corDfm(s.props.SeriesColor) ?? PALETA[ks % PALETA.length];
    const xy = s.pts.map((p, k) => `${(plot.x + faixa * (k + 0.5)).toFixed(2)},${escalaV(p.y).toFixed(2)}`);
    if (xy.length) partes.push(`<polyline points="${xy.join(' ')}" fill="none" stroke="${corL}" stroke-width="1.5"/>`);
    if (s.props['Marks.Visible'] === true) {
      const total = s.pts.reduce((a, p) => a + p.y, 0);
      s.pts.forEach((p, k) => partes.push(`<text x="${(plot.x + faixa * (k + 0.5)).toFixed(2)}" y="${(escalaV(p.y) - 4).toFixed(2)}" text-anchor="middle" font-size="9" ${fonte}>${esc(marca(s, p, total))}</text>`));
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(2)}" height="${H.toFixed(2)}" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}">${partes.join('')}</svg>`;
}
