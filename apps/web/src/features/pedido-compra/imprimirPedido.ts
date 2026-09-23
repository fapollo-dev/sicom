import { imprimirPagina } from '../../shared/print/imprimirPagina';

/**
 * O DOCUMENTO DO PEDIDO para o fornecedor — o `ped_compra.fr3` (uma seção por LOJA, com os dados da loja e a
 * quantidade dela) e o `ped_compra_agrupado.fr3` (as lojas somadas). O dado vem de `GET compras/pedidos/:id/impressao`;
 * aqui se monta o HTML e se entrega à camada global de impressão (`imprimirPagina`).
 */
export interface LinhaImpressao {
  idproduto: number;
  codbarra: string | null;
  descricao: string | null;
  unidade: string | null;
  qtde: number;
  qtdtotal: number;
  fatorembalagem: number;
  vrcusto: number;
  vlrembalagem: number;
  total: number;
  bonificacao: number;
  situacao: string | null;
  icm_efetivo: number | null;
}
export interface ImpressaoPedido {
  cabecalho: {
    codpedcomp: number; data: string | null; fornecedor: string | null; obs: string | null; cond_pagto: string | null;
    dt_vencimento: string | null; comprador: string | null; descpadrao: number | null;
  };
  agrupado: boolean;
  lojas: Array<{ idempresa: number; razao_social: string | null; fantasia: string | null; endereco: string | null; cnpj: string | null; insc: string | null; fone1: string | null; itens: LinhaImpressao[] }>;
  itens: LinhaImpressao[];
  imprime_zerado: string;
  tem_zerados: boolean;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

function tabela(itens: LinhaImpressao[]): string {
  const linhas = itens.map((i) => `
    <tr>
      <td>${esc(i.codbarra)}</td><td>${esc(i.descricao)}${i.situacao ? `<br><small>${esc(i.situacao)}</small>` : ''}</td>
      <td>${esc(i.unidade)}</td><td class="text-right tabular-nums">${qtd(i.qtde)}</td>
      <td class="text-right tabular-nums">${brl(i.vrcusto)}</td><td class="text-right tabular-nums">${brl(i.total)}</td>
      <td class="text-right tabular-nums">${qtd(i.fatorembalagem)}</td><td class="text-right tabular-nums">${qtd(i.qtdtotal)}</td>
      <td class="text-right tabular-nums">${brl(i.vlrembalagem)}</td>
      <td class="text-right tabular-nums">${i.icm_efetivo == null ? '' : qtd(i.icm_efetivo)}</td>
    </tr>`).join('');
  return `<table><thead><tr>
      <th>Cód. barra</th><th>Produto</th><th>Un.</th><th class="text-right">Qtde</th><th class="text-right">Vr. unit</th>
      <th class="text-right">Total</th><th class="text-right">Fator</th><th class="text-right">Qtde total</th>
      <th class="text-right">Vr. embal.</th><th class="text-right">ICMS</th>
    </tr></thead><tbody>${linhas}</tbody></table>`;
}

/** monta e imprime; `comZerados=false` tira as linhas com quantidade zero (`AND COALESCE(PQ.QTDTOTAL, 0) > 0`). */
export function imprimirPedido(win: Window, d: ImpressaoPedido, comZerados: boolean, operador?: string): void {
  const filtra = (l: LinhaImpressao[]) => (comZerados ? l : l.filter((i) => i.qtdtotal > 0));
  const c = d.cabecalho;
  const secoes = d.agrupado
    ? [tabela(filtra(d.itens))]
    : d.lojas.map((l) => ({ l, itens: filtra(l.itens) })).filter((x) => x.itens.length).map(({ l, itens }) => `
        <h3>Loja ${l.idempresa} — ${esc(l.razao_social)}</h3>
        <p><small>Fantasia: ${esc(l.fantasia)} · End: ${esc(l.endereco)} · CNPJ: ${esc(l.cnpj)} · Insc: ${esc(l.insc)} · Fone: ${esc(l.fone1)}</small></p>
        ${tabela(itens)}`);
  const todas = d.agrupado ? filtra(d.itens) : d.lojas.flatMap((l) => filtra(l.itens));
  const total = todas.reduce((s, i) => s + i.total, 0);
  const bonif = todas.reduce((s, i) => s + (i.total * i.bonificacao) / 100, 0);

  const raiz = document.createElement('div');
  raiz.innerHTML = `
    <p><strong>Pedido:</strong> ${c.codpedcomp} &nbsp; <strong>Data:</strong> ${dataBr(c.data)}</p>
    <p><strong>Fornecedor:</strong> ${esc(c.fornecedor)}</p>
    ${c.descpadrao ? `<p>Fornecedor com desconto de ${qtd(c.descpadrao)} %</p>` : ''}
    <p><strong>Cond. Pagto:</strong> ${esc(c.cond_pagto)} &nbsp; <strong>Vencimento:</strong> ${dataBr(c.dt_vencimento)}
       &nbsp; <strong>Comprador:</strong> ${esc(c.comprador)}</p>
    ${c.obs ? `<p><strong>Observação:</strong> ${esc(c.obs)}</p>` : ''}
    ${secoes.join('')}
    <p>${todas.length} produto(s) &nbsp; <strong>Total da compra:</strong> ${brl(total)} &nbsp; <strong>Total bonificado:</strong> ${brl(bonif)}</p>
    <table><tbody><tr><td style="height:48px;vertical-align:bottom">Ass. Vendedor</td><td style="vertical-align:bottom">Ass. Comprador</td></tr></tbody></table>`;
  imprimirPagina(win, raiz, `Pedido de compra ${c.codpedcomp}${d.agrupado ? ' (agrupado)' : ''}`, operador, true);
}
