import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { SelectField } from '../../shared/ui/SelectField';
import { DateField } from '../../shared/ui/DateField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { LookupField } from '../../shared/ui/LookupField';
import { Modal } from '../../shared/ui/Modal';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { useShortcut } from '../../shared/keyboard';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import {
  listarScraps, obterScrap, criarScrap, atualizarScrap, aplicarScrap, estornarScrap, listarMotivosPerda, apoioScrap, produtoScrap, excluirItensScrap, excluirScrapLiberado,
  type ScrapHeader, type ScrapDetalhe, type ScrapItem, type MotivoPerda, type ScrapApoio, type ProdutoScrap,
} from './scrapApi';

const q3 = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const brl = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dt = (d: string | null | undefined) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const CHAVE_PLU = 'scrap.buscaPLU'; // o "Buscar por PLU (F2)" guardado por estação (ConfigTelas.ini do legado)

/**
 * SCRAP / PERDAS (FRMCADSCRAP, uCadSCRAP.pas). O documento nasce como no legado: situação (E02), centro de custo de perda,
 * o fornecedor = o parceiro da empresa, e os itens (produto pelo código de barras/auxiliar ou pelo código com "Buscar por PLU (F2)",
 * quantidade, motivo, setor quando o centro de custo pede; o produto filho vem do próprio código) — gravados de uma vez; o custo é
 * snapshot do servidor (MULTI_PRECO) e a perda vai à CAIXA gerencial. A exclusão do item gravado e do documento pede a liberação por
 * login (PEDE_SENHA_EXCLUIR_ITEM_SCRAP); o scrap importado numa NF de perda não se altera. «Aplicar» (baixa de estoque) só existe com
 * BAIXAR_ESTOQUE_NO_SCRAP='S' — no cliente quem baixa é a NF de perda.
 */
