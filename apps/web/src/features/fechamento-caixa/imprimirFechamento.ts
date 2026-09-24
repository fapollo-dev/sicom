import { imprimirPagina } from '../../shared/print/imprimirPagina';
import type { ComprovanteQuebra, LinhaHistorico, RelatorioFechamento } from './fechamentoCaixaApi';

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

/** a linha da grade do turno que o relatório de análise usa (`cdsCX_Vendas`) */
export interface LinhaGrade { data: string; nropdv: number; codoperadora: number; nome?: string | null; operacao: string; valor: number; sangrias?: number | null; suprimentos?: number | null }

/**
 * O "RELATÓRIO DE ANÁLISE" (fec_Fechamento_Caixa_{Totalizado,Descritivo}_Vendas.fr3): a grade do turno reordenada por
 * operação, data, operador e PDV. Totalizado = Σ por operação e os totais (com Suprimentos/Sangrias da grade — nulos na
 * produção, saem 0,00 como no legado); Descritivo = valor e data de cada lançamento por operação e o total geral.
 */
export function imprimirAnalise(win: Window, linhas: LinhaGrade[], modo: 'totalizado' | 'descritivo', operador?: string): void {
  const ord = [...linhas].sort((a, b) => a.operacao.localeCompare(b.operacao) || a.data.localeCompare(b.data) || a.codoperadora - b.codoperadora || a.nropdv - b.nropdv);
  const primeiro = ord[0];
  const dia = primeiro ? primeiro.data.slice(0, 10).split('-').reverse().join('/') : '';
  const total = ord.reduce((s, l) => s + l.valor, 0);
  const ops = [...new Set(ord.map((l) => l.operacao))];
  const raiz = document.createElement('div');
  if (modo === 'totalizado') {
    const sup = ord.reduce((s, l) => s + Number(l.suprimentos ?? 0), 0);
    const san = ord.reduce((s, l) => s + Number(l.sangrias ?? 0), 0);
    const tot = (rotulo: string) => `<tr><th>${rotulo}</th><th class="text-right">${num2(total)}</th></tr><tr><td>Suprimentos:</td><td class="text-right">${num2(sup)}</td></tr><tr><td>Sangrias:</td><td class="text-right">${num2(san)}</td></tr>`;
    raiz.innerHTML = `
      <h2>Fechamento do dia : ${esc(dia)}</h2>
      <h3>Operador : ${esc(primeiro?.nome ?? primeiro?.codoperadora ?? '')} · Nº do PDV : ${String(primeiro?.nropdv ?? '').padStart(3, '0')}</h3>
      <table><thead><tr><th>Operação</th><th class="text-right">Total</th></tr></thead><tbody>
        ${ops.map((o) => `<tr><td>${esc(o)}</td><td class="text-right">R$ ${num2(ord.filter((l) => l.operacao === o).reduce((s, l) => s + l.valor, 0))}</td></tr>`).join('')}
      </tbody></table>
      <table><tbody>${tot('Total do operador no PDV :')}${tot('Total do operador:')}${tot('Total do dia:')}${tot('Total Geral:')}</tbody></table>`;
  } else {
    raiz.innerHTML = `
      <h3>Operador: ${primeiro?.codoperadora ?? ''} - ${esc(primeiro?.nome ?? '')} · Caixa: ${primeiro?.nropdv ?? ''}</h3>
      ${ops.map((o) => `<h3>${esc(o)}</h3><table><thead><tr><th class="text-right">Valor</th><th>Data</th></tr></thead><tbody>
        ${ord.filter((l) => l.operacao === o).map((l) => `<tr><td class="text-right">${num2(l.valor)}</td><td>${esc(l.data.slice(0, 10).split('-').reverse().join('/'))}</td></tr>`).join('')}
      </tbody></table>`).join('')}
      <table><tbody><tr><th>Total:</th><th class="text-right">${num2(total)}</th></tr></tbody></table>`;
  }
  imprimirPagina(win, raiz, modo === 'totalizado' ? 'RELATÓRIO DE FECHAMENTO DE CAIXA' : 'FECHAMENTO DE CAIXA', operador);
}
