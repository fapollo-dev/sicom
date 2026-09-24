import { imprimirPagina } from '../../shared/print/imprimirPagina';

/**
 * Os RECIBOS das baixas — o "Documentos baixados com sucesso. Deseja fazer a emissão do recibo?" do legado: `recibopagar.fr3`
 * (A Pagar: "PAGAMOS À", ou "Vários fornecedores") e `recibo.fr3` (A Receber: "RECEBEMOS DO(A) SR(A)(S)", com a data da venda e as
 * três notas do rodapé). A empresa no topo, os documentos, "A QUANTIA DE" e o RESTANTE.
 */
export interface ReciboBaixa {
  lote: number; dataPagamento: string; total: number; restante: number;
  empresa: { razaosocial?: string | null; endereco?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; cnpj?: string | null; insc?: string | null; fone1?: string | null };
  fornecedor?: string | null; variosFornecedores?: boolean; cliente?: string | null;
  documentos: Array<{ duplicata?: string | null; nronf?: string | number | null; data_venda?: string | null; vencimento?: string | null; valor_documento: number; juros: number; acres_desc: number; valor_pago: number }>;
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const brl = (v: number) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (v: unknown) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');

export function imprimirRecibo(win: Window, r: ReciboBaixa, lado: 'AP' | 'AR'): void {
  const e = r.empresa;
  const ap = lado === 'AP';
  const raiz = document.createElement('div');
  raiz.innerHTML = `
    <header style="text-align:center">
      <h2>${esc(e.razaosocial)}</h2>
      <p>${esc(e.endereco)}${e.numero ? `, ${esc(e.numero)}` : ''}, ${esc(e.bairro)} · ${esc(e.cidade)} - ${esc(e.uf)}</p>
      <p>CNPJ: ${esc(e.cnpj)}  INSC.: ${esc(e.insc)}  FONE.: ${esc(e.fone1)}</p>
      <h1>RECIBO</h1>
    </header>
    <p>${ap ? `PAGAMOS À .: ${esc(r.variosFornecedores ? 'Vários fornecedores' : r.fornecedor)}` : `RECEBEMOS DO(A) SR(A)(S).: ${esc(r.cliente)}`}</p>
    <p>A QUANTIA DE.: <strong>R$ ${brl(r.total)}</strong></p>
    <p>REFERENTE AO(S) DOCTO(S).:</p>
    <table>
      <thead><tr><th>NÚMERO DA DUPLICATA</th>${ap ? '' : '<th>DATA DA VENDA</th>'}<th>VENCIMENTO</th><th class="text-right">VALOR DO DOCUMENTO</th><th class="text-right">VLR JUROS</th><th class="text-right">ACRÉSCIMO/DESCONTO</th><th class="text-right">VALOR PAGO</th></tr></thead>
      <tbody>${r.documentos.map((d) => `<tr><td>${esc(ap && d.nronf ? d.nronf : d.duplicata)}</td>${ap ? '' : `<td>${dataBr(d.data_venda)}</td>`}<td>${dataBr(d.vencimento)}</td>
        <td class="text-right">${brl(d.valor_documento)}</td><td class="text-right">${brl(d.juros)}</td><td class="text-right">${brl(d.acres_desc)}</td><td class="text-right">${brl(d.valor_pago)}</td></tr>`).join('')}</tbody>
    </table>
    <p>RESTANTE : ${brl(r.restante)}</p>
    <p>DATA DE EMISSÃO : ${dataBr(r.dataPagamento)}</p>
    ${ap ? '' : '<p style="font-size:9pt">*   O CHEQUE DEVOLVIDO TORNA SEM VALOR O PRESENTE RECIBO<br>**  GUARDAR ESTE RECIBO POR 12 MESES<br>*** O PAGAMENTO DESTE NAO QUITA DÉBITOS ANTERIORES</p>'}
    <p style="margin-top:48px;text-align:center">______________________________________<br>${esc(e.razaosocial)}</p>`;
  imprimirPagina(win, raiz, `Recibo — lote ${r.lote}`);
}
