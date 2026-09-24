import { imprimirPagina } from '../../shared/print/imprimirPagina';
import type { RelatorioAgrupamentoAP, RelatorioAgrupamentoAR } from './agrupamentoApi';

/**
 * As impressões do AGRUPAMENTO (o "Deseja imprimir o relatório do agrupamento?" do legado): no A Receber, o EXTRATO DE CONVÊNIO
 * analítico (Agrupamento.fr3), o totalizado por cliente (Agrupamentototalizado.fr3) e o extrato por funcionário
 * (Agrupamento_extrato_funcionario.fr3); no A Pagar, CONTAS À PAGAR AGRUPADAS (AgrupamentoCP.fr3 / …Agrupado.fr3) — e, no
 * convênio do mesmo CNPJ, o EXTRATO DE CONVÊNIO com os A Receber (AgrupamentoCPCR*.fr3).
 */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const brl = (v: number) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const soma = (xs: Array<{ valor: number }>) => xs.reduce((s, x) => s + x.valor, 0);
function porChave<T>(xs: T[], k: (x: T) => string): Array<[string, T[]]> {
  const m = new Map<string, T[]>();
  for (const x of xs) { const c = k(x); m.set(c, [...(m.get(c) ?? []), x]); }
  return [...m.entries()];
}

export type ModoAR = 'analitico' | 'totalizado' | 'funcionario';
export function imprimirAgrupamentoAR(win: Window, d: RelatorioAgrupamentoAR, modo: ModoAR): void {
  const c = d.consolidado;
  const cab = `<p>Razão: ${esc(d.empresa.razao)} · Fantasia: ${esc(d.empresa.fantasia)} · Cnpj: ${esc(d.empresa.cnpj)}</p>`;
  const dados = `<h3>Dados do Convênio</h3><p>Convênio: ${esc(c.cliente)} · Data da geração: ${esc(c.dtvenda)} · Valor: R$ ${brl(c.total)} · Vencimento: ${esc(c.dtvenc)}</p>`;
  const rodape = `${c.txadm > 0 ? `<tr><td>Taxa Administrativa</td><td class="text-right">${brl(c.txadm)}</td></tr>` : ''}<tr><th>Total</th><th class="text-right">R$ ${brl(c.total)}</th></tr>`;
  const raiz = document.createElement('div');
  if (modo === 'analitico') {
    raiz.innerHTML = `${cab}${dados}<h3>Títulos Agrupados</h3>
      <table><thead><tr><th>Código</th><th>Nro. Cupom</th><th>Data Venda</th><th>Data Vencimento</th><th class="text-right">Valor</th><th>PDV</th><th>Operador(a)</th><th>Loja</th></tr></thead><tbody>
      ${d.membros.map((m) => `<tr><td>${m.codrcb}</td><td>${esc(m.nrocupom)}</td><td>${esc(m.dtvenda)}</td><td>${esc(m.dtvenc)}</td><td class="text-right">${brl(m.valor)}</td><td>${esc(m.codpdv)}</td><td>${esc(m.operador)}</td><td>${m.codempresa}</td></tr>`).join('')}
      </tbody></table><table><tbody>${rodape}</tbody></table>`;
  } else if (modo === 'totalizado') {
    raiz.innerHTML = `${cab}${dados}<h3>Títulos Agrupados</h3>
      <table><tbody>${porChave(d.membros, (m) => String(m.cliente ?? m.codparceiro)).map(([k, xs]) => `<tr><td>${esc(k)}</td><td class="text-right">${brl(soma(xs))}</td></tr>`).join('')}</tbody></table>
      <table><tbody>${rodape}</tbody></table>`;
  } else {
    raiz.innerHTML = porChave(d.extrato, (e) => e.nome).map(([nome, xs]) => `
      <section style="page-break-inside:avoid"><h3>Funcionário: ${esc(nome)} — R$ ${brl(soma(xs))}</h3>
      ${porChave(xs, (e) => e.tipo).map(([tipo, ys]) => `<h3>${esc(tipo)} — R$ ${brl(soma(ys))}</h3>
        <table><thead><tr><th>Data</th><th>Documento</th><th>Parcelas</th><th>Observação</th><th>Cobrança</th><th class="text-right">Valor</th></tr></thead><tbody>
        ${ys.map((e) => `<tr><td>${esc(e.data)}</td><td>${e.documento}</td><td>${esc(e.parcelas)}</td><td>${esc(e.obs)}</td><td>${esc(e.tipodoc)}</td><td class="text-right">${brl(e.valor)}</td></tr>`).join('')}
        </tbody></table>`).join('')}</section>`).join('')
      + `<table><tbody><tr><th>Total geral</th><th class="text-right">${brl(soma(d.extrato))}</th></tr></tbody></table>`;
  }
  imprimirPagina(win, raiz, 'EXTRATO DE CONVÊNIO');
}

export function imprimirAgrupamentoAP(win: Window, d: RelatorioAgrupamentoAP, agrupado: boolean): void {
  const c = d.consolidado;
  const raiz = document.createElement('div');
  const cab = `<p>Empresa: ${esc(d.empresa.razao)}<br>Parceiro: ${esc(c.parceiro)} · Emissão: ${esc(c.dtcompra)} · Vencimento: ${esc(c.dtvenc)} · Valor total: ${brl(c.valor)}</p><h3>Documentos agrupados</h3>`;
  raiz.innerHTML = cab + (agrupado
    ? `<table><thead><tr><th>Cód. Parceiro</th><th>Parceiro</th><th class="text-right">Valor</th></tr></thead><tbody>
       ${porChave(d.documentos, (x) => `${x.codparceiro}|${x.razao ?? ''}`).map(([k, xs]) => { const [cod, razao] = k.split('|'); return `<tr><td>${esc(cod)}</td><td>${esc(razao)}</td><td class="text-right">${brl(soma(xs))}</td></tr>`; }).join('')}
       </tbody></table>`
    : `<table><thead><tr><th>Código</th><th>Duplicata</th>${d.convenio ? '<th>Parceiro</th>' : ''}<th>Emissão</th><th>Vencimento</th><th class="text-right">Valor</th></tr></thead><tbody>
       ${d.documentos.map((x) => `<tr><td>${x.codigo}</td><td>${esc(x.duplicata)}</td>${d.convenio ? `<td>${esc(x.razao)}</td>` : ''}<td>${esc(x.emissao)}</td><td>${esc(x.dtvenc)}</td><td class="text-right">${brl(x.valor)}</td></tr>`).join('')}
       <tr><th colspan="${d.convenio ? 5 : 4}">Total</th><th class="text-right">${brl(soma(d.documentos))}</th></tr></tbody></table>`);
  imprimirPagina(win, raiz, d.convenio ? 'EXTRATO DE CONVÊNIO' : 'CONTAS À PAGAR AGRUPADAS');
}
