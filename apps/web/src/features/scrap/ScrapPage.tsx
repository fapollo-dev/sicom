import { useCallback, useEffect, useState } from 'react';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  listarScraps, obterScrap, criarScrap, atualizarScrap, excluirScrap, aplicarScrap, estornarScrap, listarMotivosPerda, apoioScrap,
  type ScrapHeader, type ScrapDetalhe, type ScrapItem, type MotivoPerda, type ScrapApoio,
} from './scrapApi';

const q3 = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const brl = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * SCRAP / PERDAS (FRMCADSCRAP, uCadSCRAP.pas). O documento nasce como no legado: situação (E02), centro de custo de perda,
 * o fornecedor = o parceiro da empresa, e os itens (produto, quantidade, motivo, setor quando o centro de custo pede, produto
 * filho) — gravados de uma vez; o custo é snapshot do servidor (MULTI_PRECO) e a perda vai à CAIXA gerencial. «Aplicar»
 * (baixa de estoque) só existe com BAIXAR_ESTOQUE_NO_SCRAP='S' — no cliente quem baixa é a NF de perda.
 */
export function ScrapPage() {
  // as permissões de controle da grade (uCadSCRAP.dfm: btnAdicionarItem / btnExcluirI — docs/05-migration-engineering/permissoes-de-controle.md)
  const { tem: pode } = useOpcoesDoForm('FRMCADSCRAP');
  const mensagem = useMensagem();
  const [lista, setLista] = useState<ScrapHeader[]>([]);
  const [carregando, setCarregando] = useState(true);
  // `sel` com codscrap 0 = o RASCUNHO de um documento novo (nada gravado até o «Gravar», como no legado)
  const [sel, setSel] = useState<ScrapDetalhe | null>(null);
  const [apoio, setApoio] = useState<ScrapApoio | null>(null);
  const [situacao, setSituacao] = useState('');
  const [codplc, setCodplc] = useState('');
  const [novoSetor, setNovoSetor] = useState('');
  const [novoFilho, setNovoFilho] = useState<number | undefined>();
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
    void apoioScrap().then(setApoio).catch(() => setApoio(null));
  }, [carregarLista]);

  const abrir = async (id: number) => {
    try {
      const d = await obterScrap(id);
      setSel(d);
      setItens((d.itens ?? []).map((i) => ({ ...i, idproduto: Number(i.idproduto), qtde: Number(i.qtde) })));
      setObs(d.obs ?? '');
      setSituacao(d.idsituacao_nf ? String(d.idsituacao_nf) : '');
      setCodplc(d.codplc ? String(d.codplc) : '');
      setDirty(false);
      setNovoProd(undefined); setNovaQtde(undefined); setNovoMotivo(''); setNovoSetor(''); setNovoFilho(undefined);
    } catch (e) {
      mensagem.erro(e);
    }
  };

  const novo = () => {
    // a situação: com uma só, já vem escolhida (`InformaSituacaoDocumento`, uCadSCRAP.pas:1648)
    const sits = apoio?.situacoes ?? [];
    setSel({ codscrap: 0, dt_cadastro: null, itens: [] });
    setItens([]); setObs(''); setCodplc(''); setSituacao(sits.length === 1 ? String(sits[0].idsituacao_nf) : '');
    setDirty(true);
    setNovoProd(undefined); setNovaQtde(undefined); setNovoMotivo(''); setNovoSetor(''); setNovoFilho(undefined);
  };

  const centro = apoio?.centros.find((c) => String(c.codplc) === codplc);
  const usaSetor = centro?.uso_setor === 'S';
  const addItem = () => {
    if (!novoProd || novoProd <= 0) { window.alert('Informe o produto.'); return; }
    if (novaQtde == null) { window.alert('Informe a quantidade.'); return; }
    if (novaQtde < 0) { window.alert('Quantidade não pode ser MENOR QUE ZERO. Verifique!'); return; }
    if (usaSetor && !novoSetor) { window.alert('O centro de custo informado está marcado com a flag Uso de setor. Informe o setor de consumo e tente novamente!'); return; }
    if ((apoio?.informaMotivo || centro?.obriga_motivo === 'S') && !novoMotivo) { window.alert('Informe o motivo da perda e tente novamente.'); return; }
    setItens((xs) => [...xs, { idproduto: novoProd, qtde: novaQtde, codmotivoop: novoMotivo ? Number(novoMotivo) : null, codsetor: novoSetor ? Number(novoSetor) : null, idproduto_filho: novoFilho ?? null }]);
    setDirty(true);
    setNovoProd(undefined); setNovaQtde(undefined); setNovoMotivo(''); setNovoSetor(''); setNovoFilho(undefined);
  };
  const removerItem = (i: number) => { setItens((xs) => xs.filter((_, ix) => ix !== i)); setDirty(true); };

  const aplicado = sel?.mov_estoque === 'S';

  const salvar = async () => {
    if (!sel || busy) return;
    if (aplicado) { window.alert('Estorne a baixa antes de editar os itens.'); return; }
    if (!itens.length) { window.alert('Obrigatório informar um item. Verifique!'); return; }
    if (!codplc) { window.alert('Informe o centro de custo e tente novamente!'); return; }
    if (apoio?.informaSituacao && !situacao) { window.alert('Informe a situação do documento.'); return; }
    if (itens.some((i) => Number(i.qtde) === 0) && !window.confirm('Existem produtos com quantidade zerada que serão excluídos da lista do scrap ao gravar.\nDeseja continuar?')) return;
    setBusy(true);
    try {
      const body = {
        codplc: Number(codplc), idsituacao_nf: situacao ? Number(situacao) : null, obs: obs || undefined,
        itens: itens.map((i) => ({ idproduto: i.idproduto, qtde: i.qtde, codmotivoop: i.codmotivoop ?? null, codsetor: i.codsetor ?? null, idproduto_filho: i.idproduto_filho ?? null })),
      };
      const d = sel.codscrap ? await atualizarScrap(sel.codscrap, body) : await criarScrap(body);
      mensagem.sucesso(sel.codscrap ? 'Perda salva.' : `Lançamento de perda ${d.codscrap} gravado.`);
      await abrir(d.codscrap);
      await carregarLista();
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
        <PageHeader title={sel.codscrap ? `Perda nº ${sel.codscrap}${aplicado ? ' — APLICADA (estoque baixado)' : ''}` : 'Nova perda'} />
        <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="w-56"><SelectField label="Situaç&ão" value={situacao} onChange={(v) => { setSituacao(v); setDirty(true); }} disabled={aplicado || !!sel.codscrap} options={(apoio?.situacoes ?? []).map((x) => ({ value: String(x.idsituacao_nf), label: `${x.idsituacao_nf} · ${x.descricao}` }))} placeholder="(situação do documento)" /></div>
          <div className="w-72"><SelectField label="&Centro de custo" value={codplc} onChange={(v) => { setCodplc(v); setDirty(true); }} disabled={aplicado}
            options={(apoio?.centros ?? []).filter((c) => { const lista = situacao ? apoio?.centrosDaSituacao?.[situacao] : undefined; return !lista?.length || lista.includes(c.codplc); }).map((c) => ({ value: String(c.codplc), label: `${c.desccodplc ?? c.codplc} · ${c.descricao}` }))} placeholder="(centro de custo de perda)" /></div>
          <div className="w-64"><Field label="Fornecedor" value={apoio?.parceiro?.razao ?? (apoio?.parceiro?.codparceiro ? String(apoio.parceiro.codparceiro) : '')} onChange={() => undefined} disabled /></div>
          <div className="w-80"><Field label="&Observação" value={obs} onChange={(e) => { setObs(e.target.value); setDirty(true); }} placeholder="observação do lançamento" disabled={aplicado} /></div>
          <Button label="&Gravar" variant="soft" disabled={busy || aplicado} onClick={() => void salvar()} />
          {apoio?.baixarEstoque && !!sel.codscrap && !aplicado && <Button label="&Aplicar (baixar estoque)" variant="soft" disabled={busy || !itens.length || dirty} onClick={() => void aplicar()} />}
          {aplicado && <Button label="&Estornar baixa" variant="soft" disabled={busy} onClick={() => void estornar()} />}
          {!!sel.codscrap && <Button label="E&xcluir" variant="ghost" disabled={busy || aplicado} onClick={() => void excluir()} />}
          <Button label="&Voltar" variant="ghost" onClick={() => { setSel(null); void carregarLista(); }} />
          <small className="w-full text-fg-muted">Valor da perda = quantidade × custo (MULTI_PRECO); ao gravar, a diferença vai à CAIXA gerencial no centro de custo. {dirty && !aplicado ? 'Há alterações não gravadas. ' : ''}{apoio?.baixarEstoque ? '«Aplicar» dá baixa no estoque; para editar itens de uma perda aplicada, estorne antes.' : 'A baixa de estoque é feita pela NF de perda.'}</small>
        </div>

        {!aplicado && (
          <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="w-32"><NumberField label="&Produto (id)" value={novoProd} decimais={0} min={1} onChange={setNovoProd} /></div>
            <div className="w-32"><NumberField label="&Quantidade" value={novaQtde} decimais={3} onChange={setNovaQtde} /></div>
            <div className="w-56"><SelectField label="&Motivo" value={novoMotivo} onChange={setNovoMotivo} options={motivos.map((m) => ({ value: String(m.codmotivoop), label: m.descricao }))} placeholder="(motivo da perda)" /></div>
            {usaSetor && <div className="w-48"><SelectField label="&Setor" value={novoSetor} onChange={setNovoSetor} options={(apoio?.setores ?? []).map((x) => ({ value: String(x.codsetor), label: x.nome }))} placeholder="(setor de consumo)" /></div>}
            <div className="w-32"><NumberField label="Produto &filho (id)" value={novoFilho} decimais={0} min={1} onChange={setNovoFilho} /></div>
            <Button label="&Adicionar item" variant="soft" disabled={!pode('BTNADICIONARITEM')} onClick={addItem} />
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
                <th className="p-pad-xs">Setor</th>
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
                  <td className="p-pad-xs">{apoio?.setores.find((x) => x.codsetor === Number(it.codsetor))?.nome ?? (it.codsetor ? String(it.codsetor) : '—')}</td>
                  {!aplicado && <td className="p-pad-xs text-right"><Button label="Remover" variant="ghost" disabled={!pode('BTNEXCLUIRI')} onClick={() => removerItem(ix)} /></td>}
                </tr>
              ))}
              {!itens.length && <tr><td colSpan={aplicado ? 6 : 7} className="p-pad-md text-fg-muted">Sem itens. Adicione produto + quantidade + motivo.</td></tr>}
            </tbody>
            {itens.length > 0 && (
              <tfoot>
                <tr className="border-t border-border font-semibold">
                  <td className="p-pad-xs" colSpan={3}>Total da perda</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(totalDoc)}</td>
                  <td className="p-pad-xs" colSpan={aplicado ? 2 : 3} />
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
        <Button label="&Novo lançamento de perda" variant="soft" disabled={busy} onClick={novo} />
        <small className="text-fg-muted">Registre quebra/vencimento/avaria e baixe do estoque.</small>
      </div>
      <DataTable columns={colunas} rows={lista} loading={carregando} />
    </div>
  );
}
