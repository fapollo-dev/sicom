import { useCallback, useEffect, useState } from 'react';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { useNavigate } from 'react-router-dom';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  listarTrocas, obterTroca, criarTroca, atualizarTroca, excluirTroca, fecharTroca, reabrirTroca,
  type TrocaHeader, type TrocaDetalhe, type TrocaItem,
} from './trocaApi';

const q3 = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

/**
 * TROCA DE MERCADORIA COM FORNECEDOR (FRMTROCAMERCADORIAFOR) — corte-1: documento de troca (avariados/vencidos que
 * saem p/ o fornecedor). Custo snapshot de MULTI_PRECO. o estoque sai quando o item entra na troca (o gatilho ESTOQUE_TROCA) e fica reservado; «Fechar» só encerra a reserva;
 * «Reabrir» estorna. Supplier-side (não-PDV). NF de devolução = corte futuro.
 */
export function TrocaPage() {
  const mensagem = useMensagem();
  const navigate = useNavigate();
  const [lista, setLista] = useState<TrocaHeader[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sel, setSel] = useState<TrocaDetalhe | null>(null);
  const [itens, setItens] = useState<TrocaItem[]>([]);
  const [novoForn, setNovoForn] = useState<number | undefined>();
  const [novaDesc, setNovaDesc] = useState('');
  const [novoProd, setNovoProd] = useState<number | undefined>();
  const [novaQtde, setNovaQtde] = useState<number | undefined>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try { setLista(await listarTrocas()); } catch (e) { mensagem.erro(e); } finally { setCarregando(false); }
  }, [mensagem]);
  useEffect(() => { void carregar(); }, [carregar]);

  const abrir = async (id: number) => {
    try {
      const d = await obterTroca(id);
      setSel(d);
      setItens((d.itens ?? []).map((i) => ({ ...i, idproduto: Number(i.idproduto), qtde: Number(i.qtde) })));
      setDirty(false); setNovoProd(undefined); setNovaQtde(undefined);
    } catch (e) { mensagem.erro(e); }
  };

  const criar = async () => {
    if (busy) return;
    if (!novoForn) { window.alert('Informe o fornecedor (código).'); return; }
    setBusy(true);
    try {
      const d = await criarTroca({ codparceiro: novoForn, descricao: novaDesc || undefined });
      setNovoForn(undefined); setNovaDesc('');
      await carregar();
      mensagem.sucesso(`Troca ${d.codtroca} criada. Adicione os itens.`);
      await abrir(d.codtroca);
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  // fold auditoria [ALTA]: `status` é coluna SÓ da view (get_troca); o GET :id lê a tabela base e não a traz.
  // Deriva o estado FECHADA dos próprios itens (que o detalhe retorna) — mesma regra do get_troca. Senão o botão
  // «Reabrir» nunca aparece (estorno inalcançável) e o lock de fechada fica invisível.
  const fechada = itens.length > 0 && itens.every((i) => (i.fechado ?? 'N') === 'S');
  const addItem = () => {
    if (!novoProd || novoProd <= 0) { window.alert('Informe o produto.'); return; }
    if (novaQtde == null || novaQtde <= 0) { window.alert('Informe a quantidade.'); return; }
    setItens((xs) => [...xs, { idproduto: novoProd, qtde: novaQtde }]);
    setDirty(true); setNovoProd(undefined); setNovaQtde(undefined);
  };
  const removerItem = (i: number) => { setItens((xs) => xs.filter((_, ix) => ix !== i)); setDirty(true); };

  const salvar = async () => {
    if (!sel || busy) return;
    if (fechada) { window.alert('Reabra a troca antes de editar os itens.'); return; }
    setBusy(true);
    try {
      await atualizarTroca(sel.codtroca, { codparceiro: Number(sel.codparceiro), descricao: sel.descricao ?? undefined, itens: itens.map((i) => ({ idproduto: i.idproduto, qtde: i.qtde })) });
      mensagem.sucesso('Troca salva.');
      await abrir(sel.codtroca);
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const fechar = async () => {
    if (!sel || busy) return;
    if (!window.confirm('Fechar a troca? Os itens saem da reserva de troca (o estoque já foi baixado ao incluir os itens).')) return;
    setBusy(true);
    try { const r = await fecharTroca(sel.codtroca); mensagem.sucesso(`Troca fechada — ${r.itens} item(ns) encerrado(s).`); await abrir(sel.codtroca); await carregar(); } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  /** "Imprimir troca" (`ImprimirTroca1Click`): a troca gravada no extr - Troca.fr3 do cliente (o menu só habilita com itens) */
  const imprimir = async () => {
    if (!sel || !itens.length) return;
    if (dirty) { mensagem.erro(new Error('Grave as alterações antes de imprimir a troca.')); return; }
    try { await imprimirRelatorio(`/cadastro/troca/${sel.codtroca}/impressao`); } catch (e) { mensagem.erro(e); }
  };
  const reabrir = async () => {
    if (!sel || busy) return;
    if (!window.confirm('Reabrir a troca? Os itens voltam à reserva de troca (o estoque não se altera).')) return;
    setBusy(true);
    try { const r = await reabrirTroca(sel.codtroca); mensagem.sucesso(`Troca reaberta — ${r.itens} item(ns) de volta à reserva.`); await abrir(sel.codtroca); await carregar(); } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  const excluir = async () => {
    if (!sel || busy) return;
    if (!window.confirm(`Excluir a troca nº ${sel.codtroca}?`)) return;
    setBusy(true);
    try { await excluirTroca(sel.codtroca); mensagem.sucesso('Troca excluída.'); setSel(null); await carregar(); } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const totalDoc = itens.reduce((s, i) => s + Number(i.qtde) * Number(i.vrcusto ?? 0), 0);

  if (sel) {
    return (
      <div className="flex flex-col gap-gp-md p-pad-md">
        <PageHeader title={`Troca nº ${sel.codtroca}${fechada ? ' — FECHADA' : ''}${sel.fornecedor ? ' — ' + sel.fornecedor : ''}`} />
        <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="w-96"><Field label="&Descrição" value={sel.descricao ?? ''} onChange={(e) => { setSel({ ...sel, descricao: e.target.value }); setDirty(true); }} placeholder="descrição da troca" disabled={fechada} /></div>
          <Button label="&Salvar" variant="soft" disabled={busy || fechada} onClick={() => void salvar()} />
          {!fechada && <Button label="&Fechar" variant="soft" disabled={busy || !itens.length || dirty} onClick={() => void fechar()} />}
          {fechada && <Button label="&Reabrir" variant="soft" disabled={busy} onClick={() => void reabrir()} />}
          <Button label="&Imprimir troca" variant="ghost" disabled={busy || !itens.length} onClick={() => void imprimir()} />
          <Button label="E&xcluir" variant="ghost" disabled={busy || fechada} onClick={() => void excluir()} />
          {/* o "Imprimir" da troca abre o relatório de trocas preso nela (TfrmTrocaMercadoriaFor.btnImprimirClick) */}
          <Button label="&Imprimir" variant="ghost" onClick={() => navigate(`/relatorios/troca-mercadoria?codtroca=${sel.codtroca}&daTroca=1`)} />
          <Button label="&Voltar" variant="ghost" onClick={() => { setSel(null); void carregar(); }} />
          <small className="w-full text-fg-muted">Valor = quantidade × custo (MULTI_PRECO). {dirty && !fechada ? 'Salve antes de fechar. ' : ''}O estoque sai ao gravar os itens (alterar a quantidade estorna e retira de novo; excluir devolve). Para editar itens de uma troca fechada, reabra antes.</small>
        </div>

        {!fechada && (
          <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="w-32"><NumberField label="&Produto (id)" value={novoProd} decimais={0} min={1} onChange={setNovoProd} /></div>
            <div className="w-32"><NumberField label="&Quantidade" value={novaQtde} decimais={3} min={0} onChange={setNovaQtde} /></div>
            <Button label="&Adicionar item" variant="soft" onClick={addItem} />
          </div>
        )}

        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full text-body-sm">
            <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs">Produto</th><th className="p-pad-xs text-right">Qtde</th><th className="p-pad-xs text-right">Custo un.</th><th className="p-pad-xs text-right">Valor</th>{!fechada && <th className="p-pad-xs" />}</tr></thead>
            <tbody>
              {itens.map((it, ix) => (
                <tr key={it.coditenstroca ?? `n${ix}`} className="border-t border-border">
                  <td className="p-pad-xs tabular-nums">{it.idproduto}</td>
                  <td className="p-pad-xs text-right tabular-nums">{q3(it.qtde)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{it.vrcusto != null ? brl(it.vrcusto) : '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{it.vrcusto != null ? brl(Number(it.qtde) * Number(it.vrcusto)) : '—'}</td>
                  {!fechada && <td className="p-pad-xs text-right"><Button label="Remover" variant="ghost" onClick={() => removerItem(ix)} /></td>}
                </tr>
              ))}
              {!itens.length && <tr><td colSpan={fechada ? 4 : 5} className="p-pad-md text-fg-muted">Sem itens. Adicione produto + quantidade.</td></tr>}
            </tbody>
            {itens.length > 0 && (
              <tfoot><tr className="border-t border-border font-semibold"><td className="p-pad-xs" colSpan={3}>Total da troca</td><td className="p-pad-xs text-right tabular-nums">{brl(totalDoc)}</td>{!fechada && <td />}</tr></tfoot>
            )}
          </table>
        </div>
      </div>
    );
  }

  const colunas: DataTableColumnDef<TrocaHeader>[] = [
    { field: 'codtroca', headerName: 'Nº', type: 'text', width: 80, isPrimary: true },
    { field: 'data', headerName: 'Data', type: 'text', width: 120, valueFormatter: dia },
    { field: 'fornecedor', headerName: 'Fornecedor', type: 'text' },
    { field: 'qtde_itens', headerName: 'Itens', type: 'number', width: 90 },
    { field: 'valor_total', headerName: 'Valor', type: 'number', width: 130, valueFormatter: brl },
    { field: 'status', headerName: 'Situação', type: 'text', width: 120 },
    { field: 'acoes', headerName: '', type: 'actions', width: 110, getActions: () => [{ id: 'abrir', label: 'Abrir', onClick: (row: TrocaHeader) => void abrir(Number(row.codtroca)) }] },
  ];
  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Troca com Fornecedor" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-32"><NumberField label="&Fornecedor (cód)" value={novoForn} decimais={0} min={1} onChange={setNovoForn} /></div>
        <div className="w-72"><Field label="&Descrição" value={novaDesc} onChange={(e) => setNovaDesc(e.target.value)} placeholder="ex.: avariados jul/2026" /></div>
        <Button label="&Nova troca" variant="soft" disabled={busy} onClick={() => void criar()} />
        <small className="text-fg-muted">Devolução de avariados/vencidos ao fornecedor (o estoque sai ao incluir o item).</small>
      </div>
      <DataTable columns={colunas} rows={lista} loading={carregando} />
    </div>
  );
}
