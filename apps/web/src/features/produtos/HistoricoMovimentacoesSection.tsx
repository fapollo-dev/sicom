import { useState } from 'react';
import { Tabs } from '../../shared/ui/Tabs';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { hojeNaLoja } from '../../shared/tempo';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { consultaHistorico, getHistorico, type AbaHistorico, type RespostaHistorico } from './produtoHistoricoApi';

const ABAS: Array<{ id: AbaHistorico; label: string }> = [
  { id: 'vendas', label: 'Vendas' },
  { id: 'pedidos', label: 'Pedidos' },
  { id: 'pedido-compra', label: 'Pedido de Compra' },
  { id: 'entradas', label: 'Notas de Entrada' },
  { id: 'saidas', label: 'Notas de Saída' },
  { id: 'estoque', label: 'Estoque' },
  { id: 'fornecedores', label: 'Fornecedores' },
  { id: 'promocao', label: 'Promoção' },
  { id: 'inventario-rotativo', label: 'Inventário rotativo' },
];
/** as abas com "Imprimir" no legado (a Promoção chama o handler do inventário rotativo — ver o dossiê) */
const IMPRIME = new Set<AbaHistorico>(['vendas', 'pedidos', 'entradas', 'saidas', 'estoque', 'inventario-rotativo']);
/** as lojas: várias (`GetMultiEmpresa`), uma (o kardex) ou nenhuma (promoção: sem filtro; inventário: a do login) */
const LOJAS: Partial<Record<AbaHistorico, 'varias' | 'uma'>> = {
  vendas: 'varias', pedidos: 'varias', 'pedido-compra': 'varias', entradas: 'varias', saidas: 'varias', fornecedores: 'varias', estoque: 'uma',
};

const brl = (v: unknown) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qtd = (v: unknown) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const txt = (v: unknown) => (v == null ? '' : String(v));
const dia = (v: unknown) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
const diaHora = (v: unknown) => (v ? `${dia(v)} ${String(v).slice(11, 19)}` : '');

type Col = { t: string; k: string; f?: (v: unknown) => string; n?: boolean };
const NOTAS = (parceiro: string): Col[] => [
  { t: 'Dt.Emissão', k: 'dtemissao', f: dia }, { t: 'Nr.NF', k: 'nronf' }, { t: 'Cód. Empresa', k: 'idempresa' },
  { t: 'Qtd.', k: 'quantidade', f: qtd, n: true }, { t: 'Qtde. Total', k: 'qtdembal', f: qtd, n: true }, { t: 'Vlr.Unit.', k: 'vrcusto', f: brl, n: true },
  { t: 'Vlr.Total', k: 'total', f: brl, n: true }, { t: parceiro, k: 'razao' }, { t: 'Status', k: 'proc' },
];
const COLS: Record<AbaHistorico, Col[]> = {
  vendas: [
    { t: 'Data Venda', k: 'dtvenda', f: dia }, { t: 'Nro. Pedido', k: 'nropedido' }, { t: 'Vr. Venda', k: 'vrvenda', f: brl, n: true },
    { t: 'Quantidade', k: 'qtde', f: qtd, n: true }, { t: 'Total', k: 'total', f: brl, n: true }, { t: 'Promoção', k: 'promocao' },
    { t: 'Cliente', k: 'razao' }, { t: 'Vendedor', k: 'razao_1' }, { t: 'Nro.Cupom', k: 'nrocupom' },
  ],
  pedidos: [],
  'pedido-compra': [
    { t: 'Dt.Emissão', k: 'data', f: dia }, { t: 'Nr. Pedido', k: 'codpedcomp' }, { t: 'Nr.NF', k: 'nronf' }, { t: 'Loja', k: 'idempresa' },
    { t: 'Qtd.', k: 'qtde', f: qtd, n: true }, { t: 'Vlr.Unit.', k: 'vlrembalagem', f: brl, n: true }, { t: 'Vlr.Total', k: 'total', f: brl, n: true },
    { t: 'Fornecedor', k: 'razao' }, { t: 'Status', k: 'proc' },
  ],
  entradas: NOTAS('Fornecedor'),
  saidas: NOTAS('Parceiro'),
  estoque: [
    { t: 'Data', k: 'data', f: diaHora }, { t: 'Histórico', k: 'historico' }, { t: 'Entrada', k: 'entrada', f: qtd, n: true },
    { t: 'Saída', k: 'saida', f: qtd, n: true }, { t: 'Saldo', k: 'qtde_atual', f: qtd, n: true },
  ],
  fornecedores: [
    { t: 'Código', k: 'codparceiro' }, { t: 'Fornecedor', k: 'fantasia' }, { t: 'Data última compra', k: 'dtemissao', f: dia }, { t: 'Empresa', k: 'idempresa' },
  ],
  promocao: [
    { t: 'Promoção', k: 'promocao' }, { t: 'Data início', k: 'dtiniciopromocao', f: diaHora }, { t: 'Data término', k: 'dtfimpromocao', f: diaHora },
    { t: 'Valor de venda', k: 'vrvenda', f: brl, n: true }, { t: 'Valor promocional', k: 'vlrpromocao', f: brl, n: true }, { t: 'Empresas', k: 'empresas' },
  ],
  'inventario-rotativo': [
    { t: 'Data', k: 'data', f: dia }, { t: 'Lote', k: 'lote' }, { t: 'Diferença quantidade', k: 'diferenca_qtd', f: qtd, n: true },
  ],
};
COLS.pedidos = COLS.vendas.filter((c) => c.k !== 'nrocupom'); // o Nro.Cupom só aparece na origem VENDAS
const TOTAIS: Record<string, string> = {
  total_qtde: 'Total Quantidade', total_qtde_processada: 'Processada', total_qtde_nao_processada: 'Não processada',
};

