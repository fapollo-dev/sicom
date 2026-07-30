import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  listarScraps, obterScrap, criarScrap, atualizarScrap, excluirScrap, aplicarScrap, estornarScrap, listarMotivosPerda,
  type ScrapHeader, type ScrapDetalhe, type ScrapItem, type MotivoPerda,
} from './scrapApi';

const q3 = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const brl = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * SCRAP / PERDAS (FRMCADSCRAP) — corte-1. Documento de perda (cabeçalho + itens): o operador lança produto +
 * quantidade + motivo; o custo é snapshot do servidor (MULTI_PRECO) e o valor = qtde × custo. «Aplicar» dá BAIXA
 * no estoque (kardex origem='SCRAP'); «Estornar» reverte. Fiel ao legado: registro decoplado da baixa (como o
 * Inventário). CAIXA gerencial, NF de perda (5927) e importador de perdas identificadas ADIADOS.
 */
export function ScrapPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<ScrapHeader[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sel, setSel] = useState<ScrapDetalhe | null>(null);
  const [itens, setItens] = useState<ScrapItem[]>([]);
  const [motivos, setMotivos] = useState<MotivoPerda[]>([]);
  const [novoProd, setNovoProd] = useState<number | undefined>();
  const [novaQtde, setNovaQtde] = useState<number | undefined>();
  const [novoMotivo, setNovoMotivo] = useState('');
  const [obs, setObs] = useState('');
  const [dirty, setDirty] = useState(false); // itens locais não salvos → bloqueia Aplicar (que atua no estado do servidor)
  const [busy, setBusy] = useState(false);

  const carregarLista = useCallback(async () => {
    setCarregando(true);
    try {
      setLista(await listarScraps());
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);
  useEffect(() => {
    void carregarLista();
    void listarMotivosPerda().then(setMotivos).catch(() => setMotivos([]));
  }, [carregarLista]);

  const abrir = async (id: number) => {
    try {
      const d = await obterScrap(id);
      setSel(d);
      setItens((d.itens ?? []).map((i) => ({ ...i, idproduto: Number(i.idproduto), qtde: Number(i.qtde) })));
      setObs(d.obs ?? '');
      setDirty(false);
      setNovoProd(undefined); setNovaQtde(undefined); setNovoMotivo('');
    } catch (e) {
      mensagem.erro(e);
    }
  };

  const novo = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await criarScrap({});
      await carregarLista();
      mensagem.sucesso(`Lançamento de perda ${d.codscrap} criado. Adicione os itens.`);
      await abrir(d.codscrap);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const addItem = () => {
    if (!novoProd || novoProd <= 0) { window.alert('Informe o produto.'); return; }
    if (novaQtde == null) { window.alert('Informe a quantidade.'); return; }
    setItens((xs) => [...xs, { idproduto: novoProd, qtde: novaQtde, codmotivoop: novoMotivo ? Number(novoMotivo) : null }]);
    setDirty(true);
    setNovoProd(undefined); setNovaQtde(undefined); setNovoMotivo('');
  };
  const removerItem = (i: number) => { setItens((xs) => xs.filter((_, ix) => ix !== i)); setDirty(true); };

  const aplicado = sel?.mov_estoque === 'S';

  const salvar = async () => {
    if (!sel || busy) return;
    if (aplicado) { window.alert('Estorne a baixa antes de editar os itens.'); return; }
    setBusy(true);
    try {
      await atualizarScrap(sel.codscrap, { obs: obs || undefined, itens: itens.map((i) => ({ idproduto: i.idproduto, qtde: i.qtde, codmotivoop: i.codmotivoop ?? null })) });
      mensagem.sucesso('Perda salva.');
      await abrir(sel.codscrap);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const aplicar = async () => {
    if (!sel || busy) return;
    if (!window.confirm('Aplicar ao estoque? A quantidade de cada item será BAIXADA do saldo (kardex de perda).')) return;
    setBusy(true);
    try {
      const r = await aplicarScrap(sel.codscrap);
      mensagem.sucesso(`Baixa aplicada — ${r.itens} item(ns) removido(s) do estoque.`);
      await abrir(sel.codscrap);
      await carregarLista();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const estornar = async () => {
    if (!sel || busy) return;
    if (!window.confirm('Estornar a baixa? O saldo de cada item volta ao estoque.')) return;
    setBusy(true);
    try {
      const r = await estornarScrap(sel.codscrap);
      mensagem.sucesso(`Baixa estornada — ${r.itens} item(ns) devolvido(s) ao estoque.`);
      await abrir(sel.codscrap);
      await carregarLista();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const excluir = async () => {
    if (!sel || busy) return;
    if (!window.confirm(`Excluir o lançamento de perda nº ${sel.codscrap}?`)) return;
    setBusy(true);
    try {
      await excluirScrap(sel.codscrap);
      mensagem.sucesso('Lançamento excluído.');
      setSel(null);
      await carregarLista();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const motivoLabel = (cod?: number | null) => motivos.find((m) => m.codmotivoop === Number(cod))?.descricao ?? (cod ? String(cod) : '—');
  const totalDoc = itens.reduce((s, i) => s + Number(i.qtde) * Number(i.vr_custo ?? 0), 0);

  // ─────────────────────────── DETALHE ───────────────────────────
  if (sel) {
    return (
      <div className="flex flex-col gap-gp-md p-pad-md">
        <PageHeader title={`Perda nº ${sel.codscrap}${aplicado ? ' — APLICADA (estoque baixado)' : ''}`} />
        <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="w-96"><Field label="&Observação" value={obs} onChange={(e) => { setObs(e.target.value); setDirty(true); }} placeholder="observação do lançamento" disabled={aplicado} /></div>
          <Button label="&Salvar" variant="soft" disabled={busy || aplicado} onClick={() => void salvar()} />
          {!aplicado && <Button label="&Aplicar (baixar estoque)" variant="soft" disabled={busy || !itens.length || dirty} onClick={() => void aplicar()} />}
          {aplicado && <Button label="&Estornar baixa" variant="soft" disabled={busy} onClick={() => void estornar()} />}
          <Button label="E&xcluir" variant="ghost" disabled={busy || aplicado} onClick={() => void excluir()} />
          <Button label="&Voltar" variant="ghost" onClick={() => { setSel(null); void carregarLista(); }} />
          <small className="w-full text-fg-muted">Valor da perda = quantidade × custo (MULTI_PRECO). {dirty && !aplicado ? 'Salve antes de aplicar. ' : ''}«Aplicar» dá baixa no estoque; para editar itens de uma perda aplicada, estorne antes.</small>
        </div>

        {!aplicado && (
          <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="w-32"><NumberField label="&Produto (id)" value={novoProd} decimais={0} min={1} onChange={setNovoProd} /></div>
            <div className="w-32"><NumberField label="&Quantidade" value={novaQtde} decimais={3} onChange={setNovaQtde} /></div>
            <div className="w-56"><SelectField label="&Motivo" value={novoMotivo} onChange={setNovoMotivo} options={motivos.map((m) => ({ value: String(m.codmotivoop), label: m.descricao }))} placeholder="(motivo da perda)" /></div>
            <Button label="&Adicionar item" variant="soft" onClick={addItem} />
          </div>
        )}

        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="p-pad-xs">Produto</th>
                <th className="p-pad-xs text-right">Qtde</th>
                <th className="p-pad-xs text-right">Custo un.</th>
                <th className="p-pad-xs text-right">Valor</th>
                <th className="p-pad-xs">Motivo</th>
                {!aplicado && <th className="p-pad-xs" />}
              </tr>
            </thead>
            <tbody>
              {itens.map((it, ix) => (
                <tr key={it.codscrapitem ?? `n${ix}`} className="border-t border-border">
                  <td className="p-pad-xs tabular-nums">{it.idproduto}</td>
                  <td className="p-pad-xs text-right tabular-nums">{q3(Number(it.qtde))}</td>
                  <td className="p-pad-xs text-right tabular-nums">{it.vr_custo != null ? brl(Number(it.vr_custo)) : '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{it.vr_custo != null ? brl(Number(it.qtde) * Number(it.vr_custo)) : '—'}</td>
                  <td className="p-pad-xs">{motivoLabel(it.codmotivoop)}</td>
                  {!aplicado && <td className="p-pad-xs text-right"><Button label="Remover" variant="ghost" onClick={() => removerItem(ix)} /></td>}
                </tr>
              ))}
              {!itens.length && <tr><td colSpan={aplicado ? 5 : 6} className="p-pad-md text-fg-muted">Sem itens. Adicione produto + quantidade + motivo.</td></tr>}
            </tbody>
            {itens.length > 0 && (
              <tfoot>
                <tr className="border-t border-border font-semibold">
                  <td className="p-pad-xs" colSpan={3}>Total da perda</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(totalDoc)}</td>
                  <td className="p-pad-xs" colSpan={aplicado ? 1 : 2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    );
  }

  // ─────────────────────────── LISTA ───────────────────────────
  const colunas: DataTableColumnDef<ScrapHeader>[] = [
    { field: 'codscrap', headerName: 'Nº', type: 'text', width: 90, isPrimary: true },
    { field: 'dt_cadastro', headerName: 'Data', type: 'text', width: 170 },
    { field: 'parceiro', headerName: 'Fornecedor', type: 'text' },
    { field: 'qtde_itens', headerName: 'Itens', type: 'number', width: 90 },
    { field: 'valor_total', headerName: 'Valor', type: 'number', width: 140, valueFormatter: (v: unknown) => brl(Number(v)) },
    { field: 'mov_estoque', headerName: 'Estoque', type: 'text', width: 120, valueFormatter: (v: unknown) => (v === 'S' ? 'Baixado' : '—') },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 110,
      getActions: () => [{ id: 'abrir', label: 'Abrir', onClick: (row: ScrapHeader) => void abrir(Number(row.codscrap)) }],
    },
  ];
  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Scrap / Perdas" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <Button label="&Novo lançamento de perda" variant="soft" disabled={busy} onClick={() => void novo()} />
        <small className="text-fg-muted">Registre quebra/vencimento/avaria e baixe do estoque.</small>
      </div>
      <DataTable columns={colunas} rows={lista} loading={carregando} />
    </div>
  );
}
