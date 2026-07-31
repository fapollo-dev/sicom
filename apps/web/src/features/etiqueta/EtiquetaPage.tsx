import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { listarFila, buscarProduto, adicionar, remover, imprimir, type Etiqueta } from './etiquetaApi';
import { printEtiquetas } from './printLabels';

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Linha extends Etiqueta { sel: boolean; qtdeEdit: number; descEdit: string }

/**
 * ETIQUETAS DE PREÇO (FRMETIQUETA) — corte-1. A tela MAIS usada do legado. Consome a fila do coletor (produtos
 * pendentes da empresa), mostra o preço/promo computado no servidor (MULTI_PRECO × fator), permite adicionar por
 * código de barras, ajustar quantidade/descrição, e «Imprimir» → gera a folha de etiquetas (PDF/HTML c/ código de
 * barras Code-128) e marca IMPRESSA='S'. Modelos .fr3, promo acumulativa/atacarejo, nutricional = adiados.
 */
export function EtiquetaPage() {
  const mensagem = useMensagem();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [codbarra, setCodbarra] = useState('');
  const [busy, setBusy] = useState(false);

  const paraLinha = (e: Etiqueta): Linha => ({ ...e, sel: true, qtdeEdit: e.qtde || 1, descEdit: e.descricao });

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const fila = await listarFila();
      setLinhas(fila.map(paraLinha));
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);
  useEffect(() => { void carregar(); }, [carregar]);

  const addPorCodBarra = async () => {
    const cb = codbarra.trim();
    if (!cb || busy) return;
    setBusy(true);
    try {
      const { etiqueta } = await adicionar({ codbarra: cb });
      setLinhas((xs) => [paraLinha(etiqueta), ...xs]);
      setCodbarra('');
      mensagem.sucesso(`${etiqueta.descricao} adicionado à fila.`);
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const previewCodBarra = async () => {
    const cb = codbarra.trim();
    if (!cb || busy) return;
    setBusy(true);
    try {
      const e = await buscarProduto(cb);
      setLinhas((xs) => [{ ...paraLinha(e), idetiqueta: undefined }, ...xs]); // avulso (não veio da fila)
      setCodbarra('');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const removerLinha = async (l: Linha, ix: number) => {
    if (l.idetiqueta != null) {
      try { await remover(l.idetiqueta); } catch (e) { mensagem.erro(e); return; }
    }
    setLinhas((xs) => xs.filter((_, i) => i !== ix));
  };

  const setLinha = (ix: number, patch: Partial<Linha>) => setLinhas((xs) => xs.map((l, i) => (i === ix ? { ...l, ...patch } : l)));

  const selecionadas = linhas.filter((l) => l.sel && l.qtdeEdit > 0);
  const totalEtiquetas = selecionadas.reduce((s, l) => s + Number(l.qtdeEdit || 0), 0);

  const imprimirSel = async () => {
    if (busy || !selecionadas.length) return;
    // abre a janela de impressão SÍNCRONA no clique (evita popup-blocker); se bloqueada, aborta ANTES de marcar
    // IMPRESSA='S' no servidor (fold auditoria: senão o item era consumido sem imprimir).
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { window.alert('Habilite pop-ups para imprimir as etiquetas.'); return; }
    setBusy(true);
    try {
      const { etiquetas } = await imprimir(selecionadas.map((l) => ({ idetiqueta: l.idetiqueta, idproduto: l.idproduto, qtde: l.qtdeEdit, descricao: l.descEdit })));
      printEtiquetas(etiquetas, win);
      mensagem.sucesso(`${etiquetas.length} produto(s) → ${etiquetas.reduce((s, e) => s + e.qtde, 0)} etiqueta(s). Impressão aberta.`);
      await carregar(); // os da fila somem (IMPRESSA='S')
    } catch (e) { win.close(); mensagem.erro(e); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Etiquetas de Preço" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-64"><Field label="&Código de barras" value={codbarra} onChange={(e) => setCodbarra(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addPorCodBarra(); }} placeholder="bipe ou digite + Enter" /></div>
        <Button label="&Adicionar à fila" variant="soft" disabled={busy || !codbarra.trim()} onClick={() => void addPorCodBarra()} />
        <Button label="Só &imprimir (avulso)" variant="ghost" disabled={busy || !codbarra.trim()} onClick={() => void previewCodBarra()} />
        <Button label="&Imprimir selecionadas" variant="soft" disabled={busy || !selecionadas.length} onClick={() => void imprimirSel()} />
        <div className="flex-1 text-right text-body-sm">Selecionado — <b>{selecionadas.length}</b> produto(s) · <b>{totalEtiquetas}</b> etiqueta(s)</div>
        <small className="w-full text-fg-muted">Fila do coletor (pendentes desta empresa). Preço impresso = promo se ativa, senão venda (MULTI_PRECO × fator). «Imprimir» abre a folha (código de barras Code-128) e marca como impressa.</small>
      </div>

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs w-8"><input type="checkbox" checked={linhas.length > 0 && linhas.every((l) => l.sel)} onChange={(e) => setLinhas((xs) => xs.map((l) => ({ ...l, sel: e.target.checked })))} /></th>
              <th className="p-pad-xs">Produto</th>
              <th className="p-pad-xs">Código de barras</th>
              <th className="p-pad-xs text-right">Venda</th>
              <th className="p-pad-xs text-right">Preço impresso</th>
              <th className="p-pad-xs text-right w-24">Qtde</th>
              <th className="p-pad-xs w-16" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, ix) => (
              <tr key={l.idetiqueta ?? `a${ix}`} className={`border-t border-border ${l.sel ? 'bg-bg-subtle' : ''}`}>
                <td className="p-pad-xs"><input type="checkbox" checked={l.sel} onChange={(e) => setLinha(ix, { sel: e.target.checked })} /></td>
                <td className="p-pad-xs">
                  <input className="w-full bg-transparent outline-none" value={l.descEdit} onChange={(e) => setLinha(ix, { descEdit: e.target.value })} />
                  <span className="text-fg-muted">#{l.idproduto}{l.fator !== 1 ? ` · fator ${l.fator}` : ''}{l.idetiqueta == null ? ' · avulso' : ''}</span>
                </td>
                <td className="p-pad-xs tabular-nums">{l.codbarra ?? '—'}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(l.valor_venda)}</td>
                <td className={`p-pad-xs text-right tabular-nums font-semibold ${l.promocao === 'S' ? 'text-accent' : ''}`}>{brl(l.valor_venda_promocao)}{l.promocao === 'S' ? ' ⚡' : ''}</td>
                <td className="p-pad-xs text-right"><input type="number" min={1} className="w-20 rounded-radius-sm border border-border bg-bg px-1 py-0.5 text-right tabular-nums" value={l.qtdeEdit} onChange={(e) => setLinha(ix, { qtdeEdit: Math.max(1, Math.round(Number(e.target.value) || 1)) })} /></td>
                <td className="p-pad-xs text-right"><Button label="Remover" variant="ghost" onClick={() => void removerLinha(l, ix)} /></td>
              </tr>
            ))}
            {!linhas.length && !carregando && <tr><td colSpan={7} className="p-pad-md text-fg-muted">Fila vazia. Bipe um código de barras para adicionar, ou aguarde os pendentes do coletor.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
