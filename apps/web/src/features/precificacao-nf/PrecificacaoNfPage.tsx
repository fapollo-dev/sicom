import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Item {
  codnfprod: number; idproduto: number; codnf: number; nronf: string; dtemissao: string;
  descricao: string; codbarra: string; codprodnota: string; quantidade: number; fatorembal: number;
  vrcusto: number; custo_rep: number; custo_csi: number; ultcusto: number | null;
  ult_custo_rep: number | null; vrvenda: number; preco_venda: number; pmz: number; vrvendasug: number;
  markup: number; markdown: number; markupfixo: number; vrpromo: number; grupo_preco: number | null;
  aliquota: string; icms: number | null; idempresa: number;
  parceiro_razao: string; margem_negativa: boolean;
}
type TipoCusto = 'CSI' | 'BRUTO' | 'REPOSICAO';
interface Totais {
  itens: number; margemNegativa: number; custoTotal: number;
  mediaMargem: number; lucroCB: number; lucroRep: number; lucroCSI: number;
}
interface Resultado { tipoCusto: TipoCusto; mostrarEtiquetas: boolean; linhas: Item[]; totais: Totais }

/** o `rgPreco` do legado — e cada opção troca a fórmula da margem, não só o que se vê. */
const CUSTOS: Array<{ v: TipoCusto; rotulo: string; ajuda: string }> = [
  { v: 'CSI', rotulo: 'Custo sem imposto', ajuda: 'a coluna vira MARGEM LÍQUIDA %: desconta ICMS e PIS/COFINS de saída, despesa operacional, IR e CSLL' },
  { v: 'BRUTO', rotulo: 'Custo bruto', ajuda: 'markup % sobre o custo que veio na nota' },
  { v: 'REPOSICAO', rotulo: 'Custo de reposição', ajuda: 'markup % sobre o custo de reposição (nota + encargos − bonificação)' },
];

