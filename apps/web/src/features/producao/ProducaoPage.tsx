import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  listarProducoes, obterProducao, criarProducao, atualizarProducao, excluirProducao, processarProducao, reverterProducao,
  type ProducaoHeader, type ProducaoDetalhe, type ProducaoItem,
} from './producaoApi';

const q3 = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const brl = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

/**
 * PRODUÇÃO (FRMCADPRODUCAO — "Requisição de produção") — corte-1. Documento de manufatura (cabeçalho + itens de
 * saída/acabados): o operador lança o produto acabado + quantidade a produzir; o custo/venda é snapshot do servidor
 * (MULTI_PRECO). Cada acabado tem de possuir ficha técnica (receita). «Processar» explode a receita, BAIXA os
 * ingredientes e ENTRA o acabado no estoque (kardex origem='PRODUCAO'); «Reverter» estorna simetricamente.
 */
export function ProducaoPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<ProducaoHeader[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sel, setSel] = useState<ProducaoDetalhe | null>(null);
  const [itens, setItens] = useState<ProducaoItem[]>([]);
  const [novoProd, setNovoProd] = useState<number | undefined>();
  const [novaQtde, setNovaQtde] = useState<number | undefined>();
  const [dirty, setDirty] = useState(false); // itens locais não salvos → bloqueia Processar (atua no estado do servidor)
  const [busy, setBusy] = useState(false);

  const carregarLista = useCallback(async () => {
    setCarregando(true);
    try {
      setLista(await listarProducoes());
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);
  useEffect(() => { void carregarLista(); }, [carregarLista]);

  const abrir = async (id: number) => {
    try {
      const d = await obterProducao(id);
      setSel(d);
      setItens((d.itens ?? []).map((i) => ({ ...i, idprodutos: Number(i.idprodutos), qtde: Number(i.qtde) })));
      setDirty(false);
      setNovoProd(undefined); setNovaQtde(undefined);
    } catch (e) {
      mensagem.erro(e);
    }
  };

  const novo = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await criarProducao({});
      await carregarLista();
      mensagem.sucesso(`Requisição de produção ${d.codproducao} criada. Adicione os produtos acabados.`);
      await abrir(d.codproducao);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const addItem = () => {
    if (!novoProd || novoProd <= 0) { window.alert('Informe o produto acabado.'); return; }
    if (novaQtde == null || novaQtde <= 0) { window.alert('Informe a quantidade a produzir (> 0).'); return; }
    setItens((xs) => [...xs, { idprodutos: novoProd, qtde: novaQtde }]);
    setDirty(true);
    setNovoProd(undefined); setNovaQtde(undefined);
  };
  const removerItem = (i: number) => { setItens((xs) => xs.filter((_, ix) => ix !== i)); setDirty(true); };

  const processado = sel?.status === 'P';

  const salvar = async () => {
    if (!sel || busy) return;
    if (processado) { window.alert('Reverta o processamento antes de editar os itens.'); return; }
    setBusy(true);
    try {
      await atualizarProducao(sel.codproducao, { itens: itens.map((i) => ({ idprodutos: i.idprodutos, qtde: i.qtde })) });
      mensagem.sucesso('Requisição salva.');
      await abrir(sel.codproducao);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const processar = async () => {
    if (!sel || busy) return;
    if (!window.confirm('Processar a produção? Os ingredientes de cada acabado serão BAIXADOS do estoque e o acabado ENTRA no saldo (kardex de produção).')) return;
    setBusy(true);
    try {
      const r = await processarProducao(sel.codproducao);
      mensagem.sucesso(`Produção processada — ${r.acabados} acabado(s), ${r.ingredientes} ingrediente(s) baixado(s).`);
      await abrir(sel.codproducao);
      await carregarLista();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const reverter = async () => {
    if (!sel || busy) return;
    if (!window.confirm('Reverter o processamento? Os ingredientes voltam ao estoque e o acabado é removido do saldo.')) return;
    setBusy(true);
    try {
      const r = await reverterProducao(sel.codproducao);
      mensagem.sucesso(`Processamento revertido — ${r.ingredientes} ingrediente(s) devolvido(s), ${r.acabados} acabado(s) removido(s).`);
      await abrir(sel.codproducao);
      await carregarLista();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const excluir = async () => {
    if (!sel || busy) return;
    if (!window.confirm(`Excluir a requisição de produção nº ${sel.codproducao}?`)) return;
    setBusy(true);
    try {
      await excluirProducao(sel.codproducao);
      mensagem.sucesso('Requisição excluída.');
      setSel(null);
      await carregarLista();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const totalCusto = itens.reduce((s, i) => s + Number(i.qtde) * Number(i.vrcusto ?? 0), 0);

  // ─────────────────────────── DETALHE ───────────────────────────
  if (sel) {
    return (
      <div className="flex flex-col gap-gp-md p-pad-md">
        <PageHeader title={`Produção nº ${sel.codproducao}${processado ? ' — PROCESSADA (estoque movido)' : ''}`} />
        <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <Button label="&Salvar" variant="soft" disabled={busy || processado} onClick={() => void salvar()} />
          {!processado && <Button label="&Processar (baixar ingredientes + entrar acabado)" variant="soft" disabled={busy || !itens.length || dirty} onClick={() => void processar()} />}
          {processado && <Button label="&Reverter processamento" variant="soft" disabled={busy} onClick={() => void reverter()} />}
          <Button label="E&xcluir" variant="ghost" disabled={busy || processado} onClick={() => void excluir()} />
          <Button label="&Voltar" variant="ghost" onClick={() => { setSel(null); void carregarLista(); }} />
          <small className="w-full text-fg-muted">Cada acabado precisa de ficha técnica (receita). {dirty && !processado ? 'Salve antes de processar. ' : ''}«Processar» explode a receita, baixa os ingredientes e dá entrada do acabado; para editar itens de uma produção processada, reverta antes.</small>
        </div>

        {!processado && (
          <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="w-40"><NumberField label="&Acabado (id)" value={novoProd} decimais={0} min={1} onChange={setNovoProd} /></div>
            <div className="w-40"><NumberField label="&Qtde a produzir" value={novaQtde} decimais={3} min={0} onChange={setNovaQtde} /></div>
            <Button label="&Adicionar acabado" variant="soft" onClick={addItem} />
          </div>
        )}

        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="p-pad-xs">Acabado</th>
                <th className="p-pad-xs text-right">Qtde a produzir</th>
                <th className="p-pad-xs text-right">Custo un.</th>
                <th className="p-pad-xs text-right">Custo total</th>
                {!processado && <th className="p-pad-xs" />}
              </tr>
            </thead>
            <tbody>
              {itens.map((it, ix) => (
                <tr key={it.coditenprod ?? `n${ix}`} className="border-t border-border">
                  <td className="p-pad-xs tabular-nums">{it.idprodutos}</td>
                  <td className="p-pad-xs text-right tabular-nums">{q3(Number(it.qtde))}</td>
                  <td className="p-pad-xs text-right tabular-nums">{it.vrcusto != null ? brl(Number(it.vrcusto)) : '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{it.vrcusto != null ? brl(Number(it.qtde) * Number(it.vrcusto)) : '—'}</td>
                  {!processado && <td className="p-pad-xs text-right"><Button label="Remover" variant="ghost" onClick={() => removerItem(ix)} /></td>}
                </tr>
              ))}
              {!itens.length && <tr><td colSpan={processado ? 4 : 5} className="p-pad-md text-fg-muted">Sem acabados. Adicione produto acabado + quantidade a produzir.</td></tr>}
            </tbody>
            {itens.length > 0 && (
              <tfoot>
                <tr className="border-t border-border font-semibold">
                  <td className="p-pad-xs" colSpan={3}>Custo total</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(totalCusto)}</td>
                  {!processado && <td className="p-pad-xs" />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    );
  }

  // ─────────────────────────── LISTA ───────────────────────────
  const colunas: DataTableColumnDef<ProducaoHeader>[] = [
    { field: 'codproducao', headerName: 'Nº', type: 'text', width: 90, isPrimary: true },
    { field: 'data', headerName: 'Data', type: 'text', width: 130, valueFormatter: (v: unknown) => dia(v) },
    { field: 'status_label', headerName: 'Status', type: 'text', width: 130 },
    { field: 'qtde_itens', headerName: 'Acabados', type: 'number', width: 110 },
    { field: 'total_custo', headerName: 'Custo', type: 'number', width: 140, valueFormatter: (v: unknown) => brl(Number(v)) },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 110,
      getActions: () => [{ id: 'abrir', label: 'Abrir', onClick: (row: ProducaoHeader) => void abrir(Number(row.codproducao)) }],
    },
  ];
  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Produção" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <Button label="&Nova requisição de produção" variant="soft" disabled={busy} onClick={() => void novo()} />
        <small className="text-fg-muted">Manufatura (açougue/padaria): produza acabados a partir da ficha técnica, baixando ingredientes do estoque.</small>
      </div>
      <DataTable columns={colunas} rows={lista} loading={carregando} />
    </div>
  );
}
