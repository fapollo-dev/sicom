import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DevolucaoCompra, ItemDisponivelDevolucao, DevolucaoCompraItemDto } from '@apollo/shared';
import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { TextArea } from '../../shared/ui/TextArea';
import { LookupField } from '../../shared/ui/LookupField';
import { Modal } from '../../shared/ui/Modal';
import { useMensagem } from '../../shared/mensagem';
import { useShortcut } from '../../shared/keyboard';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import {
  obterDevolucao, criarDevolucao, atualizarDevolucao, itensDisponiveis, finalizarDevolucao, reabrirDevolucao, cancelarDevolucao, gerarNfDevolucao,
} from './devolucaoCompraApi';

const n = (v: unknown) => (Number(v) || 0);
const fmtQtd = (v: unknown) => n(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtMoeda = (v: unknown) => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

/** um item na grade do pedido (o `cdsPedidoDevCompraItens`): a origem na NF de entrada, o saldo e — gravado — o fiscal derivado no servidor */
export interface ItemEditor {
  codnf: number; codnfprod: number; idproduto: number; nronf?: string | null; nroitem?: number | null; descricao?: string | null;
  unidade?: string | null; fatorembalagem?: number; cfop?: string | null; qtd_nota_fiscal: number; saldo: number; qtd_devolvida: number;
  valor_custo: number; total_produto_devolvido?: number | null; [k: string]: unknown;
}

/** `CarregaItens` (uCadPedidoDevolucaoCompras.pas:936): entra o que ainda tem a devolver (QtdADevolver = qtde da nota − já devolvido), não repete o item */
export function juntarItens(atuais: ItemEditor[], novos: ItemDisponivelDevolucao[]): { itens: ItemEditor[]; adicionados: number } {
  const tem = new Set(atuais.map((i) => i.codnfprod));
  const add = novos.filter((d) => n(d.saldo) > 0 && !tem.has(Number(d.codnfprod)) && d.cfop_devolucao).map((d) => ({
    codnf: Number(d.codnf), codnfprod: Number(d.codnfprod), idproduto: Number(d.idproduto), nronf: d.nronf, nroitem: d.nroitem, descricao: d.descricao,
    unidade: d.unidade, fatorembalagem: n(d.fatorembalagem) || 1, cfop: d.cfop_devolucao, qtd_nota_fiscal: n(d.qtd_nota_fiscal), saldo: n(d.saldo),
    qtd_devolvida: n(d.saldo), valor_custo: n(d.valor_custo),
  } as ItemEditor));
  return { itens: [...atuais, ...add], adicionados: add.length };
}

/** os totais do rodapé (o painel de TOTAL_* do legado) — dos valores derivados pelo servidor nos itens gravados */
export function totaisDevolucao(itens: ItemEditor[]) {
  const s = (c: string) => r2(itens.reduce((a, i) => a + n(i[c]), 0));
  return {
    icms_bc: s('icms_bc'), icms: s('icms_valor'), icms_st_bc: s('icms_st_bc'), icms_st: s('icms_st_valor'), ipi: s('ipi'), descontos: s('desconto'),
    outras: s('outras_despesas'), fcp_bc_st: s('fcp_bc_st'), fcp_st: s('fcp_valor_st'), fcp_bc_st_ret: s('fcp_bc_st_ret'), fcp_st_ret: s('fcp_valor_st_ret'),
    devolvido: r2(itens.reduce((a, i) => a + (i.total_produto_devolvido != null ? n(i.total_produto_devolvido) : r2(i.qtd_devolvida * i.valor_custo)), 0)),
  };
}

/**
 * O PEDIDO DE DEVOLUÇÃO DE COMPRAS (uCadPedidoDevolucaoCompras.dfm) aberto para digitar ou consultar: o fornecedor e as observações, os itens
 * (por notas fiscais [F2] ou por produtos [F7]), a quantidade a devolver por item, "Excluir Itens Selecionados", os totais, e o workflow
 * (Finalizar Digitação [F4], Reabrir [F5], Cancelar [F6], Gerar NF, Imprimir). Só "EM DIGITACAO" edita (`PedidoLiberadoParaEdicao`).
 */
export function DevolucaoCompraEditor({ codigo, onFechar, onMudou }: { codigo: number | null; onFechar: () => void; onMudou: () => void }) {
  const mensagem = useMensagem();
  const { tem: pode } = useOpcoesDoForm('FRMCADPEDIDODEVOLUCAOCOMPRAS');
  const [doc, setDoc] = useState<DevolucaoCompra | null>(null);
  const [codparceiro, setCodparceiro] = useState<number | undefined>(undefined);
  const [obs, setObs] = useState('');
  const [itens, setItens] = useState<ItemEditor[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [pesqNf, setPesqNf] = useState(false);
  const [produtos, setProdutos] = useState<{ lista: ItemDisponivelDevolucao[]; marcados: Set<number>; filtro: string } | null>(null);
  const obsRef = useRef<HTMLTextAreaElement | null>(null);

  const status = String(doc?.status ?? 'EM DIGITACAO');
  const editavel = status === 'EM DIGITACAO';
  const id = doc?.codpeddevcompra != null ? Number(doc.codpeddevcompra) : null;

  const carregar = useCallback(async (cod: number) => {
    const d = await obterDevolucao(cod);
    setDoc(d);
    setCodparceiro(d.codparceiro ?? undefined);
    setObs(String(d.obs ?? ''));
    const salvos = ((d.itens ?? []) as unknown as Array<Record<string, unknown>>);
    // o saldo de cada item = o que ainda dá para devolver (os outros pedidos não cancelados) + o que este pedido já tem
    const porNf = new Map<number, ItemDisponivelDevolucao[]>();
    if (d.codparceiro && String(d.status) === 'EM DIGITACAO') {
      for (const codnf of [...new Set(salvos.map((s) => Number(s.codnf)))]) {
        porNf.set(codnf, await itensDisponiveis(Number(d.codparceiro), codnf).catch(() => []));
      }
    }
    setItens(salvos.map((s) => {
      const disp = (porNf.get(Number(s.codnf)) ?? []).find((x) => Number(x.codnfprod) === Number(s.codnfprod));
      return { ...s, codnf: Number(s.codnf), codnfprod: Number(s.codnfprod), idproduto: Number(s.idproduto), nronf: (disp?.nronf ?? s.nronf) as string | null,
        descricao: (s.descricao_produto ?? disp?.descricao ?? '') as string, qtd_nota_fiscal: n(s.qtd_nota_fiscal), qtd_devolvida: n(s.qtd_devolvida), valor_custo: n(s.valor_custo),
        saldo: disp ? n(disp.saldo) : n(s.qtd_devolvida) } as ItemEditor;
    }));
    setSel(new Set());
  }, []);
  useEffect(() => {
    if (codigo == null) { setDoc(null); setCodparceiro(undefined); setObs(''); setItens([]); setSel(new Set()); return; }
    carregar(codigo).catch((e) => mensagem.erro(e));
  }, [codigo, carregar, mensagem]);

  const executar = async (fn: () => Promise<void>) => {
    setOcupado(true);
    try { await fn(); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const exigirParceiro = () => {
    if (codparceiro == null) { mensagem.erro(new Error('Informe um parceiro para continuar!')); return false; }
    return true;
  };

  // "Adicionar Notas Fiscais [F2]" (btnFiltrarClick): a Pesquisa das NFs de ENTRADA do fornecedor, com multisseleção; todos os itens com saldo
  const adicionarNfs = async (linhas: Array<Record<string, unknown>>) => executar(async () => {
    setPesqNf(false);
    const nfs = [...new Set(linhas.map((l) => Number(l.codigo ?? l.codnf)).filter((x) => x > 0))];
    if (!nfs.length) { mensagem.erro(new Error('Não foram selecionados registros!')); return; }
    if (nfs.length > 990) { mensagem.erro(new Error('Não é possível adicionar a quantidade de notas selecionadas. O limite de 990 foi excedido!')); return; }
    let lista: ItemDisponivelDevolucao[] = [];
    for (const codnf of nfs) lista = lista.concat(await itensDisponiveis(Number(codparceiro), codnf));
    const r = juntarItens(itens, lista);
    if (!r.adicionados) { mensagem.erro(new Error('Todos os itens desta nota fiscal/produto já foram devolvidos! Não existem itens com quantidade a devolver!')); return; }
    setItens(r.itens);
  });
  // "Adicionar Produtos [F7]" (btnFiltrarProdutosClick): os itens de entrada do fornecedor, escolhidos um a um
  const abrirProdutos = async () => {
    if (!editavel || !exigirParceiro()) return;
    await executar(async () => setProdutos({ lista: await itensDisponiveis(Number(codparceiro)), marcados: new Set(), filtro: '' }));
  };
  const confirmarProdutos = () => {
    if (!produtos) return;
    const escolhidos = produtos.lista.filter((p) => produtos.marcados.has(Number(p.codnfprod)));
    if (!escolhidos.length) { mensagem.erro(new Error('Selecione pelo menos um registro na pesquisa!')); return; }
    const r = juntarItens(itens, escolhidos);
    setProdutos(null);
    if (!r.adicionados) { mensagem.erro(new Error('Produtos não encontrados ou não foram repassados na nota fiscal. Verifique!')); return; }
    setItens(r.itens);
  };

  // `edtQtdDevolvidaExit` :1382: não passa do que a nota ainda tem a devolver nem fica zero
  const mudarQtd = (codnfprod: number, valor: string) => {
    const it = itens.find((i) => i.codnfprod === codnfprod);
    if (!it) return;
    const q = Number(valor.replace(',', '.'));
    if (!(q > 0)) { mensagem.erro(new Error('Quantidade não pode ser zero')); return; }
    if (q > it.saldo + 0.0005) { mensagem.erro(new Error(`Quantidade não pode ser maior que a quantidade da nota fiscal a devolver: ${it.saldo.toFixed(2).replace('.', ',')}`)); return; }
    setItens(itens.map((i) => (i.codnfprod === codnfprod ? { ...i, qtd_devolvida: q, total_produto_devolvido: null } : i)));
  };
  // "Excluir Itens Selecionados" (btnExcluirItemClick, BTNEXCLUIRITEM)
  const excluirSelecionados = () => {
    if (!sel.size) { mensagem.erro(new Error('Selecione pelo menos um registro para exclusão!')); return; }
    if (!window.confirm('Deseja realmente excluir o(s) item(ns) selecionado(s)?')) return;
    setItens(itens.filter((i) => !sel.has(i.codnfprod)));
    setSel(new Set());
  };

  const corpo = () => ({
    codparceiro: Number(codparceiro), obs: obs.trim() || undefined,
    itens: itens.map((i) => ({ codnf: i.codnf, codnfprod: i.codnfprod, idproduto: i.idproduto, nroitem: i.nroitem ?? undefined, unidade: i.unidade ?? undefined,
      fatorembalagem: i.fatorembalagem || 1, cfop: i.cfop ?? undefined, qtd_nota_fiscal: i.qtd_nota_fiscal, qtd_devolvida: i.qtd_devolvida, valor_custo: i.valor_custo,
      total_produto_nota: r2(i.qtd_nota_fiscal * i.valor_custo) } as DevolucaoCompraItemDto)),
  });
  const gravar = async () => executar(async () => {
    if (!exigirParceiro()) return;
    if (!itens.length) { mensagem.erro(new Error('Informe ao menos um item para devolver.')); return; }
    const salvo = id == null ? await criarDevolucao(corpo()) : await atualizarDevolucao(id, corpo());
    mensagem.sucesso('Devolução gravada.');
    onMudou();
    await carregar(Number(salvo.codpeddevcompra ?? id));
  });
  // "Finalizar Digitação [F4]" (FinalizarDigitacao :1561): grave antes; observação em branco pergunta; depois "Deseja gerar a Nota Fiscal de Devolução?"
  const finalizar = async () => {
    if (id == null) { mensagem.erro(new Error('Grave a devolução antes de alterar seu status!')); return; }
    if (status !== 'EM DIGITACAO') { mensagem.erro(new Error('Não é possível finalizar a digitação!')); return; }
    if (!String(doc?.obs ?? '').trim() && window.confirm('Esta Devolução está com o campo Observações em branco. Deseja preenchê-lo antes de finalizar?')) {
      obsRef.current?.focus();
      return;
    }
    await executar(async () => {
      await finalizarDevolucao(id);
      mensagem.sucesso('Digitação finalizada com sucesso!');
      onMudou();
      await carregar(id);
      if (window.confirm('Deseja gerar a Nota Fiscal de Devolução?')) {
        await gerarNfDevolucao(id);
        mensagem.sucesso('NF de devolução gerada. Processe/fature na tela da NF de saída.');
        onMudou();
        await carregar(id);
      }
    });
  };
  const reabrir = async () => { if (id != null && status === 'DIGITADO') await executar(async () => { await reabrirDevolucao(id); onMudou(); await carregar(id); }); };
  const cancelar = async () => {
    if (id == null || !['EM DIGITACAO', 'DIGITADO'].includes(status)) return;
    if (!window.confirm('Deseja realmente cancelar a devolução?')) return;
    await executar(async () => { await cancelarDevolucao(id); onMudou(); await carregar(id); });
  };
  const imprimir = () => { if (id != null) imprimirRelatorio(`/compras/devolucao-compra/${id}/impressao`).catch((e) => mensagem.erro(e)); };

  useShortcut('f2', () => { if (editavel && exigirParceiro()) setPesqNf(true); });
  useShortcut('f7', () => { void abrirProdutos(); });
  useShortcut('f4', () => { void finalizar(); });
  useShortcut('f5', () => { void reabrir(); });
  useShortcut('f6', () => { void cancelar(); });

  const tot = useMemo(() => totaisDevolucao(itens), [itens]);
  const podeGravar = editavel && (id == null ? pode('BTNADICIONARREGISTRO') : pode('BTNGRAVAR') || pode('BTNEDITAR'));
  const prodVisiveis = (produtos?.lista ?? []).filter((p) => !produtos?.filtro.trim() || `${p.idproduto} ${p.descricao ?? ''} ${p.nronf ?? ''}`.toUpperCase().includes(produtos.filtro.trim().toUpperCase()));
  const th = 'py-1 pr-2 text-left font-semibold text-fg-muted';
  const td = 'py-1 pr-2';
  const tdn = 'py-1 pr-2 text-right tabular-nums';

  return (
    <fieldset className="rounded-radius-md border border-border bg-bg-surface p-pad-md" disabled={ocupado}>
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">{id == null ? 'Nova devolução' : `Devolução ${id}`}</legend>
      <div className="flex flex-wrap items-end gap-gp-sm">
        <div className="w-96">
          <LookupField label="&Fornecedor" recurso="lookup/parceiros" campoCodigo="codparceiro" descricao="razao" fixos={{ frn: 'S' }} value={codparceiro}
            disabled={!editavel || itens.length > 0} onChange={(cod) => setCodparceiro(cod ? Number(cod) : undefined)} />
        </div>
        {doc && <span className="text-body-sm text-fg-muted">Situação: <b className="text-fg-default">{status}</b>{doc.data ? ` · ${new Date(String(doc.data)).toLocaleString('pt-BR')}` : ''}</span>}
        {doc?.codnf_emitida != null && <span className="text-body-sm text-fg-muted">NF emitida: <b className="text-fg-default">{String(doc.codnf_emitida)}</b></span>}
      </div>
      <div className="mt-form-gap">
        <TextArea ref={obsRef} label="Observações" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} disabled={!editavel} />
      </div>
      <div className="mt-form-gap flex flex-wrap items-center gap-gp-sm">
        <Button label="Adicionar Notas &Fiscais [F2]" variant="soft" disabled={!editavel} onClick={() => { if (exigirParceiro()) setPesqNf(true); }} />
        <Button label="Adicionar &Produtos [F7]" variant="soft" disabled={!editavel} onClick={() => void abrirProdutos()} />
        <Button label="Exc&luir Itens Selecionados" variant="ghost" disabled={!editavel || !pode('BTNEXCLUIRITEM')} onClick={excluirSelecionados} />
        <div className="flex-1" />
        <Button label="&Gravar" variant="filled" disabled={!podeGravar} onClick={() => void gravar()} />
        <Button label="Finalizar Digitação [F4]" variant="soft" disabled={id == null || status !== 'EM DIGITACAO'} onClick={() => void finalizar()} />
        <Button label="Reabrir Para Digitação [F5]" variant="soft" disabled={status !== 'DIGITADO' || id == null} onClick={() => void reabrir()} />
        <Button label="Cancelar [F6]" variant="ghost" disabled={id == null || !['EM DIGITACAO', 'DIGITADO'].includes(status)} onClick={() => void cancelar()} />
        <Button label="Imprimir" variant="ghost" disabled={id == null} onClick={imprimir} />
        <Button label="Fechar" variant="ghost" onClick={onFechar} />
      </div>
      <div className="mt-form-gap overflow-x-auto">
        <table className="w-full min-w-[1100px] text-body-sm">
          <thead><tr className="border-b border-border">
            <th className={th}><input type="checkbox" aria-label="Selecionar todos" checked={itens.length > 0 && sel.size === itens.length} onChange={() => setSel(sel.size === itens.length ? new Set() : new Set(itens.map((i) => i.codnfprod)))} /></th>
            <th className={th}>Nro. NF</th><th className={th}>Item</th><th className={th}>CFOP</th><th className={th}>Produto</th>
            <th className={`${th} text-right`}>Qtd. NF</th><th className={`${th} text-right`}>Custo</th><th className={`${th} text-right`}>Qtde a Devolver</th>
            <th className={`${th} text-right`}>Total Prod. Devolvido</th><th className={`${th} text-right`}>ICMS BC</th><th className={`${th} text-right`}>ICMS</th>
            <th className={`${th} text-right`}>ICMS ST</th><th className={`${th} text-right`}>IPI</th>
          </tr></thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.codnfprod} className="border-b border-border">
                <td className={td}><input type="checkbox" aria-label={`Selecionar ${i.descricao ?? i.idproduto}`} checked={sel.has(i.codnfprod)} onChange={() => { const x = new Set(sel); if (x.has(i.codnfprod)) x.delete(i.codnfprod); else x.add(i.codnfprod); setSel(x); }} /></td>
                <td className={td}>{i.nronf ?? i.codnf}</td><td className={td}>{i.nroitem ?? ''}</td><td className={td}>{i.cfop ?? ''}</td>
                <td className={td}>{i.idproduto} - {i.descricao ?? ''}</td>
                <td className={tdn}>{fmtQtd(i.qtd_nota_fiscal)}</td><td className={tdn}>{fmtMoeda(i.valor_custo)}</td>
                <td className={tdn}>
                  {editavel
                    ? <input aria-label={`Qtde a devolver ${i.descricao ?? i.idproduto}`} className="w-24 rounded border border-border bg-bg-surface px-1 text-right tabular-nums" defaultValue={String(i.qtd_devolvida).replace('.', ',')} onBlur={(e) => mudarQtd(i.codnfprod, e.target.value)} />
                    : fmtQtd(i.qtd_devolvida)}
                </td>
                <td className={tdn}>{fmtMoeda(i.total_produto_devolvido != null ? i.total_produto_devolvido : r2(i.qtd_devolvida * i.valor_custo))}</td>
                <td className={tdn}>{i.icms_bc != null ? fmtMoeda(i.icms_bc) : '—'}</td><td className={tdn}>{i.icms_valor != null ? fmtMoeda(i.icms_valor) : '—'}</td>
                <td className={tdn}>{i.icms_st_valor != null ? fmtMoeda(i.icms_st_valor) : '—'}</td><td className={tdn}>{i.ipi != null ? fmtMoeda(i.ipi) : '—'}</td>
              </tr>
            ))}
            {!itens.length && <tr><td className={`${td} text-fg-muted`} colSpan={13}>Adicione os itens pelas notas fiscais [F2] ou pelos produtos [F7].</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-form-gap grid grid-cols-2 gap-gp-sm text-body-sm sm:grid-cols-4 lg:grid-cols-6">
        <span className="text-fg-muted">BC ICMS <b className="tabular-nums text-fg-default">{fmtMoeda(tot.icms_bc)}</b></span>
        <span className="text-fg-muted">ICMS <b className="tabular-nums text-fg-default">{fmtMoeda(tot.icms)}</b></span>
        <span className="text-fg-muted">BC ICMS ST <b className="tabular-nums text-fg-default">{fmtMoeda(tot.icms_st_bc)}</b></span>
        <span className="text-fg-muted">ICMS ST <b className="tabular-nums text-fg-default">{fmtMoeda(tot.icms_st)}</b></span>
        <span className="text-fg-muted">IPI <b className="tabular-nums text-fg-default">{fmtMoeda(tot.ipi)}</b></span>
        <span className="text-fg-muted">Descontos <b className="tabular-nums text-fg-default">{fmtMoeda(tot.descontos)}</b></span>
        <span className="text-fg-muted">Outras desp. <b className="tabular-nums text-fg-default">{fmtMoeda(tot.outras)}</b></span>
        <span className="text-fg-muted">BC FCP ST <b className="tabular-nums text-fg-default">{fmtMoeda(tot.fcp_bc_st)}</b></span>
        <span className="text-fg-muted">FCP ST <b className="tabular-nums text-fg-default">{fmtMoeda(tot.fcp_st)}</b></span>
        <span className="text-fg-muted">BC FCP ST Ret. <b className="tabular-nums text-fg-default">{fmtMoeda(tot.fcp_bc_st_ret)}</b></span>
        <span className="text-fg-muted">FCP ST Ret. <b className="tabular-nums text-fg-default">{fmtMoeda(tot.fcp_st_ret)}</b></span>
        <span className="text-fg-muted">Total devolvido <b className="tabular-nums text-fg-default">{fmtMoeda(tot.devolvido)}</b></span>
      </div>

      {pesqNf && (
        <Pesquisa resourcePath="fiscal/nf" parametros={{ tipo: 'E' }} multisselecao
          onSelecionarVarios={(ls) => void adicionarNfs(ls)} onSelecionar={(l) => void adicionarNfs([l])} onFechar={() => setPesqNf(false)} />
      )}
      {produtos && (
        <Modal open onClose={() => setProdutos(null)} size="lg" title="Adicionar produtos"
          primaryAction={{ label: 'Adicionar', onClick: confirmarProdutos }} secondaryAction={{ label: 'Cancelar', onClick: () => setProdutos(null) }}>
          <div className="flex flex-col gap-gp-sm">
            <Field label="Localizar (produto, descrição ou NF)" value={produtos.filtro} onChange={(e) => setProdutos({ ...produtos, filtro: e.target.value })} />
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-body-sm">
                <thead><tr className="border-b border-border"><th className={th}></th><th className={th}>NF</th><th className={th}>Produto</th><th className={`${th} text-right`}>Saldo</th><th className={`${th} text-right`}>Custo</th></tr></thead>
                <tbody>{prodVisiveis.map((p) => (
                  <tr key={p.codnfprod} className="border-b border-border">
                    <td className={td}><input type="checkbox" aria-label={`Marcar ${p.descricao ?? p.idproduto}`} disabled={!p.cfop_devolucao} checked={produtos.marcados.has(Number(p.codnfprod))}
                      onChange={() => { const m = new Set(produtos.marcados); if (m.has(Number(p.codnfprod))) m.delete(Number(p.codnfprod)); else m.add(Number(p.codnfprod)); setProdutos({ ...produtos, marcados: m }); }} /></td>
                    <td className={td}>{p.nronf ?? p.codnf}</td><td className={td}>{p.idproduto} - {p.descricao ?? ''}{!p.cfop_devolucao && <span className="text-danger"> (sem CFOP de devolução)</span>}</td>
                    <td className={tdn}>{fmtQtd(p.saldo)}</td><td className={tdn}>{fmtMoeda(p.valor_custo)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}
    </fieldset>
  );
}
