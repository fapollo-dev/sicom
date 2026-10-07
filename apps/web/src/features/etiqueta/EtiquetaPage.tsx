import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { SelectField } from '../../shared/ui/SelectField';
import { useMensagem } from '../../shared/mensagem';
import { useShortcut } from '../../shared/keyboard';
import {
  listarFila, buscarProduto, remover, imprimir, pesquisarPorSituacao, etiquetasDosLotes, etiquetasDaAgenda, listarModelos,
  importarCodigos, codigosDoArquivo, precoNaEtiqueta, etiquetasDeItens, lerPedidoDeItens, type Etiqueta,
} from './etiquetaApi';
import { documentoDeImpressao } from '../../shared/fr3/render';

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const BACKUP = 'apollo.etiquetas.backup';

interface Linha extends Etiqueta { sel: boolean; qtdeEdit: number; descEdit: string; modelo: string; obs1: string; obs2: string }

/**
 * ETIQUETAS DE PREÇO (FRMETIQUETA) — a tela mais usada do legado. A lista de impressão (o cdsImpressao) recebe produtos
 * pelo código de barras, pela pesquisa por ETQ_IMPRESSA, pela fila do coletor ("Consulta Preço"), por arquivo .txt, pelos
 * lotes do Ajuste de Preços e pela agenda de promoção. Cada linha tem Imprimir, Quantidade, Modelo da etiqueta e as duas
 * observações; o modelo geral vale para todas e é obrigatório para imprimir (e volta a vazio quando entra produto novo,
 * como o `cmbEtiquetaGeral.ItemIndex := -1` do legado). "Imprimir" desenha o modelo .fr3 da RELATORIOS no tamanho do papel.
 */
