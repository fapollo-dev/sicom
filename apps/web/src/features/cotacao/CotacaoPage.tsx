import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { useMensagem } from '../../shared/mensagem';
import {
  listarCotacoes, obterCotacao, criarCotacao, excluirCotacao,
  lancarPrecosCotacao, apurarCotacao, definirGanhadorCotacao, gerarPedidoCotacao,
  fecharCotacao, reabrirCotacao,
  type CotacaoLista, type CotacaoDetalhe,
} from './cotacaoApi';

const brl = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const chave = (codctcforn: number, codcpr: number) => `${codctcforn}:${codcpr}`;

/**
 * COTAÇÃO DE COMPRA (RFQ, uCadCotacao) — corte-3 front. Fluxo fiel: cria a cotação (produtos + fornecedores
 * convidados) → lança os preços de cada fornecedor (matriz) → APURA o vencedor por produto (menor preço líq-ICMS)
 * → opcionalmente força um vencedor manual (clique na célula) → GERA os pedidos (1 por fornecedor vencedor) e
 * fecha. Estado 'A' (Aberta, editável) / 'F' (Fechada). A precificação/apuração ficam no servidor (cópia fiel).
 */
export function CotacaoPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<CotacaoLista[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sel, setSel] = useState<CotacaoDetalhe | null>(null);
  const [busy, setBusy] = useState(false);

  // ── criar ──
  const [novaDesc, setNovaDesc] = useState('');
  const [prodSel, setProdSel] = useState('');
  const [prodQtd, setProdQtd] = useState<number | undefined>(1);
  const [fornSel, setFornSel] = useState('');
  const [novosProdutos, setNovosProdutos] = useState<Array<{ idproduto: number; descricao: string; quantidade: number }>>([]);
  const [novosFornecedores, setNovosFornecedores] = useState<Array<{ codparceiro: number; nome: string }>>([]);

  // ── lançar preços (por fornecedor) ──
  const [fornPreco, setFornPreco] = useState('');
  const [precoEdit, setPrecoEdit] = useState<Record<number, { valor?: number; icms?: number }>>({});

  const { data: produtoOptions = [] } = useResourceOptions('cadastro/produtos', (r: any) => ({ value: String(r.idproduto ?? r.codigo), label: `${r.codbarra} - ${r.descricao}` }));
  const { data: fornecedorOptions = [] } = useResourceOptions('cadastro/parceiros', (p: any) => ({ value: String(p.codparceiro), label: `${p.codparceiro} - ${p.razao}` }), { campo: 'frn', operador: 'igual', valor: 'S' });
  const nomeForn = useMemo(() => new Map(fornecedorOptions.map((o) => [o.value, o.label])), [fornecedorOptions]);

  const carregarLista = useCallback(async () => {
    setCarregando(true);
    try {
      setLista(await listarCotacoes());
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);
  useEffect(() => { void carregarLista(); }, [carregarLista]);

  const abrir = async (id: number) => {
    try {
      const d = await obterCotacao(id);
      setSel(d);
      setFornPreco('');
      setPrecoEdit({});
    } catch (e) {
      mensagem.erro(e);
    }
  };

  // ─────────────────────────── criar ───────────────────────────
  const addProduto = () => {
    const idproduto = Number(prodSel);
    if (!idproduto) return;
    if (novosProdutos.some((p) => p.idproduto === idproduto)) return mensagem.erro('Produto já adicionado.');
    const desc = produtoOptions.find((o) => o.value === prodSel)?.label ?? String(idproduto);
    setNovosProdutos((l) => [...l, { idproduto, descricao: desc, quantidade: Number(prodQtd) > 0 ? Number(prodQtd) : 1 }]);
    setProdSel('');
    setProdQtd(1);
  };
  const addFornecedor = () => {
    const codparceiro = Number(fornSel);
    if (!codparceiro) return;
    if (novosFornecedores.some((f) => f.codparceiro === codparceiro)) return mensagem.erro('Fornecedor já convidado.');
    const nome = fornecedorOptions.find((o) => o.value === fornSel)?.label ?? String(codparceiro);
    setNovosFornecedores((l) => [...l, { codparceiro, nome }]);
    setFornSel('');
  };
  const criar = async () => {
    if (busy) return;
    if (!novosProdutos.length) return mensagem.erro('Adicione ao menos um produto.');
    if (!novosFornecedores.length) return mensagem.erro('Convide ao menos um fornecedor.');
    setBusy(true);
    try {
      const r = await criarCotacao({
        descricao: novaDesc || undefined,
        produtos: novosProdutos.map((p) => ({ idproduto: p.idproduto, quantidade: p.quantidade })),
        fornecedores: novosFornecedores.map((f) => ({ codparceiro: f.codparceiro })),
      });
      setNovaDesc('');
      setNovosProdutos([]);
      setNovosFornecedores([]);
      mensagem.sucesso(`Cotação ${r.codctc} criada. Lance os preços de cada fornecedor.`);
      await carregarLista();
      await abrir(r.codctc);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  // ─────────────────────────── workflow ───────────────────────────
  const acao = async (fn: () => Promise<unknown>, ok: string, recarregar = true) => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      await fn();
      if (ok) mensagem.sucesso(ok); // fold: ok vazio = o fn já emitiu a própria mensagem (não duplica o toast)
      if (recarregar) await abrir(sel.codctc);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const salvarPrecos = async () => {
    if (!sel) return;
    const codparceiro = Number(fornPreco);
    if (!codparceiro) return mensagem.erro('Selecione o fornecedor.');
    const itens = sel.produtos
      .map((p) => ({ idproduto: p.idproduto, valor: precoEdit[p.idproduto]?.valor, icms: precoEdit[p.idproduto]?.icms }))
      .filter((i) => i.valor != null && Number(i.valor) > 0)
      .map((i) => ({ idproduto: i.idproduto, valor: Number(i.valor), icms: i.icms != null ? Number(i.icms) : 0 }));
    if (!itens.length) return mensagem.erro('Informe ao menos um preço (> 0).');
    await acao(() => lancarPrecosCotacao(sel.codctc, { codparceiro, itens }), `Preços do fornecedor ${nomeForn.get(fornPreco) ?? codparceiro} salvos.`);
    setPrecoEdit({});
  };

  const gerar = async () => {
    if (!sel) return;
    if (!window.confirm('Gerar os pedidos de compra? Um pedido por fornecedor vencedor. A cotação será fechada.')) return;
    await acao(async () => {
      const r = await gerarPedidoCotacao(sel.codctc);
      mensagem.sucesso(`${r.pedidos.length} pedido(s) gerado(s): ${r.pedidos.join(', ')}.`);
    }, '', true);
  };

  const excluir = async () => {
    if (!sel || busy) return;
    if (!window.confirm('Excluir esta cotação?')) return;
    setBusy(true);
    try {
      await excluirCotacao(sel.codctc);
      mensagem.sucesso('Cotação excluída.');
      setSel(null);
      await carregarLista();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  // ─────────────────────────── DETALHE ───────────────────────────
  if (sel) {
    const aberta = sel.situacao === 'A';
    const precoBy = new Map(sel.precos.map((pr) => [chave(pr.codctcforn, pr.codcpr), pr]));
    const fornConvidados = sel.fornecedores.map((f) => ({ value: String(f.codparceiro), label: nomeForn.get(String(f.codparceiro)) ?? `Fornecedor ${f.codparceiro}` }));
    const fornEditando = fornPreco ? sel.fornecedores.find((f) => String(f.codparceiro) === fornPreco) : undefined;

    // fold auditoria [ALTA]: SEMEIA o buffer de edição com os preços/ICMS EXISTENTES do fornecedor ao selecioná-lo.
    // Sem isto, editar só o preço mandava icms=0 (buffer vazio) e o upsert do backend zerava o ICMS gravado →
    // corrompia o preço líquido e invertia o vencedor. Com o seed, valor E icms partem do banco; editar um
    // preserva o outro, e uma correção só-de-ICMS passa no filtro valor>0.
    const selecionarFornPreco = (codparceiroStr: string) => {
      setFornPreco(codparceiroStr);
      const forn = codparceiroStr ? sel.fornecedores.find((f) => String(f.codparceiro) === codparceiroStr) : undefined;
      if (!forn) return setPrecoEdit({});
      const cprToProd = new Map(sel.produtos.map((p) => [p.codcpr, p.idproduto]));
      const seed: Record<number, { valor?: number; icms?: number }> = {};
      for (const pr of sel.precos) {
        if (pr.codctcforn !== forn.codctcforn) continue;
        const idproduto = cprToProd.get(pr.codcpr);
        if (idproduto != null && Number(pr.valor) > 0) seed[idproduto] = { valor: Number(pr.valor), icms: Number(pr.icms) };
      }
      setPrecoEdit(seed);
    };

    return (
      <div className="flex flex-col gap-gp-md p-pad-md">
        <PageHeader title={`Cotação nº ${sel.codctc}${sel.descricao ? ' — ' + sel.descricao : ''}`} />

        {/* barra de ações / workflow */}
        <div className="flex flex-wrap items-center gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <span className={`rounded-radius-sm px-pad-sm py-pad-xs text-body-sm font-semibold ${aberta ? 'bg-info-subtle text-info' : 'bg-bg-muted text-fg-muted'}`}>{aberta ? 'ABERTA' : 'FECHADA'}</span>
          {sel.pedidos && <span className="text-body-sm text-fg-muted">{sel.pedidos}</span>}
          <div className="flex-1" />
          {aberta && <Button label="A&purar vencedores" variant="soft" disabled={busy} onClick={() => void acao(async () => { const r = await apurarCotacao(sel.codctc); mensagem.sucesso(`Apurado: ${r.vencedores} vencedor(es) em ${r.produtos} produto(s).`); }, '')} />}
          {aberta && <Button label="&Gerar pedidos" variant="filled" disabled={busy} onClick={() => void gerar()} />}
          {aberta && <Button label="&Fechar" variant="ghost" disabled={busy} onClick={() => void acao(() => fecharCotacao(sel.codctc), 'Cotação fechada.')} />}
          {!aberta && <Button label="&Reabrir" variant="soft" disabled={busy} onClick={() => void acao(() => reabrirCotacao(sel.codctc), 'Cotação reaberta (apuração zerada).')} />}
          {aberta && <Button label="E&xcluir" variant="ghost" disabled={busy} onClick={() => void excluir()} />}
          <Button label="&Voltar" variant="ghost" onClick={() => { setSel(null); void carregarLista(); }} />
        </div>

        {/* MATRIZ produto × fornecedor (vencedor destacado). Clique numa célula com preço p/ forçar o vencedor. */}
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="p-pad-xs">Produto</th>
                <th className="p-pad-xs text-right">Qtde</th>
                {sel.fornecedores.map((f) => (
                  <th key={f.codctcforn} className="p-pad-xs text-right">{(nomeForn.get(String(f.codparceiro)) ?? `Forn ${f.codparceiro}`)}{f.participa_apuracao === 'N' ? ' (fora)' : ''}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sel.produtos.map((p) => (
                <tr key={p.codcpr} className="border-t border-border">
                  <td className="p-pad-xs">{p.idproduto} — {p.descricao ?? '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(p.quantidade)}</td>
                  {sel.fornecedores.map((f) => {
                    const pr = precoBy.get(chave(f.codctcforn, p.codcpr));
                    const venc = pr?.ganhador === 'A';
                    const manual = pr?.definido === 'S';
                    const temPreco = pr != null && Number(pr.valor) > 0;
                    return (
                      <td
                        key={f.codctcforn}
                        className={`p-pad-xs text-right tabular-nums ${venc ? 'bg-success-subtle font-semibold text-success' : ''} ${aberta && temPreco ? 'cursor-pointer hover:bg-bg-muted' : ''}`}
                        title={aberta && temPreco ? 'Clique para forçar este fornecedor como vencedor' : undefined}
                        onClick={() => { if (aberta && temPreco) void acao(() => definirGanhadorCotacao(sel.codctc, { idproduto: p.idproduto, codparceiro: f.codparceiro }), 'Vencedor definido manualmente.'); }}
                      >
                        {temPreco ? brl(Number(pr!.valor)) : '—'}{venc ? ' ✓' : ''}{manual ? ' *' : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!sel.produtos.length && <tr><td colSpan={2 + sel.fornecedores.length} className="p-pad-md text-fg-muted">Cotação sem produtos.</td></tr>}
            </tbody>
          </table>
        </div>
        <small className="text-fg-muted">✓ = vencedor apurado (menor preço líquido de ICMS) · * = escolha manual (sobrevive à reapuração) · «fora» = fornecedor não participa da apuração automática.</small>

        {/* LANÇAR PREÇOS de um fornecedor */}
        {aberta && (
          <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-end gap-gp-sm">
              <div className="w-80"><SelectField label="&Lançar preços do fornecedor" value={fornPreco} onChange={selecionarFornPreco} options={fornConvidados} placeholder="Selecione um fornecedor convidado" /></div>
              <Button label="&Salvar preços" variant="soft" disabled={busy || !fornEditando} onClick={() => void salvarPrecos()} />
            </div>
            {fornEditando && (
              <div className="overflow-x-auto">
                <table className="w-full text-body-sm">
                  <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs">Produto</th><th className="p-pad-xs w-40 text-right">Preço (R$)</th><th className="p-pad-xs w-32 text-right">ICMS %</th></tr></thead>
                  <tbody>
                    {sel.produtos.map((p) => (
                      <tr key={p.codcpr} className="border-t border-border">
                        <td className="p-pad-xs">{p.idproduto} — {p.descricao ?? '—'}</td>
                        <td className="p-pad-xs">
                          <NumberField label="" value={precoEdit[p.idproduto]?.valor} decimais={2} min={0} onChange={(v) => setPrecoEdit((s) => ({ ...s, [p.idproduto]: { ...s[p.idproduto], valor: v } }))} />
                        </td>
                        <td className="p-pad-xs">
                          <NumberField label="" value={precoEdit[p.idproduto]?.icms} decimais={2} min={0} onChange={(v) => setPrecoEdit((s) => ({ ...s, [p.idproduto]: { ...s[p.idproduto], icms: v } }))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <small className="text-fg-muted">Só os preços &gt; 0 são gravados. O ICMS entra no preço líquido da apuração.</small>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────── LISTA + CRIAR ───────────────────────────
  const colunas: DataTableColumnDef<CotacaoLista>[] = [
    { field: 'codctc', headerName: 'Nº', type: 'text', width: 90, isPrimary: true },
    { field: 'descricao', headerName: 'Descrição', type: 'text' },
    { field: 'situacao', headerName: 'Situação', type: 'text', width: 120, valueFormatter: (v: unknown) => (v === 'F' ? 'Fechada' : 'Aberta') },
    { field: 'qtde_produtos', headerName: 'Produtos', type: 'number', width: 100 },
    { field: 'qtde_fornecedores', headerName: 'Fornec.', type: 'number', width: 100 },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 120,
      getActions: () => [{ id: 'abrir', label: 'Abrir', onClick: (row: CotacaoLista) => void abrir(Number(row.codctc)) }],
    },
  ];

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Cotação de compra (RFQ)" />

      <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-80"><Field label="&Descrição da cotação" value={novaDesc} onChange={(e) => setNovaDesc(e.target.value)} placeholder="ex.: Cotação hortifruti jul/2026" /></div>
        </div>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-96"><SelectField label="&Produto" value={prodSel} onChange={setProdSel} options={produtoOptions} placeholder="Selecione o produto" /></div>
          <div className="w-28"><NumberField label="&Qtde" value={prodQtd} decimais={2} min={0} onChange={setProdQtd} /></div>
          <Button label="&Adicionar produto" variant="ghost" onClick={addProduto} />
          <div className="w-96"><SelectField label="&Fornecedor" value={fornSel} onChange={setFornSel} options={fornecedorOptions} placeholder="Selecione o fornecedor (FRN)" /></div>
          <Button label="Con&vidar fornecedor" variant="ghost" onClick={addFornecedor} />
        </div>
        {(novosProdutos.length > 0 || novosFornecedores.length > 0) && (
          <div className="flex flex-wrap gap-gp-lg">
            <div className="min-w-64">
              <div className="text-body-sm font-semibold text-fg-muted">Produtos ({novosProdutos.length})</div>
              {novosProdutos.map((p) => (
                <div key={p.idproduto} className="flex items-center gap-gp-sm text-body-sm">
                  <span className="flex-1">{p.descricao} · qtde {brl(p.quantidade)}</span>
                  <button className="text-danger" onClick={() => setNovosProdutos((l) => l.filter((x) => x.idproduto !== p.idproduto))}>remover</button>
                </div>
              ))}
            </div>
            <div className="min-w-64">
              <div className="text-body-sm font-semibold text-fg-muted">Fornecedores ({novosFornecedores.length})</div>
              {novosFornecedores.map((f) => (
                <div key={f.codparceiro} className="flex items-center gap-gp-sm text-body-sm">
                  <span className="flex-1">{f.nome}</span>
                  <button className="text-danger" onClick={() => setNovosFornecedores((l) => l.filter((x) => x.codparceiro !== f.codparceiro))}>remover</button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div><Button label="&Criar cotação" variant="soft" disabled={busy || !novosProdutos.length || !novosFornecedores.length} onClick={() => void criar()} /></div>
      </div>

      <DataTable columns={colunas} rows={lista} loading={carregando} />
    </div>
  );
}