/**
 * PRECIFICAÇÃO DE NF (`FRMPRECIFICACAONF`). Dossiê: `uPrecificacaoNF.md`.
 *
 * Onde o preço nasce quando a mercadoria chega. A tela lista os itens da nota com o custo que veio nela, o
 * preço que está valendo e o sugerido — e o operador ajusta e aplica.
 *
 * ⚠️ **aplicar não muda o preço**: enfileira um lote, que depois é processado (e vira etiqueta e carga de
 * PDV). É essa separação que deixa conferir antes de a loja mudar de preço, e a tela diz isso em voz alta.
 *
 * Editar o **preço** recalcula o markup e vice-versa — é como o operador trabalha: ora ele sabe a margem que
 * quer, ora sabe o preço de prateleira.
 */
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown, d = 4) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** markup PERCENTUAL sobre o custo — `CalcularMargem`, modo custo bruto (`uDMPrecificacaoNF:377`). */
const pctDe = (venda: number, custo: number) => (custo > 0 ? r2(((venda - custo) * 100) / custo) : 0);
const hoje = () => new Date().toISOString().slice(0, 10);
const dias = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export function PrecificacaoNfPage() {
  const mensagem = useMensagem();
  const navigate = useNavigate();
  /**
   * Os atalhos abrem a outra tela com o item no endereço. O legado abre modal por cima; aqui é rota, e o
   * navegador guarda o caminho de volta — que é o que o operador faz de qualquer forma.
   */
  const navegar = (destino: string) => navigate(destino);
  const [f, setF] = useState({
    nronf: '', descricao: '', fornecedor: '', grupo: '',
    dataIni: dias(-30), dataFim: hoje(),
    incluirTransferencias: false, incluirBonificacao: false, somenteMargemNegativa: false,
    tipoCusto: '' as '' | TipoCusto,
  });
  const [res, setRes] = useState<Resultado | null>(null);
  /** o que o operador digitou, por item: preço e markup andam juntos. */
  const [edit, setEdit] = useState<Record<number, { vrvenda: number; markup: number }>>({});
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v !== '' && v !== false) q.set(k, String(v)); });
      const r = await fetch(`${BASE}/precificacao/nf?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      const j = (await r.json()) as Resultado;
      setRes(j); setSel(new Set());
      // parte de onde o sistema sugeriu; se não houver sugestão, do preço que está valendo
      setEdit(Object.fromEntries(j.linhas.map((l) => {
        const v = Number(l.vrvendasug) > 0 ? Number(l.vrvendasug) : Number(l.vrvenda);
        const c = j.tipoCusto === 'REPOSICAO' ? Number(l.custo_rep)
          : j.tipoCusto === 'CSI' ? Number(l.custo_csi) : Number(l.vrcusto);
        return [l.codnfprod, { vrvenda: v, markup: pctDe(v, c) }];
      })));
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  /**
   * Preço e markup são a mesma informação vista de dois lados — mexer num recalcula o outro, e é assim que
   * o operador trabalha: ora sabe a margem que quer, ora sabe o preço de prateleira.
   *
   * ⚠️ **o markup EDITÁVEL é PERCENTUAL**, e não a razão que a coluna `MARKUP` mostra ao abrir. É uma
   * incoerência do próprio legado, copiada de propósito: a consulta traz `MARKUP = VRVENDA / custo` (razão,
   * `uPrecificacaoNF.pas:941`), mas assim que o operador digita, `CalcularMargem` (`uDMPrecificacaoNF:377`)
   * sobrescreve o mesmo campo com `((preço − custo) × 100) / custo` — percentual. Prova no dado: dos 2.952
   * lotes que esta tela gerou em produção, 1.182 estão em faixa de razão e 1.358 em faixa de percentual.
   * Por isso a grade mostra as duas, rotuladas, em vez de esconder a diferença numa coluna só.
   */
  /** o custo contra o qual a margem é medida muda com o `rgPreco` (`CalcularMargem`/`CalcularVenda`). */
  const custoDoModo = (l: Item) =>
    res?.tipoCusto === 'REPOSICAO' ? l.custo_rep : res?.tipoCusto === 'CSI' ? l.custo_csi : l.vrcusto;

  const mudarPreco = (l: Item, txt: string) => {
    const v = Number(txt.replace(',', '.')) || 0;
    setEdit((e) => ({ ...e, [l.codnfprod]: { vrvenda: v, markup: pctDe(v, custoDoModo(l)) } }));
  };
  const mudarMarkup = (l: Item, txt: string) => {
    const m = Number(txt.replace(',', '.')) || 0;
    const c = custoDoModo(l);
    // CalcularVenda: venda = custo + custo × markup%/100
    setEdit((e) => ({ ...e, [l.codnfprod]: { vrvenda: r2(c + (c * m) / 100), markup: m } }));
  };

  const aplicar = async () => {
    if (!res || sel.size === 0) { mensagem.erro('Selecione ao menos um item.'); return; }
    const itens = res.linhas.filter((l) => sel.has(l.codnfprod)).map((l) => ({
      idproduto: l.idproduto, vrvenda: edit[l.codnfprod]?.vrvenda ?? l.vrvenda,
      markup: edit[l.codnfprod]?.markup ?? null, nronf: l.nronf,
    }));
    const abaixo = itens.filter((i, k) => i.vrvenda < Number(res.linhas.filter((l) => sel.has(l.codnfprod))[k].vrcusto));
    if (abaixo.length && !window.confirm(`${abaixo.length} item(ns) ficariam com preço ABAIXO do custo. Confirma mesmo assim?`)) return;
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/precificacao/nf/aplicar`, {
        method: 'POST', headers: apiHeaders(), body: JSON.stringify({ itens, obs: 'Precificação de NF' }),
      });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      const j = await r.json();
      mensagem.sucesso(`${j.lotes} preço(s) enviados para o lote. O preço na loja só muda quando o lote for processado.`);
      setSel(new Set());
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  /** o alvo dos atalhos é a linha marcada; com várias marcadas, a primeira. */
  const atalhoItem = useMemo(
    () => (res && sel.size > 0 ? res.linhas.find((l) => sel.has(l.codnfprod)) ?? null : null),
    [res, sel],
  );

  const cols = useMemo<DataTableColumnDef<Item>[]>(() => [
    {
      field: 'sel', headerName: '', type: 'text', width: 60,
      valueGetter: () => '',
      renderCell: ({ row: l }: { row: Item }) => (
        <input type="checkbox" checked={sel.has(l.codnfprod)}
          onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(l.codnfprod); else n.delete(l.codnfprod); return n; })} />
      ),
    },
    { field: 'nronf', headerName: 'NF', type: 'text', width: 90, isPrimary: true },
    { field: 'descricao', headerName: 'Produto', type: 'text' },
    { field: 'quantidade', headerName: 'Qtde', type: 'text', width: 90, valueGetter: (l) => nfmt(l.quantidade, 0) },
    { field: 'vrcusto', headerName: 'Custo un.', type: 'text', width: 110, valueGetter: (l) => moeda(l.vrcusto) },
    { field: 'ult_custo_rep', headerName: 'Últ. custo', type: 'text', width: 110, valueGetter: (l) => (l.ult_custo_rep == null ? '—' : moeda(l.ult_custo_rep)) },
    { field: 'vrvenda', headerName: 'Venda atual', type: 'text', width: 115, valueGetter: (l) => moeda(l.vrvenda) },
    { field: 'vrvendasug', headerName: 'Sugerido', type: 'text', width: 110, valueGetter: (l) => moeda(l.vrvendasug) },
    { field: 'ultcusto', headerName: 'Últ. custo NF', type: 'text', width: 115, valueGetter: (l) => (l.ultcusto == null ? '—' : moeda(l.ultcusto)) },
    { field: 'custo_rep', headerName: 'Custo repos.', type: 'text', width: 115, valueGetter: (l) => moeda(l.custo_rep) },
    { field: 'custo_csi', headerName: 'Custo s/ imp.', type: 'text', width: 115, valueGetter: (l) => moeda(l.custo_csi) },
    {
      field: 'novo', headerName: 'Novo preço', type: 'text', width: 130, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Item }) => (
        <input className="w-24 rounded border border-border px-1 text-right tabular-nums"
          value={String(edit[l.codnfprod]?.vrvenda ?? '')} onChange={(e) => mudarPreco(l, e.target.value)} />
      ),
    },
    {
      field: 'mk',
      headerName: res?.tipoCusto === 'CSI' ? 'Margem líq. %' : 'Markup %',
      type: 'text', width: 140, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Item }) => (
        <input className="w-20 rounded border border-border px-1 text-right tabular-nums"
          value={String(edit[l.codnfprod]?.markup ?? '')} onChange={(e) => mudarMarkup(l, e.target.value)} />
      ),
    },
    { field: 'markdown', headerName: 'Markdown', type: 'text', width: 100, valueGetter: (l) => `${nfmt(l.markdown, 2)}%` },
    { field: 'markupfixo', headerName: 'Markup fixo', type: 'text', width: 105, valueGetter: (l) => nfmt(l.markupfixo, 2) },
    { field: 'pmz', headerName: 'PMZ', type: 'text', width: 100, valueGetter: (l) => moeda(l.pmz) },
    { field: 'vrpromo', headerName: 'Promoção', type: 'text', width: 105, valueGetter: (l) => (Number(l.vrpromo) > 0 ? moeda(l.vrpromo) : '—') },
    { field: 'aliquota', headerName: 'Alíq.', type: 'text', width: 70 },
    { field: 'icms', headerName: 'ICMS %', type: 'text', width: 90, valueGetter: (l) => (l.icms == null ? '—' : `${nfmt(l.icms, 2)}%`) },
    { field: 'codprodnota', headerName: 'Cód. na nota', type: 'text', width: 130 },
    { field: 'codbarra', headerName: 'Cód. barras', type: 'text', width: 130 },
    { field: 'grupo_preco', headerName: 'Grupo preço', type: 'text', width: 110, valueGetter: (l) => (l.grupo_preco ?? '—') },
    { field: 'parceiro_razao', headerName: 'Fornecedor', type: 'text', width: 200 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [sel, edit, res?.tipoCusto]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Precificação de NF" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-32"><Field label="&Nº NF" value={f.nronf} onChange={(e) => setF({ ...f, nronf: e.target.value })} /></div>
          <div className="w-52"><Field label="&Descrição" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
          <div className="w-52"><Field label="&Fornecedor" value={f.fornecedor} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} /></div>
          <div className="w-44"><Field label="&Grupo" value={f.grupo} onChange={(e) => setF({ ...f, grupo: e.target.value })} /></div>
          <div className="w-40"><Field label="Emissão &de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <Button label="&Buscar" disabled={ocupado} onClick={() => void buscar()} />
        </div>
        <div className="mt-form-gap flex flex-wrap items-center gap-gp-md text-body-sm">
          <label className="flex items-center gap-gp-sm">
            Preço sobre o
            <select className="rounded border border-border px-1 py-0.5"
              value={f.tipoCusto} onChange={(e) => setF({ ...f, tipoCusto: e.target.value as '' | TipoCusto })}>
              <option value="">(o configurado na empresa)</option>
              {CUSTOS.map((c) => <option key={c.v} value={c.v}>{c.rotulo}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-gp-sm">
            <input type="checkbox" checked={f.incluirTransferencias} onChange={(e) => setF({ ...f, incluirTransferencias: e.target.checked })} />
            Incluir transferências <span className="text-fg-muted">(mercadoria de outra loja)</span>
          </label>
          <label className="flex items-center gap-gp-sm">
            <input type="checkbox" checked={f.incluirBonificacao} onChange={(e) => setF({ ...f, incluirBonificacao: e.target.checked })} />
            Incluir bonificação
          </label>
          <label className="flex items-center gap-gp-sm">
            <input type="checkbox" checked={f.somenteMargemNegativa} onChange={(e) => setF({ ...f, somenteMargemNegativa: e.target.checked })} />
            Só os de margem negativa
          </label>
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Produtos listados</div><div className="text-body-lg tabular-nums">{res.totais.itens}</div></div>
              <div><div className="text-body-sm text-fg-muted">Margem média</div><div className="text-body-lg tabular-nums">{nfmt(res.totais.mediaMargem, 2)}%</div></div>
              {/*
                O legado mostra UM "Lucro Bruto" que troca de campo conforme o rgPreco (btnVisualizar:420) —
                mesmo rótulo, três contas. Mostramos o do modo em destaque e os outros dois ao lado, para
                ninguém comparar número de custo bruto com número de custo sem imposto sem perceber.
              */}
              <div>
                <div className="text-body-sm text-fg-muted">
                  Lucro bruto <span className="text-fg-subtle">({CUSTOS.find((c) => c.v === res.tipoCusto)?.rotulo})</span>
                </div>
                <div className="text-body-lg tabular-nums">
                  {moeda(res.tipoCusto === 'CSI' ? res.totais.lucroCSI : res.tipoCusto === 'REPOSICAO' ? res.totais.lucroRep : res.totais.lucroCB)}
                </div>
              </div>
              <div className="text-body-sm text-fg-muted">
                <div>bruto {moeda(res.totais.lucroCB)}</div>
                <div>reposição {moeda(res.totais.lucroRep)}</div>
                <div>s/ imposto {moeda(res.totais.lucroCSI)}</div>
              </div>
              <div><div className="text-body-sm text-fg-muted">Margem negativa</div><div className="text-body-lg tabular-nums">{res.totais.margemNegativa}</div></div>
              <div><div className="text-body-sm text-fg-muted">Selecionados</div><div className="text-body-lg tabular-nums">{sel.size}</div></div>
              <Button label="Selecionar &todos" variant="soft" onClick={() => setSel(new Set(res.linhas.map((l) => l.codnfprod)))} />
              <Button label="&Aplicar valores" disabled={ocupado || sel.size === 0} onClick={() => void aplicar()} />
              {res.mostrarEtiquetas && (
                <Button label="&Etiquetas" variant="soft" disabled={sel.size === 0}
                  onClick={() => navegar('/estoque/etiquetas')} />
              )}
            </div>
            <p className="mt-form-gap text-body-sm text-fg-muted">
              Aplicar <strong>não muda o preço na loja</strong>: envia para um lote de preço, que depois é
              processado — e é aí que a etiqueta e a carga do PDV saem. Dá para conferir antes.
            </p>
          </section>
          <DataTable rows={res.linhas} columns={cols} getRowId={(l: Item) => String(l.codnfprod)} />

          {/*
            O PAINEL DE ATALHOS (pnlBotoesAtalho). É o que faz desta tela um hub: o operador precifica sem
            sair dela — abre o cadastro, confere a nota, olha o financeiro. As teclas são as do legado.
          */}
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="mb-form-gap text-body-sm text-fg-muted">
              Atalhos do item selecionado {atalhoItem ? `— ${atalhoItem.descricao}` : '(escolha uma linha)'}
            </div>
            <div className="flex flex-wrap gap-gp-sm">
              <Button label="Cadastro do produto [F2]" variant="soft" disabled={!atalhoItem}
                onClick={() => navegar(`/cadastro/produtos?id=${atalhoItem?.idproduto ?? ''}`)} />
              <Button label="Precificação por custo [F4]" variant="soft" disabled={!atalhoItem}
                onClick={() => navegar(`/estoque/precificacao?idproduto=${atalhoItem?.idproduto ?? ''}`)} />
              <Button label="Nota fiscal [F5]" variant="soft" disabled={!atalhoItem}
                onClick={() => navegar(`/fiscal/notas/entrada?codnf=${atalhoItem?.codnf ?? ''}`)} />
              <Button label="Financeiro da nota [F6]" variant="soft" disabled={!atalhoItem}
                onClick={() => navegar(`/cadastro/apagar?codnf=${atalhoItem?.codnf ?? ''}`)} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