export function ScrapPage() {
  // as permissões de controle da tela (uCadSCRAP.dfm — docs/05-migration-engineering/permissoes-de-controle.md)
  const { tem: pode } = useOpcoesDoForm('FRMCADSCRAP');
  const mensagem = useMensagem();
  const navigate = useNavigate();
  const [lista, setLista] = useState<ScrapHeader[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sel, setSel] = useState<ScrapDetalhe | null>(null);
  const [apoio, setApoio] = useState<ScrapApoio | null>(null);
  const [situacao, setSituacao] = useState('');
  const [codplc, setCodplc] = useState('');
  const [dtCadastro, setDtCadastro] = useState<string | undefined>(hojeLocal());
  const [novoSetor, setNovoSetor] = useState('');
  const [itens, setItens] = useState<ScrapItem[]>([]);
  const [motivos, setMotivos] = useState<MotivoPerda[]>([]);
  const [buscaPLU, setBuscaPLU] = useState<boolean>(() => { try { return localStorage.getItem(CHAVE_PLU) === 'S'; } catch { return false; } });
  const [codigoProd, setCodigoProd] = useState('');
  const [selProd, setSelProd] = useState<ProdutoScrap | null>(null);
  const [novaQtde, setNovaQtde] = useState<number | undefined>();
  const [novoMotivo, setNovoMotivo] = useState('');
  const [obs, setObs] = useState('');
  const [linhaSel, setLinhaSel] = useState<number | null>(null);
  const [liberar, setLiberar] = useState<{ tipo: 'item' | 'doc'; codscrapitens?: number[] } | null>(null);
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [outrosAberto, setOutrosAberto] = useState(false);
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

  const limparEntrada = () => { setCodigoProd(''); setSelProd(null); setNovaQtde(undefined); setNovoMotivo(''); setNovoSetor(''); };
  const abrir = async (id: number) => {
    try {
      const d = await obterScrap(id);
      setSel(d);
      setItens((d.itens ?? []).map((i) => ({ ...i, idproduto: Number(i.idproduto), qtde: Number(i.qtde) })));
      setObs(d.obs ?? '');
      setSituacao(d.idsituacao_nf ? String(d.idsituacao_nf) : '');
      setCodplc(d.codplc ? String(d.codplc) : '');
      setDtCadastro(d.dt_cadastro ? String(d.dt_cadastro).slice(0, 10) : undefined);
      setDirty(false);
      setLinhaSel(null);
      limparEntrada();
    } catch (e) {
      mensagem.erro(e);
    }
  };
  const novo = () => {
    // a situação: com uma só, já vem escolhida (`InformaSituacaoDocumento`, uCadSCRAP.pas:1648)
    const sits = apoio?.situacoes ?? [];
    setSel({ codscrap: 0, dt_cadastro: null, itens: [] });
    setItens([]); setObs(''); setCodplc(''); setSituacao(sits.length === 1 ? String(sits[0].idsituacao_nf) : '');
    setDtCadastro(hojeLocal());
    setDirty(true);
    setLinhaSel(null);
    limparEntrada();
  };

  const centro = apoio?.centros.find((c) => String(c.codplc) === codplc);
  const usaSetor = centro?.uso_setor === 'S';
  const aplicado = sel?.mov_estoque === 'S';
  // `Importado` (uCadSCRAP.pas:1595): ligado a uma NF de perda, o scrap não se altera nem se exclui
  const notas = sel?.notas ?? [];
  const importado = !!sel && sel.codscrap > 0 && (sel.importado === 'S' || notas.length > 0);
  const avisoImportado = () => window.alert(`Este SCRAP já foi importado. Não será possível alterá-lo.\nNF.: ${notas.map((n) => n.codnf).join(', ')}`);
  const travado = aplicado || importado;

  // "Buscar por PLU (F2)": o código digitado é o do produto; senão é o código de barras (ou auxiliar)
  const alternarPLU = () => {
    setBuscaPLU((v) => { const n = !v; try { localStorage.setItem(CHAVE_PLU, n ? 'S' : 'N'); } catch { /* sem armazenamento local */ } return n; });
  };
  useShortcut('f2', () => { if (sel) alternarPLU(); });
  // [F6] - Análise geral do produto (MostraAnaliseGeralProduto): a posição do produto da linha corrente
  const analiseGeral = () => {
    const it = linhaSel != null ? itens[linhaSel] : itens[itens.length - 1];
    if (!it) { window.alert('Selecione um item do SCRAP.'); return; }
    navigate(`/cadastro/produtos/posicao?idproduto=${it.idproduto}`);
  };
  useShortcut('f6', () => { if (sel) analiseGeral(); });

  // o produto pelo código (EdtCodProdutoKeyDown → IniciaProcessoInsercaoProduto → GetProduto)
  const resolverProduto = async (codigo: string, plu = buscaPLU) => {
    const c = codigo.trim();
    if (!c) return;
    if (plu && !/^\d+$/.test(c)) { window.alert('Produto não encontrado.'); return; }
    try {
      const p = await produtoScrap(c, plu);
      // BLOQUEIA_PRODUTO_DUPLICADO_SCRAP: o mesmo produto (pai + filho) já na lista ('N' no módulo Retaguarda da produção)
      if (apoio?.bloqueiaDuplicado && itens.some((i) => Number(i.idproduto) === p.idproduto && Number(i.idproduto_filho ?? 0) === Number(p.idproduto_filho ?? 0))) {
        window.alert('O produto já foi inserido no SCRAP anteriormente.');
        return;
      }
      setSelProd(p);
      setCodigoProd(c);
    } catch (e) {
      mensagem.erro(e);
    }
  };
  const addItem = () => {
    if (travado) { if (importado) avisoImportado(); return; }
    if (!selProd) { window.alert('Informe o produto.'); return; }
    if (novaQtde == null) { window.alert('Informe a quantidade.'); return; }
    if (novaQtde < 0) { window.alert('Quantidade não pode ser MENOR QUE ZERO. Verifique!'); return; }
    // ProdutoUndFracionado (uCadSCRAP.pas:1772): só o KG fraciona
    if (String(selProd.unidade ?? '').trim().toUpperCase() !== 'KG' && Math.abs(novaQtde - Math.trunc(novaQtde)) > 0) { window.alert('Não é permitido fracionar produto que não seja Kg!'); setNovaQtde(0); return; }
    if (usaSetor && !novoSetor) { window.alert('O centro de custo informado está marcado com a flag Uso de setor. Informe o setor de consumo e tente novamente!'); return; }
    if ((apoio?.informaMotivo || centro?.obriga_motivo === 'S') && !novoMotivo) { window.alert('Informe o motivo da perda e tente novamente.'); return; }
    setItens((xs) => [...xs, {
      idproduto: selProd.idproduto, idproduto_filho: selProd.idproduto_filho ?? null, qtde: novaQtde, codmotivoop: novoMotivo ? Number(novoMotivo) : null,
      codsetor: novoSetor ? Number(novoSetor) : null, codfor: selProd.codfor ?? null, vr_custo: selProd.vrcusto, vrcustorep: selProd.vrcustorep,
      codbarra: selProd.codbarra, descricao: selProd.descricao, unidade: selProd.unidade, fornecedor: selProd.fornecedor, origem: 'ESTOQUE', faturado: 'N',
    }]);
    setDirty(true);
    limparEntrada();
  };
  // "Excluir" da grade (btnExcluirIClick): o item novo sai da lista; o gravado pede a liberação por login (PEDE_SENHA_EXCLUIR_ITEM_SCRAP)
  const excluirItensGravados = async (cods: number[], cred: { login?: string; senha?: string }) => {
    if (!sel) return;
    const d = await excluirItensScrap(sel.codscrap, { codscrapitens: cods, ...cred });
    setSel(d);
    setItens((d.itens ?? []).map((i) => ({ ...i, idproduto: Number(i.idproduto), qtde: Number(i.qtde) })));
    setLiberar(null); setLogin(''); setSenha('');
    mensagem.sucesso('Item excluído.');
    await carregarLista();
  };
  const removerItem = async (ix: number) => {
    const it = itens[ix];
    if (!it) return;
    if (importado) { avisoImportado(); return; }
    if (!window.confirm('Deseja excluir o item selecionado?')) return;
    if (!it.codscrapitem) { setItens((xs) => xs.filter((_, i) => i !== ix)); setDirty(true); return; }
    if (apoio?.pedeSenhaExcluir) { setLiberar({ tipo: 'item', codscrapitens: [it.codscrapitem] }); return; }
    try { await excluirItensGravados([it.codscrapitem], {}); } catch (e) { mensagem.erro(e); }
  };
  // "Limpar" (btnLimparIClick): todos os produtos, com a confirmação — sem senha (o legado só confere o importado)
  const limpar = () => {
    if (importado) { avisoImportado(); return; }
    if (!itens.length) return;
    if (!window.confirm('Deseja limpar todos os produtos deste pedido?')) return;
    setItens([]); setDirty(true); setLinhaSel(null);
  };
  const salvar = async () => {
    if (!sel || busy) return;
    if (importado) { avisoImportado(); return; }
    if (aplicado) { window.alert('Estorne a baixa antes de editar os itens.'); return; }
    if (!itens.length) { window.alert('Obrigatório informar um item. Verifique!'); return; }
    if (!codplc) { window.alert('Informe o centro de custo e tente novamente!'); return; }
    if (apoio?.informaSituacao && !situacao) { window.alert('Informe a situação do documento.'); return; }
    if (itens.some((i) => Number(i.qtde) === 0) && !window.confirm('Existem produtos com quantidade zerada que serão excluídos da lista do scrap ao gravar.\nDeseja continuar?')) return;
    setBusy(true);
    try {
      const body = {
        ...(sel.codscrap ? {} : { dt_cadastro: dtCadastro }),
        codplc: Number(codplc), idsituacao_nf: situacao ? Number(situacao) : null, obs: obs || undefined,
        itens: itens.map((i) => ({ idproduto: i.idproduto, qtde: i.qtde, codmotivoop: i.codmotivoop ?? null, codsetor: i.codsetor ?? null, codfor: i.codfor ?? null, idproduto_filho: i.idproduto_filho ?? null })),
      };
      const d = sel.codscrap ? await atualizarScrap(sel.codscrap, body) : await criarScrap(body);
      mensagem.sucesso(sel.codscrap ? 'Perda salva.' : `Lançamento de perda ${d.codscrap} gravado.`);
      await abrir(d.codscrap);
      await carregarLista();
    } catch (e) {
      const code = (e as { envelope?: { code?: string } })?.envelope?.code;
      if (code === 'SCRAP_IMPORTADO_NA_NF') avisoImportado(); else mensagem.erro(e);
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
  // "Excluir" do documento (btnExcluirClick): o importado não sai; com PEDE_SENHA_EXCLUIR_ITEM_SCRAP, a liberação por login
  const excluirDoc = async (cred: { login?: string; senha?: string }) => {
    if (!sel) return;
    await excluirScrapLiberado(sel.codscrap, cred);
    setLiberar(null); setLogin(''); setSenha('');
    mensagem.sucesso('Lançamento excluído.');
    setSel(null);
    await carregarLista();
  };
  const excluir = async () => {
    if (!sel || busy) return;
    if (importado) { avisoImportado(); return; }
    if (!window.confirm(`Excluir o lançamento de perda nº ${sel.codscrap}?`)) return;
    if (apoio?.pedeSenhaExcluir) { setLiberar({ tipo: 'doc' }); return; }
    setBusy(true);
    try { await excluirDoc({}); } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  const confirmarLiberacao = async () => {
    if (!liberar) return;
    setBusy(true);
    try {
      if (liberar.tipo === 'item') await excluirItensGravados(liberar.codscrapitens ?? [], { login, senha });
      else await excluirDoc({ login, senha });
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };
  const motivoLabel = (cod?: number | null) => motivos.find((m) => m.codmotivoop === Number(cod))?.descricao ?? (cod ? String(cod) : '—');
  const setorLabel = (cod?: number | null) => apoio?.setores.find((x) => x.codsetor === Number(cod))?.nome ?? (cod ? String(cod) : '—');
  const totalDoc = itens.reduce((s, i) => s + Number(i.qtde) * Number(i.vr_custo ?? 0), 0);
  const podeGravar = sel?.codscrap ? pode('BTNGRAVAR') && pode('BTNEDITAR') : pode('BTNGRAVAR');

  // ─────────────────────────── DETALHE ───────────────────────────
  if (sel) {
    return (
      <div className="flex flex-col gap-gp-md p-pad-md">
        <PageHeader title={sel.codscrap ? `Perda nº ${sel.codscrap}${aplicado ? ' — APLICADA (estoque baixado)' : ''}${importado ? ' — IMPORTADA NA NF' : ''}` : 'Nova perda'} />
        <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="w-40"><DateField label="&Data" value={dtCadastro} onChange={(v) => { setDtCadastro(v); setDirty(true); }} disabled={travado || !!sel.codscrap} /></div>
          <div className="w-56"><SelectField label="Situaç&ão" value={situacao} onChange={(v) => { setSituacao(v); setDirty(true); }} disabled={travado || !!sel.codscrap} options={(apoio?.situacoes ?? []).map((x) => ({ value: String(x.idsituacao_nf), label: `${x.idsituacao_nf} · ${x.descricao}` }))} placeholder="(situação do documento)" /></div>
          <div className="w-72"><SelectField label="Centro de custo" value={codplc} onChange={(v) => { setCodplc(v); setDirty(true); }} disabled={travado}
            options={(apoio?.centros ?? []).filter((c) => { const lista = situacao ? apoio?.centrosDaSituacao?.[situacao] : undefined; return !lista?.length || lista.includes(c.codplc); }).map((c) => ({ value: String(c.codplc), label: `${c.desccodplc ?? c.codplc} · ${c.descricao}` }))} placeholder="(centro de custo de perda)" /></div>
          <div className="w-64"><Field label="Parceiro" value={apoio?.parceiro?.razao ?? (apoio?.parceiro?.codparceiro ? String(apoio.parceiro.codparceiro) : '')} onChange={() => undefined} disabled /></div>
          <div className="w-80"><Field label="Observação" value={obs} onChange={(e) => { setObs(e.target.value); setDirty(true); }} placeholder="observação do lançamento" disabled={travado} /></div>
          <Button label="&Gravar" variant="soft" disabled={busy || travado || !podeGravar} onClick={() => void salvar()} />
          {apoio?.baixarEstoque && !!sel.codscrap && !aplicado && <Button label="&Aplicar (baixar estoque)" variant="soft" disabled={busy || !itens.length || dirty} onClick={() => void aplicar()} />}
          {aplicado && <Button label="&Estornar baixa" variant="soft" disabled={busy} onClick={() => void estornar()} />}
          {!!sel.codscrap && <Button label="Excluir" variant="ghost" disabled={busy || aplicado || !pode('BTNEXCLUIR')} onClick={() => void excluir()} />}
          {/* "Imprimir Scrap" (ImprimirScrap1Click): o extr - Scrap.fr3 do cliente com o lançamento gravado */}
          {!!sel.codscrap && <Button label="&Imprimir" variant="ghost" disabled={busy} onClick={() => { imprimirRelatorio(`/cadastro/scrap/${sel.codscrap}/impressao`).catch((e) => mensagem.erro(e)); }} />}
          <div className="relative">
            <Button label="&Outros" variant="ghost" onClick={() => setOutrosAberto((v) => !v)} />
            {outrosAberto && (
              <div role="menu" className="absolute z-10 mt-gp-xs flex min-w-72 flex-col rounded-radius-md border border-border bg-bg-surface p-pad-xs shadow-sh-md">
                <button type="button" role="menuitem" className="rounded-radius-base px-pad-sm py-pad-xs text-left text-body-sm hover:bg-bg-subtle disabled:opacity-50" disabled={!itens.length}
                  onClick={() => { setOutrosAberto(false); analiseGeral(); }}>[F6] - Análise geral do produto</button>
                <button type="button" role="menuitem" className="rounded-radius-base px-pad-sm py-pad-xs text-left text-body-sm text-fg-muted" disabled
                  title="A importação de perdas das vendas/NF não tem uso na produção desde 2024 (0 itens em 2025-26)">[F7] - Importar produtos</button>
              </div>
            )}
          </div>
          <Button label="&Voltar" variant="ghost" onClick={() => { setSel(null); void carregarLista(); }} />
          <small className="w-full text-fg-muted">Valor da perda = quantidade × custo (MULTI_PRECO); ao gravar, a diferença vai à CAIXA gerencial no centro de custo. {dirty && !travado ? 'Há alterações não gravadas. ' : ''}{importado ? `Importado na NF ${notas.map((n) => n.codnf).join(', ')} — sem alteração.` : ''}</small>
        </div>
        {!travado && (
          <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="w-48">
              <Field label={buscaPLU ? 'Cód. do &produto' : 'Código de &barra'} value={codigoProd} onChange={(e) => { setCodigoProd(e.target.value); if (selProd) setSelProd(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void resolverProduto(codigoProd); } }} placeholder={buscaPLU ? 'código + Enter' : 'código de barras + Enter'} />
            </div>
            <CheckboxField label="Buscar por PLU (F2)" value={buscaPLU ? 'S' : 'N'} onChange={() => alternarPLU()} />
            <div className="w-72">
              {/* a Pesquisa de produtos (BtnBuscaProduto / F3, GetProdutoPesquisa): escolhido, entra pelo código do produto */}
              <LookupField label="Produto (F3)" recurso="lookup/produtos" campoCodigo="idproduto" descricao="descricao" value={selProd?.idproduto ?? undefined}
                onChange={(cod) => { if (cod) void resolverProduto(String(cod), true); }} />
            </div>
            <div className="w-32"><NumberField label="&Qtde" value={novaQtde} decimais={3} onChange={setNovaQtde} /></div>
            <div className="w-56"><SelectField label="&Motivo perda" value={novoMotivo} onChange={setNovoMotivo} options={motivos.map((m) => ({ value: String(m.codmotivoop), label: m.descricao }))} placeholder="(motivo da perda)" /></div>
            <div className="w-48"><SelectField label="&Setor consumo" value={novoSetor} onChange={setNovoSetor} options={(apoio?.setores ?? []).map((x) => ({ value: String(x.codsetor), label: x.nome }))} placeholder="(setor de consumo)" disabled={!usaSetor} /></div>
            <Button label="&Adicionar" variant="soft" disabled={!pode('BTNADICIONARITEM') || !selProd} onClick={addItem} />
            <Button label="&Limpar" variant="ghost" disabled={!pode('BTNLIMPARI') || !itens.length} onClick={limpar} />
            {selProd && (
              <small className="w-full text-fg-muted">
                {selProd.descricao} · {selProd.unidade ?? ''} · custo {brl(selProd.vrcusto)} · estoque {q3(selProd.qtde_estoque)}{selProd.idproduto_filho ? ` · filho ${selProd.idproduto_filho} do pai ${selProd.idproduto}` : ''}{selProd.fornecedor ? ` · ${selProd.fornecedor}` : ''}
              </small>
            )}
          </div>
        )}
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="p-pad-xs">Cod.prod</th>
                {apoio?.exibeProdutoPai && <th className="p-pad-xs">Cod.Prod Filho</th>}
                <th className="p-pad-xs">Codigo Barra</th>
                <th className="p-pad-xs">Descrição</th>
                <th className="p-pad-xs text-right">Qtde</th>
                <th className="p-pad-xs text-right">Vr.Custo</th>
                <th className="p-pad-xs text-right">Custo Repos.</th>
                <th className="p-pad-xs text-right">Total</th>
                <th className="p-pad-xs">Origem</th>
                <th className="p-pad-xs">Faturado</th>
                <th className="p-pad-xs">Imp</th>
                <th className="p-pad-xs">Origem Imp.</th>
                <th className="p-pad-xs">Setor</th>
                <th className="p-pad-xs">Motivo perda</th>
                <th className="p-pad-xs">Fornecedor</th>
                {!travado && <th className="p-pad-xs" />}
              </tr>
            </thead>
            <tbody>
              {itens.map((it, ix) => (
                <tr key={it.codscrapitem ?? `n${ix}`} className={`cursor-pointer border-t border-border ${linhaSel === ix ? 'bg-bg-subtle' : ''}`} onClick={() => setLinhaSel(ix)} aria-selected={linhaSel === ix}>
                  <td className="p-pad-xs tabular-nums">{it.idproduto}</td>
                  {apoio?.exibeProdutoPai && <td className="p-pad-xs tabular-nums">{it.idproduto_filho ?? ''}</td>}
                  <td className="p-pad-xs font-mono">{it.codbarra ?? ''}</td>
                  <td className="p-pad-xs">{it.descricao ?? ''}</td>
                  <td className="p-pad-xs text-right tabular-nums">{q3(Number(it.qtde))}</td>
                  <td className="p-pad-xs text-right tabular-nums">{it.vr_custo != null ? brl(Number(it.vr_custo)) : '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{it.vrcustorep != null ? brl(Number(it.vrcustorep)) : '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{it.vr_custo != null ? brl(Number(it.qtde) * Number(it.vr_custo)) : '—'}</td>
                  <td className="p-pad-xs">{it.origem ?? 'ESTOQUE'}</td>
                  <td className="p-pad-xs">{it.faturado ?? 'N'}</td>
                  <td className="p-pad-xs">{it.imp_vendas ?? ''}</td>
                  <td className="p-pad-xs">{it.origem_perda ?? ''}</td>
                  <td className="p-pad-xs">{setorLabel(it.codsetor)}</td>
                  <td className="p-pad-xs">{motivoLabel(it.codmotivoop)}</td>
                  <td className="p-pad-xs">{it.fornecedor ?? (it.codfor ? String(it.codfor) : '')}</td>
                  {!travado && <td className="p-pad-xs text-right"><Button label="Excluir" variant="ghost" disabled={!pode('BTNEXCLUIRI')} onClick={() => void removerItem(ix)} /></td>}
                </tr>
              ))}
              {!itens.length && <tr><td colSpan={17} className="p-pad-md text-fg-muted">Sem itens. Informe o código do produto, a quantidade e o motivo.</td></tr>}
            </tbody>
            {itens.length > 0 && (
              <tfoot>
                <tr className="border-t border-border font-semibold">
                  <td className="p-pad-xs" colSpan={apoio?.exibeProdutoPai ? 7 : 6}>Total itens</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(totalDoc)}</td>
                  <td className="p-pad-xs" colSpan={8} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {/* o grupo "Notas fiscais" (grpNotasFiscais, visível quando o scrap foi importado): a NF de perda, com o status */}
        {notas.length > 0 && (
          <div className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <span className="text-body-sm font-semibold text-fg-default">Notas fiscais</span>
            <table className="mt-gp-xs w-full text-body-sm"><thead><tr className="text-left text-fg-muted"><th className="p-pad-xs">Código</th><th className="p-pad-xs">Número</th><th className="p-pad-xs">Data emissão</th><th className="p-pad-xs">Status</th><th className="p-pad-xs" /></tr></thead>
              <tbody>{notas.map((n) => (
                <tr key={n.codnf} className="border-t border-border"><td className="p-pad-xs tabular-nums">{n.codnf}</td><td className="p-pad-xs">{n.nronf ?? ''}</td><td className="p-pad-xs">{dt(n.dtemissao)}</td><td className="p-pad-xs">{n.statusnota}</td>
                  <td className="p-pad-xs text-right"><Button label="abrir" variant="ghost" onClick={() => navigate(`/fiscal/notas/${n.tiponf === 'E' ? 'entrada' : 'saida'}?codigo=${n.codnf}`)} /></td></tr>
              ))}</tbody></table>
          </div>
        )}
        {liberar && (
          <Modal open onClose={() => { setLiberar(null); setLogin(''); setSenha(''); }} size="sm" title={liberar.tipo === 'item' ? 'Liberar a exclusão do item' : 'Liberar a exclusão do SCRAP'}
            primaryAction={{ label: 'Confirmar', onClick: () => void confirmarLiberacao() }} secondaryAction={{ label: 'Cancelar', onClick: () => { setLiberar(null); setLogin(''); setSenha(''); } }}>
            <div className="flex flex-col gap-form-gap">
              <small className="text-fg-muted">A exclusão pede a liberação de quem não precisa de senha para excluir item de Scrap (PEDE_SENHA_EXCLUIR_ITEM_SCRAP).</small>
              <Field label="&Login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
              <Field label="&Senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" />
            </div>
          </Modal>
        )}
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
    { field: 'importado', headerName: 'Importado', type: 'text', width: 110, valueFormatter: (v: unknown) => (v === 'S' ? 'Sim' : '—') },
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
        <Button label="&Novo lançamento de perda" variant="soft" disabled={busy || !pode('BTNADICIONARREGISTRO')} onClick={novo} />
        <small className="text-fg-muted">Registre quebra/vencimento/avaria e baixe do estoque.</small>
      </div>
      <DataTable columns={colunas} rows={lista} loading={carregando} getRowId={(r) => String(r.codscrap)} toolbar={{ enableSearch: false, enableFilters: false }} cardBreakpoint={false} />
    </div>
  );
}
