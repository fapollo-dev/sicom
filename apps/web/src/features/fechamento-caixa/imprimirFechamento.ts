import { imprimirPagina } from '../../shared/print/imprimirPagina';
import type { RelatorioFechamento } from './fechamentoCaixaApi';

/**
 * O relatório "Fechamento de caixa" (MontaRel) do menu Imprimir — o HTML sai daqui e vai para a camada global de impressão
 * (`imprimirPagina`). A análise, o comprovante de quebra e o histórico já saem no layout .fr3 do cliente (`imprimirRelatorio`).
 */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

const num2 = (v: number) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * O RELATÓRIO "FECHAMENTO DE CAIXA" (FechamentoCaixa.fr3): o cabeçalho da empresa e "Caixa(s) do dia"; um bloco por operador + PDV
 * com Vendas (recurso, valor) × Caixa (recurso, valor, divergência) e o rodapé — suprimento, sangria (negativa), divergência
 * vendas p/ caixa (Σ caixa − venda), desconto, cancelamentos e a observação de divergência; depois a página "Totais" por recurso.
 */
export function imprimirRelatorioFechamento(win: Window, d: RelatorioFechamento, operador?: string): void {
  const e = d.empresa;
  const rodape = (x: { totalVenda?: number; venda?: number; totalCaixa?: number; caixa?: number; divergencia: number; sangria: number; suprimento: number; desconto: number; cancelamentos: number }, obs?: string | null) => `
    <tr><th>Total</th><th class="text-right">${num2(x.totalVenda ?? x.venda ?? 0)}</th><th></th><th class="text-right">${num2(x.totalCaixa ?? x.caixa ?? 0)}</th><th></th></tr>
    </tbody></table>
    <table><tbody>
      <tr><td>Suprimento:</td><td class="text-right">${num2(x.suprimento)}</td><td>Sangria:</td><td class="text-right">${num2(-x.sangria)}</td></tr>
      <tr><td>Divergência Vendas p/ Caixa:</td><td class="text-right">${num2(x.divergencia)}</td><td>Desconto:</td><td class="text-right">${num2(x.desconto)}</td></tr>
      <tr><td>Cancelamentos:</td><td class="text-right">${num2(x.cancelamentos)}</td><td>${obs !== undefined ? 'Obs. de divergência:' : ''}</td><td>${esc(obs ?? '')}</td></tr>
    </tbody></table>`;
  const cabTabela = `<table><thead><tr><th>Vendas — Recursos</th><th class="text-right">Valor</th><th>Caixa — Recursos</th><th class="text-right">Valor</th><th class="text-right">Div. p/ vendas</th></tr></thead><tbody>`;
  const raiz = document.createElement('div');
  raiz.innerHTML = `
    <p><strong>${esc(e.razao)}</strong>${e.fantasia ? ` · ${esc(e.fantasia)}` : ''}<br>CNPJ: ${esc(e.cnpj)} · INSC: ${esc(e.insc)} · Fone: ${esc(e.fone)}</p>
    <h2>Caixa(s) do dia: ${esc(d.data)}</h2>
    ${d.grupos.map((g) => `
      <section style="page-break-inside:avoid;margin-top:10px">
        <h3>Operador(a): ${g.codoperadora} - ${esc(g.nome)} - PDV: ${g.nropdv}</h3>
        ${cabTabela}
        ${g.linhas.map((l) => `<tr><td>${esc(l.recurso)}</td><td class="text-right">${num2(l.venda)}</td><td>${esc(l.recurso)}</td><td class="text-right">${num2(l.caixa)}</td><td class="text-right">${num2(l.div)}</td></tr>`).join('')}
        ${rodape(g, g.obs)}
      </section>`).join('')}
    <section style="page-break-before:always">
      <h2>Totais</h2>
      ${cabTabela}
      ${d.totais.map((t) => `<tr><td>${esc(t.recurso)}</td><td class="text-right">${num2(t.venda)}</td><td>${esc(t.recurso)}</td><td class="text-right">${num2(t.caixa)}</td><td class="text-right">${num2(t.div)}</td></tr>`).join('')}
      ${rodape(d.total)}
    </section>`;
  imprimirPagina(win, raiz, 'Fechamento de Caixa', operador);
}
