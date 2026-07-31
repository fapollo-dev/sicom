import { barcodeSvg } from './barcode';
import type { Etiqueta } from './etiquetaApi';

const brl = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** monta o HTML de UMA etiqueta de gôndola (descrição + preço grande + de/por se promo + unidade + barcode). */
function labelHtml(e: Etiqueta): string {
  const promo = e.promocao === 'S' && e.valor_promocao > 0;
  const de = promo ? `<div class="de">de R$ ${brl(e.valor_venda)} por</div>` : '';
  const preco = promo ? e.valor_venda_promocao : e.valor_venda;
  const bc = e.codbarra ? barcodeSvg(e.codbarra, { height: 34, moduleWidth: 1.3 }) : '';
  const cb = e.codbarra ? `<div class="cb">${e.codbarra}</div>` : '';
  return `<div class="label${promo ? ' promo' : ''}">
    <div class="desc">${escapeHtml(e.descricao)}</div>
    ${de}
    <div class="preco"><span class="cifrao">R$</span> ${brl(preco)}<span class="un"> / ${escapeHtml(e.unidade ?? 'UN')}</span></div>
    <div class="bc">${bc}${cb}</div>
  </div>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}

/** escreve a grade de etiquetas (cada uma replicada por qtde) numa janela JÁ ABERTA e dispara window.print().
 *  A janela é aberta SÍNCRONA no handler do clique (fold auditoria: senão o popup-blocker consumia o item sem
 *  imprimir — abrir antes de marcar IMPRESSA='S' permite abortar quando bloqueado). */
export function printEtiquetas(etiquetas: Etiqueta[], win: Window): void {
  const labels: string[] = [];
  for (const e of etiquetas) {
    const n = Math.max(1, Math.min(9999, Math.round(e.qtde || 1)));
    for (let i = 0; i < n; i++) labels.push(labelHtml(e));
  }
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas</title><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#000;padding:6px}
    .grid{display:flex;flex-wrap:wrap;gap:4px}
    .label{width:220px;height:132px;border:1px solid #bbb;border-radius:4px;padding:6px 8px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;page-break-inside:avoid}
    .label.promo{border-color:#c026d3;border-width:2px}
    .desc{font-size:12px;font-weight:600;line-height:1.15;max-height:28px;overflow:hidden}
    .de{font-size:11px;color:#777;text-decoration:line-through}
    .preco{font-size:30px;font-weight:800;letter-spacing:-1px;line-height:1}
    .label.promo .preco{color:#c026d3}
    .cifrao{font-size:15px;font-weight:700;vertical-align:top}
    .un{font-size:11px;font-weight:600;color:#555;letter-spacing:0}
    .bc{text-align:center}
    .bc svg{max-width:100%;height:34px}
    .cb{font-size:10px;letter-spacing:1px;font-variant-numeric:tabular-nums}
    @media print{body{padding:0}.label{border-color:#999}@page{margin:6mm}}
  </style></head><body><div class="grid">${labels.join('')}</div>
  <script>window.onload=function(){setTimeout(function(){window.print()},150)}</script></body></html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
}