export function EtiquetaPage() {
  const mensagem = useMensagem();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [codbarra, setCodbarra] = useState('');
  const [busy, setBusy] = useState(false);
  const [modelos, setModelos] = useState<Array<{ nome: string }>>([]);
  const [modeloGeral, setModeloGeral] = useState('');
  const [obsGeral1, setObsGeral1] = useState('');
  const [obsGeral2, setObsGeral2] = useState('');
  const [descricaoPor, setDescricaoPor] = useState<'produto' | 'grupo'>('produto'); // ETIQUETA COM GRUPO DE PRECO (ConfigDB.xml) = NÃO
  const [ativos, setAtivos] = useState(true); // "Buscar somente produtos ativos nas pesquisas": Sim
  const [situacao, setSituacao] = useState<'N' | 'S' | 'T'>('N');
  const [unicaUsada, setUnicaUsada] = useState(false);
  const [coletor, setColetor] = useState(false); // FObbetqcoletor: a lista recebeu a fila do coletor
  const arquivoRef = useRef<HTMLInputElement>(null);

  const paraLinha = (e: Etiqueta, sel = true): Linha => ({ ...e, sel, qtdeEdit: e.qtde || 1, descEdit: e.descricao, modelo: '', obs1: '', obs2: '' });
  /** entra produto novo: o que já está na lista (mesmo código de barras) não repete, e o modelo geral volta a vazio */
  const acrescentar = useCallback((novas: Etiqueta[], sel = true, noInicio = false, repetir = false) => {
    setLinhas((xs) => {
      const ja = new Set(xs.map((l) => l.codbarra ?? `#${l.idproduto}`));
      const add = novas.filter((e) => { if (repetir) return true; const k = e.codbarra ?? `#${e.idproduto}`; if (ja.has(k)) return false; ja.add(k); return true; }).map((e) => paraLinha(e, sel));
      return noInicio ? [...add, ...xs] : [...xs, ...add];
    });
    setModeloGeral('');
  }, []);

  useEffect(() => { void listarModelos().then(setModelos).catch((e) => mensagem.erro(e)); }, [mensagem]);

  const carregarColetor = useCallback(async () => {
    setCarregando(true);
    try {
      const fila = await listarFila(ativos);
      // o BitBtn1Click não marca IMPRIMIR: a linha do coletor entra desmarcada (cdsImpressaoNewRecord)
      acrescentar(fila, false);
      if (fila.length) setColetor(true);
    } catch (e) {
      // sem a opção "Consulta Preço" (BTNCONSULTAPRECO) o legado deixa o botão desabilitado — a lista só fica sem a fila
      if ((e as { status?: number }).status !== 403) mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem, ativos, acrescentar]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carregarColetor(); }, []);

  // vindo do Ajuste de Preços (botão "Etiquetas"): os produtos dos lotes entram na lista com o preço do lote
  useEffect(() => {
    let pend: { codlotes?: number[]; semPromocao?: boolean } | null = null;
    try { pend = JSON.parse(sessionStorage.getItem('apollo.etiquetas.lotes') ?? 'null'); sessionStorage.removeItem('apollo.etiquetas.lotes'); } catch { pend = null; }
    if (!pend?.codlotes?.length) return;
    void etiquetasDosLotes(pend.codlotes, !!pend.semPromocao).then((r) => {
      acrescentar(r, true, true);
      mensagem.sucesso(`${r.length} etiqueta(s) dos lotes do Ajuste de Preços na lista.`);
    }).catch((e) => mensagem.erro(e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // vindo da agenda de promoção (botão Etiquetas): os itens ativos da agenda entram na lista
  useEffect(() => {
    let pend: { codagenda?: number; preco?: string } | null = null;
    try { pend = JSON.parse(sessionStorage.getItem('apollo.etiquetas.agenda') ?? 'null'); sessionStorage.removeItem('apollo.etiquetas.agenda'); } catch { pend = null; }
    if (!pend?.codagenda) return;
    const cod = pend.codagenda;
    void etiquetasDaAgenda(cod, pend.preco ?? 'status').then((r) => {
      acrescentar(r, true, true);
      mensagem.sucesso(`${r.length} etiqueta(s) da agenda ${cod} na lista.`);
    }).catch((e) => mensagem.erro(e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // vindo do cadastro de produto, da Precificação NF, do Relatório de preços alterados, da NF ou da Pesquisa: a lista pronta, marcada
  // (a da Pesquisa desmarcada), com as linhas repetidas como o legado as põe no cdsImpressao
  useEffect(() => {
    const pedido = lerPedidoDeItens();
    if (!pedido) return;
    void etiquetasDeItens(pedido).then((r) => {
      acrescentar(r, pedido.marcar ?? true, true, pedido.fonte !== 'cadastro');
      mensagem.sucesso(`${r.length} etiqueta(s) na lista.`);
    }).catch((e) => mensagem.erro(e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // o código de barras (edtCodBarraExit): o produto entra e TODAS as linhas ficam marcadas para imprimir
  const addPorCodBarra = async () => {
    const cb = codbarra.trim();
    if (!cb || busy) return;
    setBusy(true);
    try {
      const e = await buscarProduto(cb, ativos);
      acrescentar([e], true);
      setLinhas((xs) => xs.map((l) => ({ ...l, sel: true })));
      setCodbarra('');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  // a pesquisa por ETQ_IMPRESSA: a gôndola com preço alterado e etiqueta velha (Uetiqueta.pas:700-735)
  const carregarPorSituacao = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await pesquisarPorSituacao(situacao, codbarra.trim() || undefined, ativos);
      acrescentar(r, true);
      mensagem.sucesso(r.length ? `${r.length} produto(s) encontrados na pesquisa.` : 'Nenhum produto nessa situação.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const importarArquivo = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const { etiquetas, naoEncontrados } = await importarCodigos(codigosDoArquivo(await f.text()));
      acrescentar(etiquetas, true);
      if (naoEncontrados.length) mensagem.erro(new Error(`Produto não encontrado, CODBARRA=${naoEncontrados.join(', ')}`));
      else mensagem.sucesso(`${etiquetas.length} produto(s) do arquivo na lista.`);
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); if (arquivoRef.current) arquivoRef.current.value = ''; }
  };

  const removerLinha = async (l: Linha, ix: number) => {
    if (l.idetiqueta != null) {
      try { await remover(l.idetiqueta); } catch (e) { mensagem.erro(e); return; }
    }
    setLinhas((xs) => xs.filter((_, i) => i !== ix));
  };

  const setLinha = (ix: number, patch: Partial<Linha>) => setLinhas((xs) => xs.map((l, i) => (i === ix ? { ...l, ...patch } : l)));
  const aplicarModeloGeral = (m: string) => { setModeloGeral(m); if (m) setLinhas((xs) => xs.map((l) => ({ ...l, modelo: m }))); };
  const limpar = () => {
    setLinhas([]); setCodbarra(''); setModeloGeral(''); setObsGeral1(''); setObsGeral2(''); setUnicaUsada(false); setSituacao('N');
    setDescricaoPor('produto'); setColetor(false);
  };
  const restaurarBackup = () => {
    let bkp: Linha[] | null = null;
    try { bkp = JSON.parse(localStorage.getItem(BACKUP) ?? 'null'); } catch { bkp = null; }
    if (!bkp?.length) { mensagem.erro(new Error('Não foi encontrado um backup da última impressão.')); return; }
    setLinhas(bkp);
  };

  const selecionadas = linhas.filter((l) => l.sel && l.qtdeEdit > 0);
  const totalEtiquetas = selecionadas.reduce((s, l) => s + Number(l.qtdeEdit || 0), 0);

  const imprimirSel = async () => {
    if (busy) return;
    if (!modeloGeral) { mensagem.erro(new Error('Necessário informar o modelo da etiqueta.')); return; }
    if (!selecionadas.length) return;
    // a janela abre SÍNCRONA no clique (popup-blocker); se bloqueada, nada é gravado no servidor
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { window.alert('Habilite pop-ups para imprimir as etiquetas.'); return; }
    setBusy(true);
    try { localStorage.setItem(BACKUP, JSON.stringify(linhas)); } catch { /* sem storage: sem backup */ }
    try {
      const r = await imprimir({
        itens: selecionadas.map((l) => ({
          idetiqueta: l.idetiqueta, idproduto: l.idproduto, qtde: l.qtdeEdit, modelo: l.modelo || modeloGeral, origem: l.origem,
          descricao: l.descEdit !== l.descricao ? l.descEdit : undefined, observacao1: l.obs1 || undefined, observacao2: l.obs2 || undefined,
        })),
        descricaoPor, observacao1: obsGeral1, observacao2: obsGeral2, coletor,
        listados: linhas.map((l) => l.idproduto),
      });
      const doc = documentoDeImpressao(r.trabalhos.map((t) => ({ modelo: t.modelo, registros: t.registros })), r.modelos);
      win.document.open();
      win.document.write(doc.html);
      win.document.close();
      if (doc.avisos.length) mensagem.erro(new Error(doc.avisos.join('\n')));
      else mensagem.sucesso(`${r.total_etiquetas} etiqueta(s) em ${doc.paginas} página(s). Impressão aberta.`);
    } catch (e) { win.close(); mensagem.erro(e); } finally { setBusy(false); }
  };

  // F2 = BtnImprimir.Click (FormKeyDown do Uetiqueta, em toda a tela); o Esc (Close) é o da base
  useShortcut('f2', () => void imprimirSel());

  const opcoesModelo = modelos.map((m) => ({ value: m.nome, label: m.nome }));
  const inp = 'w-full rounded-radius-sm border border-border bg-bg px-1 py-0.5';

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Etiquetas de Preço" />
      <div className="grid gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md md:grid-cols-3">
        <div className="flex flex-col gap-gp-xs">
          <b className="text-body-sm">Adicionar produtos</b>
          <div className="flex items-end gap-gp-xs">
            <div className="flex-1"><Field label="&Código de barras" value={codbarra} onChange={(e) => setCodbarra(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addPorCodBarra(); }} placeholder="bipe ou digite + Enter" /></div>
            <Button label="&Adicionar" variant="soft" disabled={busy || !codbarra.trim()} onClick={() => void addPorCodBarra()} />
          </div>
          <div className="flex items-end gap-gp-xs">
            <div className="flex-1"><SelectField label="&Situação da etiqueta" value={situacao} onChange={(v) => setSituacao((v || 'N') as 'N' | 'S' | 'T')} options={[{ value: 'S', label: 'Já impressas' }, { value: 'N', label: 'Não impressas (preço alterado)' }, { value: 'T', label: 'Todas' }]} /></div>
            <Button label="&Pesquisar" variant="ghost" disabled={busy} onClick={() => void carregarPorSituacao()} />
          </div>
          <div className="flex flex-wrap gap-gp-xs">
            <Button label="Consulta &preço (coletor)" variant="ghost" disabled={busy || carregando} onClick={() => void carregarColetor()} />
            <Button label="Importar arqui&vo" variant="ghost" disabled={busy} onClick={() => arquivoRef.current?.click()} />
            <input ref={arquivoRef} type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => void importarArquivo(e.target.files?.[0])} />
          </div>
          <div className="w-56"><SelectField label="Buscar somente produtos a&tivos" value={ativos ? 'S' : 'N'} onChange={(v) => setAtivos(v !== 'N')} options={[{ value: 'S', label: 'Sim' }, { value: 'N', label: 'Não' }]} /></div>
        </div>
        <div className="flex flex-col gap-gp-xs">
          <b className="text-body-sm">Aplicar a todos os produtos</b>
          <div className="flex items-end gap-gp-xs">
            <div className="flex-1"><SelectField label="&Modelo da etiqueta" value={modeloGeral} onChange={aplicarModeloGeral} options={opcoesModelo} placeholder="escolha o modelo" /></div>
            <Button label="Etiqueta única" variant="ghost" disabled={unicaUsada || !linhas.length} onClick={() => { setLinhas((xs) => xs.map((l) => ({ ...l, qtdeEdit: 1 }))); setUnicaUsada(true); }} />
          </div>
          <div className="w-64"><SelectField label="&Descrição na impressão" value={descricaoPor} onChange={(v) => setDescricaoPor(v === 'grupo' ? 'grupo' : 'produto')} options={[{ value: 'grupo', label: 'Grupo de preço' }, { value: 'produto', label: 'Descrição do produto' }]} /></div>
        </div>
        <div className="flex flex-col gap-gp-xs">
          <b className="text-body-sm">Observações</b>
          <Field label="Observação &1" value={obsGeral1} maxLength={255} onChange={(e) => setObsGeral1(e.target.value)} />
          <Field label="Observação &2" value={obsGeral2} maxLength={255} onChange={(e) => setObsGeral2(e.target.value)} />
          <small className="text-fg-muted">Só vale para o produto sem observação preenchida na grade.</small>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-gp-sm">
        <Button label="&Imprimir (F2)" variant="soft" disabled={busy || !selecionadas.length} onClick={() => void imprimirSel()} />
        <Button label="&Limpar lista" variant="ghost" disabled={busy || !linhas.length} onClick={limpar} />
        <Button label="Verificar &backup" variant="ghost" disabled={busy} onClick={restaurarBackup} />
        <div className="flex-1 text-right text-body-sm">Selecionado — <b>{selecionadas.length}</b> produto(s) · <b>{totalEtiquetas}</b> etiqueta(s)</div>
      </div>

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs w-8"><input type="checkbox" aria-label="Imprimir todos" checked={linhas.length > 0 && linhas.every((l) => l.sel)} onChange={(e) => setLinhas((xs) => xs.map((l) => ({ ...l, sel: e.target.checked })))} /></th>
              <th className="p-pad-xs">Cód. barra</th>
              <th className="p-pad-xs">Descrição</th>
              <th className="p-pad-xs text-right w-20">Quantidade</th>
              <th className="p-pad-xs w-48">Modelo da etiqueta</th>
              <th className="p-pad-xs text-right">Preço na etiqueta</th>
              <th className="p-pad-xs w-40">Observação 1</th>
              <th className="p-pad-xs w-40">Observação 2</th>
              <th className="p-pad-xs w-16" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, ix) => (
              <tr key={`${l.codbarra ?? l.idproduto}-${ix}`} className={`border-t border-border ${l.sel ? 'bg-bg-subtle' : ''}`}>
                <td className="p-pad-xs"><input type="checkbox" aria-label="Imprimir" checked={l.sel} onChange={(e) => setLinha(ix, { sel: e.target.checked })} /></td>
                <td className="p-pad-xs tabular-nums">{l.codbarra ?? '—'}</td>
                <td className="p-pad-xs">
                  <input className="w-full bg-transparent outline-none" value={l.descEdit} onChange={(e) => setLinha(ix, { descEdit: e.target.value })} />
                  <span className="text-fg-muted">#{l.idproduto}{l.fator !== 1 ? ` · fator ${l.fator}` : ''}{l.origem.tipo === 'lote' ? ' · preço do lote' : l.origem.tipo === 'agenda' ? ' · agenda' : l.origem.tipo === 'preco' ? ' · preço da tela de origem' : l.origem.tipo === 'nf' ? ' · da NF' : l.idetiqueta != null ? ' · coletor' : ''}</span>
                </td>
                <td className="p-pad-xs text-right"><input type="number" min={1} className={`${inp} w-20 text-right tabular-nums`} value={l.qtdeEdit} onChange={(e) => setLinha(ix, { qtdeEdit: Math.max(1, Math.round(Number(e.target.value) || 1)) })} /></td>
                <td className="p-pad-xs">
                  <select aria-label="Modelo da etiqueta" className={inp} value={l.modelo} onChange={(e) => setLinha(ix, { modelo: e.target.value })}>
                    <option value="" />
                    {modelos.map((m) => <option key={m.nome} value={m.nome}>{m.nome}</option>)}
                  </select>
                </td>
                <td className={`p-pad-xs text-right tabular-nums font-semibold ${l.promocao === 'S' ? 'text-accent' : ''}`}>{brl(precoNaEtiqueta(l))}{l.promocao === 'S' ? ' ⚡' : ''}</td>
                <td className="p-pad-xs"><input className={inp} maxLength={255} value={l.obs1} onChange={(e) => setLinha(ix, { obs1: e.target.value })} /></td>
                <td className="p-pad-xs"><input className={inp} maxLength={255} value={l.obs2} onChange={(e) => setLinha(ix, { obs2: e.target.value })} /></td>
                <td className="p-pad-xs text-right"><Button label="Remover" variant="ghost" onClick={() => void removerLinha(l, ix)} /></td>
              </tr>
            ))}
            {!linhas.length && !carregando && <tr><td colSpan={9} className="p-pad-md text-fg-muted">Lista vazia. Bipe um código de barras, pesquise pela situação da etiqueta ou traga a fila do coletor.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