/**
 * HISTÓRICO DAS MOVIMENTAÇÕES (aba `TbsHistoricoMovimentacoes` do UCadProduto): cada sub-aba com o seu período, as lojas e o "Buscar";
 * o "Imprimir" usa o layout .fr3 do cliente. A aba é de consulta — funciona fora da edição.
 */
export function HistoricoMovimentacoesSection({ idproduto }: { idproduto: number | undefined }) {
  const mensagem = useMensagem();
  const hoje = hojeNaLoja();
  const [aba, setAba] = useState<AbaHistorico>('vendas');
  const [dtini, setDtini] = useState(`${hoje.slice(0, 8)}01`);
  const [dtfim, setDtfim] = useState(hoje);
  const [empresas, setEmpresas] = useState('');
  const [res, setRes] = useState<RespostaHistorico | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const filtro = () => ({ dtini, dtfim, empresas: LOJAS[aba] ? empresas : '' });
  const buscar = async () => {
    if (idproduto == null) return;
    setOcupado(true);
    try {
      setRes(await getHistorico(idproduto, aba, filtro()));
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const imprimir = () => {
    if (idproduto == null) return;
    imprimirRelatorio(`/cadastro/produtos/${idproduto}/historico/${aba}/impressao?${consultaHistorico(filtro())}`).catch((e) => mensagem.erro(e));
  };

  const cols = COLS[aba];
  return (
    <fieldset className="rounded-radius-base border border-border p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Histórico das movimentações</legend>
      {idproduto == null ? (
        <small className="text-fg-muted">Grave o produto para ver o histórico das movimentações.</small>
      ) : (
        <div className="flex flex-col gap-gp-sm">
          <Tabs tabs={ABAS} active={aba} onChange={(id) => { setAba(id as AbaHistorico); setRes(null); }} variant="sub" />
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-40"><Field label="Data &inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
            <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
            {LOJAS[aba] && (
              <div className="w-40">
                <Field label={LOJAS[aba] === 'uma' ? 'Empresa' : 'Empresas (1,2)'} value={empresas} onChange={(e) => setEmpresas(e.target.value)} placeholder="esta loja" />
              </div>
            )}
            <Button label={ocupado ? 'Buscando…' : '&Buscar'} variant="soft" disabled={ocupado} onClick={() => void buscar()} />
            {IMPRIME.has(aba) && <Button label="Im&primir" variant="ghost" disabled={ocupado} onClick={imprimir} />}
          </div>
          {res && (
            <div className="flex flex-col gap-gp-sm overflow-x-auto">
              {!res.linhas.length ? (
                <small className="text-fg-muted">{aba === 'promocao' || aba === 'inventario-rotativo' ? 'Não há registros para esse filtro!' : 'Nenhum registro encontrado.'}</small>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border text-left">{cols.map((c) => <th key={c.k} className={`p-pad-xs ${c.n ? 'text-right' : ''}`}>{c.t}</th>)}</tr></thead>
                  <tbody>
                    {res.linhas.map((l, i) => (
                      <tr key={i} className="border-b border-border/50">
                        {cols.map((c) => <td key={c.k} className={`p-pad-xs ${c.n ? 'text-right tabular-nums' : ''}`}>{(c.f ?? txt)(l[c.k])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {Object.keys(res.totais).length > 0 && (
                <div className="flex flex-wrap gap-gp-md text-body-sm">
                  {Object.entries(res.totais).map(([k, v]) => (
                    <span key={k}><span className="text-fg-muted">{TOTAIS[k] ?? k}:</span> <span className="font-semibold tabular-nums">{qtd(v)}</span></span>
                  ))}
                </div>
              )}
              {res.empresas.length > 0 && <small className="text-fg-muted">Loja(s): {res.empresas.join(', ')}</small>}
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}
