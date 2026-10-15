import { useEffect, useMemo, useState } from 'react';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { useNavigate } from 'react-router-dom';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { gradeLayoutService } from '../../shared/grade/savedViewsService';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { hojeNaLoja } from '../../shared/tempo';
import { useConfirmarSaida } from '../../shared/navegacao/useConfirmarSaida';
import { abrirEtiquetasCom } from '../etiqueta/etiquetaApi';
import { useShortcut } from '../../shared/keyboard';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Item {
  codnfprod: number; idproduto: number; codnf: number; nronf: string; dtemissao: string; vrcustocsi_nota?: number | null;
  descricao: string; codbarra: string; codprodnota: string; quantidade: number; fatorembal: number;
  vrcusto: number; custo_rep: number; custo_csi: number; ultcusto: number | null;
  ult_custo_rep: number | null; vrvenda: number; preco_venda: number; pmz: number; vrvendasug: number;
  markup: number; markdown: number; markupfixo: number; vrpromo: number; grupo_preco: number | null;
  aliquota: string; icms: number | null; idempresa: number;
  statusnfe: string | null; proc: string; cancelada: string; markup_autorizado: boolean;
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
  { v: 'CSI', rotulo: 'Valor custo C.S.I', ajuda: 'a coluna vira MARGEM LÍQUIDA %: desconta ICMS e PIS/COFINS de saída, despesa operacional, IR e CSLL' },
  { v: 'BRUTO', rotulo: 'Valor custo bruto', ajuda: 'markup % sobre o custo que veio na nota' },
  { v: 'REPOSICAO', rotulo: 'Valor reposição', ajuda: 'markup % sobre o custo de reposição (nota + encargos − bonificação)' },
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
const hoje = () => hojeNaLoja();
/** o `IsGridFocused` do legado: o foco está na grade (linha ou marcação), não num campo de digitar — nem no preço/markup da célula */
const gradeFocada = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  if (!el?.closest('[role="grid"]')) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return false;
  return !(el.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type));
};
// o btnVisualizarClick sem nada a listar
const SEM_REGISTROS = 'Registros não encontrados.\nObs.: Notas de transferência ou com CFOP 1910 e 2910, não serão listadas.';

