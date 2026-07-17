import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  listarInventarios, obterInventario, criarInventario, atualizarInventario,
  importarProdutosInventario, diferencasInventario, aplicarInventario,
  type InventarioLivro, type InventarioDetalhe,
} from './inventarioApi';

const q3 = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/**
 * INVENTÁRIO (contagem física) — corte-2 front. Fluxo fiel ao legado (planilha): cria o livro → IMPORTA a folha
 * (contado nasce = saldo de sistema) → o operador AJUSTA o contado das linhas recontadas → SALVA → confere as
 * DIFERENÇAS → APLICA ao estoque (sobrescreve = contado, exige a senha de operação ADM da empresa). Sem máquina
 * de estado (rerodável), como o legado.
 */
export function InventarioPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<InventarioLivro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sel, setSel] = useState<InventarioDetalhe | null>(null);
  const [contagem, setContagem] = useState<Record<number, number>>({});
  const [difs, setDifs] = useState<Record<number, { sistema: number; diferenca: number }> | null>(null);
  const [apenasAtivos, setApenasAtivos] = useState(true);
  const [apenasComSaldo, setApenasComSaldo] = useState(false);
  const [senha, setSenha] = useState('');
  const [novaDesc, setNovaDesc] = useState('');
  const [busy, setBusy] = useState(false);

  const carregarLista = useCallback(async () => {
    setCarregando(true);
    try {
      setLista(await listarInventarios());
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);
  useEffect(() => {
    void carregarLista();
  }, [carregarLista]);

  const abrir = async (id: number) => {
    try {
      const d = await obterInventario(id);
      setSel(d);
      setContagem(Object.fromEntries((d.itens ?? []).map((i) => [i.idproduto, Number(i.qtde)])));
      setDifs(null);
    } catch (e) {
      mensagem.erro(e);
    }
  };

  const criar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await criarInventario({ descricao: novaDesc || undefined });
      setNovaDesc('');
      await carregarLista();
      mensagem.sucesso(`Inventário ${d.codinvent} criado. Importe a folha de contagem.`);
      await abrir(d.codinvent);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const importar = async () => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      const r = await importarProdutosInventario(sel.codinvent, { apenasAtivos, apenasComSaldo });
      mensagem.sucesso(`${r.itens} produto(s) importado(s) — o contado nasce = saldo de sistema; ajuste as linhas recontadas.`);
      await abrir(sel.codinvent);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const salvar = async () => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      const itens = (sel.itens ?? []).map((i) => ({ idproduto: i.idproduto, qtde: contagem[i.idproduto] ?? Number(i.qtde) }));
      await atualizarInventario(sel.codinvent, { descricao: sel.descricao ?? undefined, itens });
      mensagem.sucesso('Contagem salva.');
      setDifs(null);
      await abrir(sel.codinvent);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const verDiferencas = async () => {
    if (!sel) return;
    try {
      const r = await diferencasInventario(sel.codinvent);
      setDifs(Object.fromEntries(r.itens.map((x) => [x.idproduto, { sistema: x.sistema, diferenca: x.diferenca }])));
    } catch (e) {
      mensagem.erro(e);
    }
  };

  const aplicar = async () => {
    if (!sel || busy) return;
    if (!window.confirm('Aplicar ao estoque? O saldo de cada produto passa a ser a quantidade CONTADA (sobrescreve).')) return;
    setBusy(true);
    try {
      const r = await aplicarInventario(sel.codinvent, senha || undefined);
      mensagem.sucesso(`${r.aplicados} item(ns) aplicado(s) ao estoque.`);
      setSenha('');
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  // ─────────────────────────── DETALHE (livro aberto) ───────────────────────────
  if (sel) {
    const itens = sel.itens ?? [];
    return (
      <div className="flex flex-col gap-gp-md p-pad-md">
        <PageHeader title={`Inventário nº ${sel.codinvent}${sel.descricao ? ' — ' + sel.descricao : ''}`} />
        <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <CheckboxField label="Apenas &ativos" value={apenasAtivos ? 'S' : 'N'} onChange={(v) => setApenasAtivos(v === 'S')} />
          <CheckboxField label="Apenas com &saldo" value={apenasComSaldo ? 'S' : 'N'} onChange={(v) => setApenasComSaldo(v === 'S')} />
          <Button label="&Importar produtos" variant="soft" disabled={busy} onClick={() => void importar()} />
          <Button label="&Salvar contagem" variant="soft" disabled={busy || !itens.length} onClick={() => void salvar()} />
          <Button label="Ver &diferenças" variant="ghost" disabled={!itens.length} onClick={() => void verDiferencas()} />
          <div className="w-40">
            <Field label="Senha de &operação (ADM)" type="password" autoComplete="off" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="senha ADM" />
          </div>
          <Button label="&Aplicar ao estoque" variant="soft" disabled={busy || !itens.length || !senha} onClick={() => void aplicar()} />
          <Button label="&Voltar" variant="ghost" onClick={() => { setSel(null); void carregarLista(); }} />
          <small className="w-full text-fg-muted">Contado nasce = saldo de sistema; ajuste só as linhas recontadas. Aplicar SOBRESCREVE o estoque (exige senha ADM da empresa).</small>
        </div>

        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="p-pad-xs">Produto</th>
                <th className="p-pad-xs">Descrição</th>
                <th className="p-pad-xs text-right">Contado</th>
                {difs && <th className="p-pad-xs text-right">Sistema</th>}
                {difs && <th className="p-pad-xs text-right">Diferença</th>}
              </tr>
            </thead>
            <tbody>
              {itens.map((it) => {
                const d = difs?.[it.idproduto];
                return (
                  <tr key={it.idproduto} className="border-t border-border">
                    <td className="p-pad-xs tabular-nums">{it.idproduto}</td>
                    <td className="p-pad-xs">{it.descricao ?? '—'}</td>
                    <td className="p-pad-xs w-32">
                      <NumberField label="" value={contagem[it.idproduto]} decimais={3} min={0} onChange={(v) => setContagem((c) => ({ ...c, [it.idproduto]: v ?? 0 }))} />
                    </td>
                    {difs && <td className="p-pad-xs text-right tabular-nums">{d ? q3(d.sistema) : '—'}</td>}
                    {difs && <td className={`p-pad-xs text-right tabular-nums font-semibold ${d && d.diferenca !== 0 ? (d.diferenca > 0 ? 'text-danger' : 'text-warning') : 'text-fg-muted'}`}>{d ? q3(d.diferenca) : '—'}</td>}
                  </tr>
                );
              })}
              {!itens.length && (
                <tr><td colSpan={difs ? 5 : 3} className="p-pad-md text-fg-muted">Sem itens. Use «Importar produtos» para popular a folha.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ─────────────────────────── LISTA ───────────────────────────
  const colunas: DataTableColumnDef<InventarioLivro>[] = [
    { field: 'codinvent', headerName: 'Nº', type: 'text', width: 90, isPrimary: true },
    { field: 'descricao', headerName: 'Descrição', type: 'text' },
    { field: 'dtinventario', headerName: 'Data', type: 'text', width: 140 },
    { field: 'qtde_itens', headerName: 'Itens', type: 'number', width: 100 },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 120,
      getActions: () => [{ id: 'abrir', label: 'Abrir', onClick: (row: InventarioLivro) => void abrir(Number(row.codinvent)) }],
    },
  ];
  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Inventário (contagem física)" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-72"><Field label="&Descrição do inventário" value={novaDesc} onChange={(e) => setNovaDesc(e.target.value)} placeholder="ex.: Inventário geral jul/2026" /></div>
        <Button label="&Novo inventário" variant="soft" disabled={busy} onClick={() => void criar()} />
      </div>
      <DataTable columns={colunas} rows={lista} loading={carregando} />
    </div>
  );
}
