/**
 * IMPRESSÃO DE TELA — o substituto do FastReport (.fr3) do legado, decisão de arquitetura registrada:
 * em vez de um servidor de relatórios, a tela imprime O QUE ELA JÁ MOSTRA — clona o conteúdo renderizado
 * (KPIs + tabelas), remove o que é interação (filtros, botões, inputs) e manda para o diálogo nativo
 * (window.print), onde o operador escolhe impressora ou "Salvar como PDF". Mesmo padrão consolidado nas
 * Etiquetas de Preço (printLabels.ts). Serve TODAS as telas sem código por relatório.
 *
 * ⚠️ A janela deve ser aberta SÍNCRONA no handler do clique (lição das etiquetas: o popup-blocker engole
 * janelas abertas fora do gesto do usuário) — por isso recebe `win` pronto.
 */
export function imprimirPagina(win: Window, raiz: HTMLElement, titulo: string, operador?: string): void {
  const clone = raiz.cloneNode(true) as HTMLElement;
  // remove interação: botões, campos, selects, checkboxes e os rótulos/painéis de filtro
  clone.querySelectorAll('button, input, select, textarea, label').forEach((el) => el.remove());
  // painéis que ficaram vazios (a barra de filtros sem os campos) somem
  clone.querySelectorAll('div').forEach((el) => {
    if (!el.textContent?.trim() && !el.querySelector('table, svg')) el.remove();
  });
  const quando = new Date().toLocaleString('pt-BR');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(titulo)}</title><style>
    *{box-sizing:border-box;margin:0;padding:0;color:#000!important;background:#fff!important;border-color:#999!important}
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;padding:18px}
    .cab{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:10px}
    .cab h1{font-size:15px}
    .cab small{color:#333!important}
    table{width:100%;border-collapse:collapse;margin:6px 0}
    th,td{border:1px solid #bbb;padding:3px 6px;text-align:left;font-size:10.5px}
    th{background:#eee!important;font-weight:700}
    td.text-right,th.text-right,[class*="text-right"]{text-align:right}
    [class*="tabular-nums"]{font-variant-numeric:tabular-nums}
    h1,h2,h3,.text-title-sm{font-size:12px;margin:8px 0 2px}
    tr{page-break-inside:avoid}
    thead{display:table-header-group}
    @media print{ @page{ margin:12mm } }
  </style></head><body>
    <div class="cab"><h1>${escapeHtml(titulo)}</h1><small>${escapeHtml(operador ?? '')} · ${quando}</small></div>
    ${clone.innerHTML}
  </body></html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  // espera o layout assentar antes do diálogo (Safari/Chrome divergem no timing do write)
  setTimeout(() => { try { win.print(); } catch { /* janela fechada pelo usuário */ } }, 250);
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}
