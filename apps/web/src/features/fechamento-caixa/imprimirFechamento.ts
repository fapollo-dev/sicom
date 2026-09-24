import { imprimirPagina } from '../../shared/print/imprimirPagina';
import type { ComprovanteQuebra, LinhaHistorico } from './fechamentoCaixaApi';

/**
 * As impressões do FECHAMENTO DE CAIXA (o menu Imprimir do legado; corte 4) — o HTML sai daqui e vai para a camada global
 * de impressão (`imprimirPagina`), como o pedido de compra. A janela vem aberta do clique (popup-blocker).
 */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

/** "Comprovante de quebra de caixa.fr3": uma declaração por quebra, com a linha de assinatura */
export function imprimirComprovanteQuebra(win: Window, d: ComprovanteQuebra, operador?: string): void {
  const raiz = document.createElement('div');
  raiz.innerHTML = d.quebras.map((q) => `
    <section style="page-break-after:always;padding:24px 8px">
      <p style="font-size:13px;line-height:1.7">${esc(q.texto)}</p>
      <div style="margin:64px auto 0;width:60%;border-top:1px solid #000;text-align:center;padding-top:4px">${esc(q.nome)}</div>
    </section>`).join('');
  imprimirPagina(win, raiz, 'Comprovante de quebra de caixa', operador);
}

/** "Rel_Historico_Finalizadoras.fr3": Data, Histórico e Usuário, na ordem de gravação */
export function imprimirHistorico(win: Window, linhas: LinhaHistorico[], turno: string, operador?: string): void {
  const raiz = document.createElement('div');
  raiz.innerHTML = `<h2>${esc(turno)}</h2>
    <table><thead><tr><th>Data</th><th>Histórico</th><th>Usuário</th></tr></thead><tbody>
    ${linhas.map((l) => `<tr><td style="white-space:nowrap">${esc(l.data)}</td><td>${esc(l.historico)}</td><td>${esc(l.usuario)}</td></tr>`).join('')}
    </tbody></table>`;
  imprimirPagina(win, raiz, 'Histórico de alterações do fechamento de caixa', operador, true);
}