export function PrecificacaoNfPage() {
  const mensagem = useMensagem();
  const navigate = useNavigate();
  /**
   * Os atalhos abrem a outra tela com o item no endereço. O legado abre modal por cima; aqui é rota, e o
   * navegador guarda o caminho de volta — que é o que o operador faz de qualquer forma.
   */
  const navegar = (destino: string) => navigate(destino);
  // o filtro do legado: o Número NF resolve o CODNF (Código NF); o período só vale com "Data NF" marcado (chkData); o "Considerar" abre
  // no custo que a empresa configurou (FormShow)
  const [f, setF] = useState({
    nronf: '', codnf: '', descricao: '', fornecedor: '', grupo: '',
    dataNf: false, dataIni: hoje(), dataFim: hoje(),
    incluirTransferencias: false, incluirBonificacao: false, somenteMargemNegativa: false,
    tipoCusto: '' as '' | TipoCusto,
  });
  const [tela, setTela] = useState<{ tipoCusto: TipoCusto; mostrarEtiquetas: boolean; markdownFixo: boolean } | null>(null);
  const [pesqNota, setPesqNota] = useState(false);
  useEffect(() => {
    fetch(`${BASE}/precificacao/nf/tela`, { headers: apiHeaders() })
      .then(async (r) => { if (r.ok) { const t = await r.json(); setTela(t); setF((x) => (x.tipoCusto ? x : { ...x, tipoCusto: t.tipoCusto })); } })
      .catch(() => undefined);
  }, []);
  // o exit do Número NF (BuscarNroNotaFiscal): sem Código NF e com número ≠ 0, o CODNF da NF de entrada da loja; o número repetido limpa
  const resolverNota = async (nronf: string): Promise<string | null> => {
    const r = await fetch(`${BASE}/precificacao/nf/nota?nronf=${encodeURIComponent(nronf.trim())}`, { headers: apiHeaders() });
    handle401(r);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
      if (env.code === 'PRECIFICACAO_NF_NUMERO_REPETIDO') setF((x) => ({ ...x, nronf: '', codnf: '' }));
      mensagem.erro(Object.assign(new Error(env.code), { envelope: env }));
      return null;
    }
    const codnf = String(((await r.json()) as { codnf: number }).codnf);
    setF((x) => ({ ...x, codnf }));
    return codnf;
  };
  const sairDoNumero = () => {
    if (!f.codnf && Number(f.nronf.replace(',', '.')) !== 0 && f.nronf.trim()) void resolverNota(f.nronf);
  };
  const [res, setRes] = useState<Resultado | null>(null);
  /** o que o operador digitou, por item: preço e markup andam juntos. */
  const [edit, setEdit] = useState<Record<number, { vrvenda: number; markup: number }>>({});
  // o `TemEdicao` do legado: digitou preço ou markup, sair pergunta ("Deseja realmente sair da tela?"); um novo Visualizar zera
  const [temEdicao, setTemEdicao] = useState(false);
  useConfirmarSaida(temEdicao);
  const [sel, setSel] = useState<Set<number>>(new Set());
  /**
   * MULTI-EMPRESA (`GetMultiEmpresa`, `:1041`): o legado aplica o mesmo preço em todas as lojas marcadas, de
   * uma vez. Em branco = só a loja da sessão, que é o caso comum.
   */
  const [empresas, setEmpresas] = useState<number[]>([]);
  const { data: empresaOptions = [] } = useResourceOptions('cadastro/empresas', (e: any) => ({
    value: String(e.idempresa ?? e.codempresa), label: `${e.idempresa ?? e.codempresa} - ${e.fantasia ?? e.razao_social ?? ''}`,
  }));
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      // GeraConsulta: com Número NF, filtra pelo CODNF dele
      let codnf = f.codnf;
      if (f.nronf.trim() && !codnf) {
        const c = await resolverNota(f.nronf);
        if (!c) return;
        codnf = c;
      }
      if (f.nronf.trim() && codnf) q.set('codnf', codnf);
      for (const k of ['descricao', 'fornecedor', 'grupo'] as const) if (f[k].trim()) q.set(k, f[k].trim());
      if (f.dataNf) { q.set('dataIni', f.dataIni); q.set('dataFim', f.dataFim); }
      if (f.incluirTransferencias) q.set('incluirTransferencias', 'true');
      if (f.incluirBonificacao) q.set('incluirBonificacao', 'true');
      if (f.somenteMargemNegativa) q.set('somenteMargemNegativa', 'true');
      if (f.tipoCusto) q.set('tipoCusto', f.tipoCusto);
      const r = await fetch(`${BASE}/precificacao/nf?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      const j = (await r.json()) as Resultado;
      setRes(j); setSel(new Set());
      if (!j.linhas.length) mensagem.erro(SEM_REGISTROS);
      // parte de onde o sistema sugeriu; se não houver sugestão, do preço que está valendo
      setTemEdicao(false);
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
    setTemEdicao(true);
    setEdit((e) => ({ ...e, [l.codnfprod]: { vrvenda: v, markup: pctDe(v, custoDoModo(l)) } }));
  };
  const mudarMarkup = (l: Item, txt: string) => {
    const m = Number(txt.replace(',', '.')) || 0;
    const c = custoDoModo(l);
    // CalcularVenda: venda = custo + custo × markup%/100
    setTemEdicao(true);
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
        method: 'POST', headers: apiHeaders(), body: JSON.stringify({ itens, empresas: empresas.length ? empresas : null }),
      });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      const j = await r.json();
      const lojas = j.empresas?.length ?? 1;
      mensagem.sucesso(
        `${j.lotes} preço(s) enviados para o lote${lojas > 1 ? ` em ${lojas} lojas` : ''}. `
        + 'O total pode ser maior que os itens marcados: produtos FILHOS entram junto. '
        + 'O preço na loja só muda quando o lote for processado.',
      );
      setSel(new Set());
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  /** o alvo dos atalhos é a linha marcada; com várias marcadas, a primeira. */
  /** IMPRIMIR (`btnImprimirClick`): a grade como está — o preço e o markup editados — no PrecificacaoNF.fr3 do cliente */
  const imprimir = async () => {
    if (!res?.linhas.length) return;
    const corrente = res.linhas.find((l) => sel.has(l.codnfprod)) ?? res.linhas[0];
    try {
      await imprimirRelatorio('/precificacao/nf/impressao', {
        dtemissao: corrente.dtemissao ?? null,
        linhas: res.linhas.map((l) => ({
          idempresa: l.idempresa, codprodnota: l.codprodnota ?? null, descricao: l.descricao,
          quantidade: l.quantidade, vrcusto: l.vrcusto, ultcusto: l.ultcusto, vrvenda: l.vrvenda, pmz: l.pmz, vrvendasug: l.vrvendasug,
          markup: edit[l.codnfprod]?.markup ?? l.markup, preco_venda: edit[l.codnfprod]?.vrvenda ?? l.preco_venda,
        })),
      });
    } catch (e) { mensagem.erro(e); }
  };

  const atalhoItem = useMemo(
    () => (res && sel.size > 0 ? res.linhas.find((l) => sel.has(l.codnfprod)) ?? null : null),
    [res, sel],
  );

  // AS TECLAS DO PAINEL DE ATALHOS (FormKeyDown do uPrecificacaoNF): o alvo é o item do painel (a linha marcada; com várias, a 1ª)
  // F2 = o cadastro do produto, com a grade aberta (`if cdsPrecificacaoNF.Active`)
  useShortcut('f2', () => { navegar(`/cadastro/produtos?id=${atalhoItem?.idproduto ?? ''}`); }, { when: !!atalhoItem });
  // F4 = a precificação por custo do produto (TfrmPrificacaoCusto)
  useShortcut('f4', () => { navegar(`/estoque/precificacao?idproduto=${atalhoItem?.idproduto ?? ''}`); }, { when: !!atalhoItem });
  // F5 = a nota fiscal do item (TfrmNF), `if CODNF > 0`
  useShortcut('f5', () => { navegar(`/fiscal/notas/entrada?codigo=${atalhoItem?.codnf ?? ''}`); }, { when: Number(atalhoItem?.codnf) > 0 });
  // F6 = o financeiro da nota (TFrmFinanceiroNotaFiscalVisualizacao), `if CODNF > 0`
  useShortcut('f6', () => { navegar(`/cadastro/apagar?codnf=${atalhoItem?.codnf ?? ''}`); }, { when: Number(atalhoItem?.codnf) > 0 });
  // T com a grade focada (`(key = 84) and IsGridFocused`): a 1ª linha marcada desmarca, senão marca todas — a linha com o preço
  // alterado (VRVENDA <> PRECO_VENDA) fica sempre marcada
  const marcarDesmarcar = (e: KeyboardEvent) => {
    if (!res?.linhas.length || !gradeFocada(e)) return false;
    const marcar = !sel.has(res.linhas[0].codnfprod);
    setSel(new Set(res.linhas
      .filter((l) => marcar || (edit[l.codnfprod]?.vrvenda ?? Number(l.vrvenda)) !== Number(l.vrvenda))
      .map((l) => l.codnfprod)));
  };
  useShortcut('t', marcarDesmarcar);
  useShortcut('shift+t', marcarDesmarcar);

  /**
   * O botão Etiquetas (`btnEtiquetasClick:296`): abre a tela de etiquetas com os marcados — PRECO_VENDA (o preço da grade,
   * ainda sem lote processado), quantidade 1 — e **desmarca** cada um, como o legado (`:341`). O legado não grava nada na
   * fila do coletor (ETIQUETA_CONS_PROD): o "fila de impressão" dele é o cdsImpressao da tela de etiquetas.
   */
  const abrirEtiquetas = () => {
    if (!res || sel.size === 0) return;
    const marcados = res.linhas.filter((l) => sel.has(l.codnfprod));
    setSel(new Set());
    abrirEtiquetasCom({ fonte: 'precificacao', itens: marcados.map((l) => ({ idproduto: l.idproduto, valor: edit[l.codnfprod]?.vrvenda ?? l.vrvenda })) }, navigate);
  };

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
    // NRONF, CODNF e EMISSAO são colunas visíveis da grade do legado
    { field: 'codnf', headerName: 'Código NF', type: 'text', width: 95 },
    { field: 'dtemissao', headerName: 'Emissão', type: 'text', width: 100, valueGetter: (l) => dataBr(l.dtemissao) },
    // as colunas da grade do legado que faltavam: a loja (LJ), o item da nota (CODNFPROD) e o CSI gravado na nota
    { field: 'idempresa', headerName: 'LJ', type: 'text', width: 50 },
    { field: 'codnfprod', headerName: 'Item NF', type: 'text', width: 90 },
    { field: 'descricao', headerName: 'Produto', type: 'text' },
    { field: 'quantidade', headerName: 'Qtde', type: 'text', width: 90, valueGetter: (l) => nfmt(l.quantidade, 0) },
    { field: 'vrcusto', headerName: 'Custo un.', type: 'text', width: 110, valueGetter: (l) => moeda(l.vrcusto) },
    { field: 'vrcustocsi_nota', headerName: 'CSI da nota', type: 'text', width: 110, valueGetter: (l) => (l.vrcustocsi_nota == null ? '—' : moeda(l.vrcustocsi_nota)) },
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
    // FormShow: TIPO_PRECIFICACAO = 'D' troca o rótulo para MARKDOWN FIXO
    { field: 'markupfixo', headerName: tela?.markdownFixo ? 'Markdown fixo' : 'Markup fixo', type: 'text', width: 105, valueGetter: (l) => nfmt(l.markupfixo, 2) },
    { field: 'pmz', headerName: 'PMZ', type: 'text', width: 100, valueGetter: (l) => moeda(l.pmz) },
    { field: 'vrpromo', headerName: 'Promoção', type: 'text', width: 105, valueGetter: (l) => (Number(l.vrpromo) > 0 ? moeda(l.vrpromo) : '—') },
    { field: 'aliquota', headerName: 'Alíq.', type: 'text', width: 70 },
    { field: 'icms', headerName: 'ICMS %', type: 'text', width: 90, valueGetter: (l) => (l.icms == null ? '—' : `${nfmt(l.icms, 2)}%`) },
    { field: 'codprodnota', headerName: 'Cód. na nota', type: 'text', width: 130 },
    { field: 'codbarra', headerName: 'Cód. barras', type: 'text', width: 130 },
    { field: 'grupo_preco', headerName: 'Grupo preço', type: 'text', width: 110, valueGetter: (l) => (l.grupo_preco ?? '—') },
    {
      // COLORAÇÃO POR REGRA (`btnAddPLCClick:206`): NF-e enviada, cancelada e nota processada. No legado é
      // uma tabela de regras (CAMPO/OPERACAO/VALOR/COR/LEGENDA) que pinta a linha; aqui a situação vira
      // coluna com a mesma legenda, que diz a mesma coisa sem esconder o motivo atrás de uma cor.
      field: 'situacao_nf', headerName: 'Situação da nota', type: 'text', width: 165, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Item }) => {
        const st = String(l.statusnfe ?? '').toUpperCase();
        if (l.cancelada === 'S' || st.includes('CANCELADA')) return <span className="text-fg-danger">NF-e cancelada</span>;
        if (l.proc === 'S') return <span className="text-fg-success">Nota processada</span>;
        if (st.includes('ENVIADA')) return <span className="text-fg-info">NF-e emitida</span>;
        return <span className="text-fg-muted">—</span>;
      },
    } as DataTableColumnDef<Item>,
    {
      field: 'markup_autorizado', headerName: 'Preço ≥ PMZ', type: 'text', width: 120, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Item }) => (
        l.markup_autorizado
          ? <span className="text-fg-success">Sim</span>
          : <span className="font-semibold text-fg-danger">Abaixo do PMZ</span>
      ),
    } as DataTableColumnDef<Item>,
    { field: 'parceiro_razao', headerName: 'Fornecedor', type: 'text', width: 200 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [sel, edit, res?.tipoCusto, tela?.markdownFixo]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Precificação de NF" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          {/* edtNroNf: digitar limpa o Código NF (edtNroNfChange); sair resolve (BuscarNroNotaFiscal); [F3]/… abre a Pesquisa das notas */}
          <div className="flex items-end gap-gp-xs">
            <div className="w-36"><Field label="&Número NF [F3]" value={f.nronf} onChange={(e) => setF({ ...f, nronf: e.target.value, codnf: '' })}
              onBlur={sairDoNumero} onKeyDown={(e) => { if (e.key === 'F3') { e.preventDefault(); setPesqNota(true); } }} /></div>
            <Button label="…" variant="soft" onClick={() => setPesqNota(true)} />
          </div>
          <div className="w-28"><Field label="Código NF" value={f.codnf} readOnly /></div>
          <div className="w-52"><Field label="&Descrição Produto" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
          <div className="w-52"><Field label="F&ornecedor" value={f.fornecedor} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} /></div>
          <div className="w-44"><Field label="&Grupo" value={f.grupo} onChange={(e) => setF({ ...f, grupo: e.target.value })} /></div>
          {/* chkData: marcar limpa a nota, põe hoje nas duas datas e libera o "Período NF"; desmarcado, sem filtro de data */}
          <label className="flex items-center gap-gp-xs pb-2 text-body-sm">
            <input type="checkbox" checked={f.dataNf}
              onChange={(e) => setF(e.target.checked ? { ...f, dataNf: true, nronf: '', codnf: '', dataIni: hoje(), dataFim: hoje() } : { ...f, dataNf: false })} /> Data NF
          </label>
          <div className="w-40"><Field label="Período NF" type="date" disabled={!f.dataNf} value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="Até" type="date" disabled={!f.dataNf} value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <Button label="&Visualizar" disabled={ocupado} onClick={() => void buscar()} />
        </div>
        <div className="mt-form-gap flex flex-wrap items-center gap-gp-md text-body-sm">
          {/* rgPreco "Considerar" */}
          <fieldset className="flex items-center gap-gp-sm rounded border border-border px-pad-sm py-1">
            <legend className="px-1 text-fg-muted">Considerar</legend>
            {CUSTOS.map((c) => (
              <label key={c.v} className="flex items-center gap-gp-xs" title={c.ajuda}>
                <input type="radio" name="precnf-considerar" checked={f.tipoCusto === c.v} onChange={() => setF({ ...f, tipoCusto: c.v })} /> {c.rotulo}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-gp-sm">
            <input type="checkbox" checked={f.incluirBonificacao} onChange={(e) => setF({ ...f, incluirBonificacao: e.target.checked })} />
            Visualizar Bonificação/Verbas
          </label>
          <label className="flex items-center gap-gp-sm">
            <input type="checkbox" checked={f.incluirTransferencias} onChange={(e) => setF({ ...f, incluirTransferencias: e.target.checked })} />
            Listar Transferências
          </label>
          <label className="flex items-center gap-gp-sm">
            <input type="checkbox" checked={f.somenteMargemNegativa} onChange={(e) => setF({ ...f, somenteMargemNegativa: e.target.checked })} />
            Só os de margem negativa
          </label>
        </div>
      </section>

      {pesqNota && (
        <Pesquisa resourcePath="precificacao/nf-notas" onFechar={() => setPesqNota(false)}
          onSelecionar={(l) => { setF((x) => ({ ...x, codnf: String(l.codigo ?? ''), nronf: String(l.nro_nf ?? '') })); setPesqNota(false); }} />
      )}
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
              <Button label="&Imprimir" variant="soft" disabled={ocupado || !res.linhas.length} onClick={() => void imprimir()} />
              <label className="flex items-center gap-gp-sm text-body-sm">
                Aplicar em
                <select multiple size={1} className="rounded border border-border px-1 py-0.5"
                  value={empresas.map(String)}
                  onChange={(e) => setEmpresas(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}>
                  {empresaOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span className="text-fg-muted">{empresas.length === 0 ? '(só esta loja)' : `${empresas.length} loja(s)`}</span>
              </label>
              {res.mostrarEtiquetas && (
                <Button label="&Etiquetas" variant="soft" disabled={ocupado || sel.size === 0}
                  onClick={abrirEtiquetas} />
              )}
            </div>
            <p className="mt-form-gap text-body-sm text-fg-muted">
              Aplicar <strong>não muda o preço na loja</strong>: envia para um lote de preço, que depois é
              processado — e é aí que a etiqueta e a carga do PDV saem. Dá para conferir antes.
            </p>
          </section>
          <DataTable persistId="precificacao-nf" savedViewsService={gradeLayoutService} rows={res.linhas} columns={cols} getRowId={(l: Item) => String(l.codnfprod)} />

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
                onClick={() => navegar(`/fiscal/notas/entrada?codigo=${atalhoItem?.codnf ?? ''}`)} />
              <Button label="Financeiro da nota [F6]" variant="soft" disabled={!atalhoItem}
                onClick={() => navegar(`/cadastro/apagar?codnf=${atalhoItem?.codnf ?? ''}`)} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
