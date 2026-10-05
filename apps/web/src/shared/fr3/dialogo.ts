/**
 * O DIÁLOGO DO LAYOUT (TfrxDialogPage): alguns .fr3 do cliente perguntam antes de montar o relatório — o recibopagar.fr3 ("Recibo" ×
 * "Lista de recibos"), o PedidoRetaguarda e o RelMovimPedidos (analítico × sintético). O FastReport mostra a janela, o usuário marca e
 * clica, e o OnClick do botão (script do layout) liga/desliga as páginas. Aqui a pergunta sai na própria janela de impressão (já aberta
 * no clique): os checks rodam o OnClick deles (o que desmarca o outro), os rádios do mesmo grupo se excluem, e o botão devolve a resposta.
 */
import { clicarNoDialogo, type DialogoDoModelo, type RespostaDialogo } from './render';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

export function perguntarNoDialogo(win: Window, dlg: DialogoDoModelo, xml: string): Promise<RespostaDialogo> {
  const botoes = dlg.botoes.length ? dlg.botoes : [{ nome: '', caption: 'OK' }];
  const doc = win.document;
  doc.open();
  doc.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(dlg.titulo)}</title><style>
    body{font:14px system-ui,sans-serif;background:#f3f3f3;display:flex;justify-content:center;padding:48px 16px}
    form{background:#fff;border:1px solid #ccc;border-radius:6px;padding:20px 24px;min-width:280px;display:flex;flex-direction:column;gap:12px}
    h1{font-size:16px;margin:0 0 4px} label{display:flex;gap:8px;align-items:center} .bt{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
    button{padding:6px 16px;font:inherit;cursor:pointer}</style></head><body><form id="f"><h1>${esc(dlg.titulo)}</h1>
    ${dlg.controles.map((c) => `<label><input type="${c.tipo === 'check' ? 'checkbox' : 'radio'}" name="${esc(c.tipo === 'radio' ? c.grupo : c.nome)}" id="c_${esc(c.nome)}" ${c.marcado ? 'checked' : ''}>${esc(c.caption)}</label>`).join('')}
    <div class="bt">${botoes.map((b, i) => `<button type="button" id="b_${i}">${esc(b.caption)}</button>`).join('')}</div></form></body></html>`);
  doc.close();
  const ler = (): Record<string, boolean> => Object.fromEntries(dlg.controles.map((c) => [c.nome, !!(doc.getElementById(`c_${c.nome}`) as HTMLInputElement | null)?.checked]));
  for (const c of dlg.controles.filter((x) => x.tipo === 'check')) {
    doc.getElementById(`c_${c.nome}`)?.addEventListener('change', () => {
      const novos = clicarNoDialogo(xml, c.nome, ler());
      for (const [k, v] of Object.entries(novos)) { const el = doc.getElementById(`c_${k}`) as HTMLInputElement | null; if (el) el.checked = v; }
    });
  }
  return new Promise((resolve) => {
    botoes.forEach((b, i) => doc.getElementById(`b_${i}`)?.addEventListener('click', () => resolve({ marcados: ler(), botao: b.nome || undefined })));
  });
}
