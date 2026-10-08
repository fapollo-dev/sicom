import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DataTable, type GridFetchParams } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';
import { ShortcutScope, useShortcut } from '../keyboard';
import { apiHeaders, getSessao, handle401 } from '../auth/session';
import { useMensagem } from '../mensagem';
import { hojeNaLoja } from '../tempo';
import { exportarGradeCsv } from '../export/exportarGradeCsv';
import { Button } from '../ui/Button';
import { imprimirRelatorio } from '../fr3/imprimirRelatorio';
import { abrirEtiquetasCom } from '../etiquetas/listaParaEtiquetas';
import { useNavigate } from 'react-router-dom';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface ColunaPesquisa {
  campo: string;
  label: string;
  /** tipo de coluna do DataTable (render+alinhamento+filtro corretos). Default 'text'. */
  tipo?: 'text' | 'number' | 'date' | 'currency' | 'status' | 'badge' | 'email' | 'phone';
  /** largura fixa (px). Sem isso, o autoFit do DataTable distribui. */
  largura?: number;
  /** override do tipo de filtro (default derivado do `tipo`). */
  filtro?: 'text' | 'number' | 'date' | 'select' | 'multiSelect' | 'boolean';
}

// o rdgAtivo do form-base ("Ati&vo [F6]" do cadastro): Sim / Não / Todos — escolhido no CADASTRO, antes do F3
export const SITUACOES = ['ativos', 'inativos', 'todos'] as const;
export type Situacao = (typeof SITUACOES)[number];
const SIT_LABEL: Record<Situacao, string> = { ativos: 'Sim', inativos: 'Não', todos: 'Todos' };

type TipoCampo = 'texto' | 'numero' | 'data';
type Operacao = 'igual' | 'diferente' | 'comeca' | 'termina' | 'qualquer' | 'contido' | 'entre' | 'maior' | 'menor';
const ROTULO_OP: Record<Operacao, string> = {
  igual: 'Igual a', diferente: 'Diferente de', comeca: 'Começado com', termina: 'Terminado com', qualquer: 'Em qualquer lugar',
  contido: 'Contido em', entre: 'Entre', maior: 'Maior que', menor: 'Menor que',
};
// as cores do legado (GetColor) nos tokens do DS — AMARELO e PRETO o legado pinta de preto: a linha fica na cor normal. O `[&_*]`
// leva a cor às células, que têm a sua própria classe de texto
const CLASSE_DA_COR: Record<string, string> = {
  VERMELHO: 'text-fg-danger [&_*]:text-fg-danger',
  AZUL: 'text-fg-brand [&_*]:text-fg-brand',
  VERDE: 'text-fg-success [&_*]:text-fg-success',
  ROXO: 'text-chart-5 [&_*]:text-chart-5',
  FUSHIA: 'text-chart-5 [&_*]:text-chart-5',
  AZUL_PETROLEO: 'text-chart-2 [&_*]:text-chart-2',
};
// o exemplo do "Contido em" por tipo (cbbOperacaoExit, uPesquisa.pas:404-418)
const EXEMPLO_CONTIDO: Record<TipoCampo, string> = { texto: 'Exemplo: APOLLO,SISTEMAS', numero: 'Exemplo: 5.1,6.9,7.8', data: 'Exemplo: 13/10/2011' };

interface Meta {
  titulo?: string;
  /** a view aberta (o `FView` do legado) — a chave das memórias da estação; no A pagar, a da opção e do complemento */
  view?: string;
  colunas: Array<{ campo: string; titulo: string; tipo: TipoCampo }>;
  operacoes: Record<TipoCampo, Operacao[]>;
  abertura: { campo: string; operacao: Operacao; valor: string | null; ordenacao: string | null; ordemDesc: boolean };
  opcoes: Array<{ id: string; rotulo: string; padrao?: boolean }>;
  /** o complemento da janela de opções (o `OpcoesCompl` do TfrmOpcoes — o "Com/Sem centro de custo" do A pagar) */
  complemento?: Array<{ id: string; rotulo: string; padrao?: boolean }>;
  situacao: boolean;
  retorno: string;
  obrigatorio: string | null;
  /** a legenda das cores (a grade à parte do legado) */
  legenda?: Array<{ cor: string; legenda: string }>;
  /** os atalhos de detalhe da linha (F8-F12 na pesquisa de produto) e o rótulo do legado */
  detalhes?: Array<{ tecla: string; titulo: string }>;
  rotuloDetalhes?: string | null;
  /** o totalizador (A pagar, A receber): as colunas numéricas que se pode somar */
  totalizador?: string[] | null;
  /** o &Etiquetas: 'produto' manda o resultado inteiro às etiquetas de preço */
  etiqueta?: 'produto' | null;
}
/** a lista das etiquetas recebe até este tanto de produtos (o schema do `de-itens`); o legado manda o resultado inteiro */
const TETO_ETIQUETAS = 5000;
/** acima disto o legado desmarca tudo e imprime o resultado inteiro (uPesquisa.pas:599-606) */
const TETO_MARCADOS_IMPRESSAO = 2000;
interface Detalhe { titulo: string; linhas: Array<Record<string, unknown>>; indisponivel: string | null; cabecalho: string }
/** um filtro da Pesquisa (campo + operação + valor) — a linha do `cdsFiltros` do F7 */
interface FiltroCampo { campo: string; operacao: Operacao; valor: string; valor2: string }
interface Consulta extends FiltroCampo { opcao?: string; complemento?: string; n: number; /** os filtros acumulados anteriores (F7) */ filtros?: FiltroCampo[] }
const mesmoFiltro = (a: FiltroCampo, b: FiltroCampo) => a.campo === b.campo && a.operacao === b.operacao && a.valor === b.valor && a.valor2 === b.valor2;

/**
 * As duas memórias LOCAIS da Pesquisa (no legado, arquivos no disco da estação — `Configuracoes_Pesquisa\<VIEW>[<operador>].XML` e
 * `…\Consultas\…`; aqui o armazenamento do navegador, por operador × VIEW ABERTA — o `FView`: a pesquisa do cadastro e a do campo de
 * lookup sobre a mesma view dividem a memória, e no A pagar cada view da opção tem a sua): o F4 (`SalvaConfig`, uPesquisa.pas:2464-2525 — campo,
 * operação, coluna do totalizador e ordenação) e a ÚLTIMA PESQUISA (gravada ao fechar com resultado — `FormClose` :1407-1429; ↑ no valor
 * a repete — UFrameGeral.pas:129-138). Sem armazenamento (janela privada), a Pesquisa funciona igual, sem elas.
 */
const chaveLocal = (tipo: 'f4' | 'ultima', view: string) => `apollo:pesquisa:${tipo}:${getSessao()?.operador?.codoperador ?? 0}:${view}`;
function lerLocal<T>(tipo: 'f4' | 'ultima', view: string): T | null {
  try { const v = localStorage.getItem(chaveLocal(tipo, view)); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function gravarLocal(tipo: 'f4' | 'ultima', view: string, valor: unknown) {
  try { localStorage.setItem(chaveLocal(tipo, view), JSON.stringify(valor)); } catch { /* sem armazenamento: segue sem a memória */ }
}
interface ConfigF4 { campo: string; operacao: Operacao; soma: string | null }
interface UltimaPesquisa { campo: string; operacao: Operacao; valor: string; valor2: string; /** os filtros acumulados (F7) dela */ filtros?: FiltroCampo[] }
/** a escolha da janela de opções na query (`&opcao=…&complemento=…`) */
const escolhaQs = (opcao?: string | null, complemento?: string | null) =>
  `${opcao ? `&opcao=${encodeURIComponent(opcao)}` : ''}${complemento ? `&complemento=${encodeURIComponent(complemento)}` : ''}`;

async function pedir<T>(caminho: string): Promise<T> {
  const r = await fetch(`${BASE}${caminho}`, { headers: apiHeaders() });
  handle401(r);
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
    throw Object.assign(new Error(env.code), { envelope: env });
  }
  return (await r.json()) as T;
}

interface Props {
  resourcePath: string;
  /** as colunas da grade (o recorte desta tela); sem elas, as colunas da view (o lookup) */
  colunas?: ColunaPesquisa[];
  /** o filtro obrigatório do lookup (FRN='S', CLASSE='ANALITICA'…): igualdades coluna = valor, validadas no servidor */
  fixos?: Record<string, string | number>;
  /** os parâmetros que a tela/lookup declara no servidor (`extras` — ex.: `lancavel`, `idsituacao_nf`) */
  parametros?: Record<string, string | number | null | undefined>;
  /** o registro escolhido e a FONTE DA NAVEGAÇÃO do cadastro: os códigos do resultado inteiro, na ordem da grade (o `cdsNavegation`) */
  onSelecionar: (row: Record<string, any>, navegacao?: () => Promise<number[]>) => void;
  onFechar: () => void;
  /** parâmetro da tela parametrizada (o tipo da NF, o papel do parceiro) — vai ao servidor, que monta o filtro obrigatório */
  filtroExtra?: { campo: string; operador?: string; valor: string };
  /** o `rdgAtivo` do cadastro na hora de abrir (F6 no cadastro) */
  situacaoInicial?: Situacao;
  /** mantido por compatibilidade: dentro da Pesquisa o F6 não é mais a situação (uPesquisa: F6 é o modo do filtro da coluna) */
  onSituacao?: (s: Situacao) => void;
  /**
   * a MULTISSELEÇÃO (`HabilitaMultiselecao`, 73 units — uPesquisa.pas:2616-2624, :1253-1361, `MarcarDesmarcarTodos` :1924-1954): a
   * coluna de seleção, Espaço marca e desce, T marca/desmarca todos, o duplo clique marca e confirma, o contador; o &OK devolve as
   * marcadas (sem nenhuma marcada, a linha posicionada) em `onSelecionarVarios`
   */
  multisselecao?: boolean;
  onSelecionarVarios?: (linhas: Record<string, any>[]) => void;
}

/**
 * PESQUISA (frmPesquisa, uPesquisa.pas) — dossiê docs/04-screen-dossier/dossiers/retaguarda/uPesquisa.md, corte A.
 * O operador escolhe &Campos (todas as colunas da view, em ordem alfabética) + O&peração (pelo tipo do campo) + o valor e aperta
 * Enter: a consulta vai ao SERVIDOR (`/cadastro/pesquisa`), com a situação do cadastro, os filtros obrigatórios da tela e sem o teto
 * de 200 linhas — a grade pagina sobre o total. Abre vazia, como o legado. Enter/duplo clique/&OK devolvem o registro; o clique
 * simples só posiciona. Telas com opções antes da Pesquisa (A pagar, A receber) mostram as opções primeiro.
 */
export function Pesquisa({ resourcePath, colunas: colunasDaTela, onSelecionar, onFechar, filtroExtra, fixos, parametros, situacaoInicial, multisselecao, onSelecionarVarios }: Props) {
  const mensagem = useMensagem();
  const situacao = situacaoInicial ?? 'ativos';
  const [meta, setMeta] = useState<Meta | null>(null);
  const [opcao, setOpcao] = useState<string | null>(null);
  const [complemento, setComplemento] = useState<string | null>(null);
  const [opcaoEscolhida, setOpcaoEscolhida] = useState(false);
  const [campo, setCampo] = useState('');
  const [operacao, setOperacao] = useState<Operacao>('igual');
  const [valor, setValor] = useState('');
  const [valor2, setValor2] = useState('');
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [colunaSoma, setColunaSoma] = useState<string | null>(null);
  const [soma, setSoma] = useState<number | null>(null);
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  // as "Configurações de impressão salvas" da view aberta (null = o operador não imprime relatórios: sem o &Imprimir)
  const [relatorios, setRelatorios] = useState<Array<{ codrelatoriodef: number; nome: string }> | null>(null);
  const [relatorioSel, setRelatorioSel] = useState<number | null>(null);
  // as linhas marcadas (multisseleção), pelo código de retorno — valem entre as páginas
  const [marcados, setMarcados] = useState<Map<string, Record<string, any>>>(new Map());
  const linhas = useRef<Record<string, any>[]>([]);
  // as linhas da página na grade (para a coluna de seleção mostrar as marcadas ao trocar de página)
  const [paginaAtual, setPaginaAtual] = useState<Record<string, any>[]>([]);
  const atual = useRef<Record<string, any> | null>(null);
  const clique = useRef(false);
  const ordemAtual = useRef<{ field: string; direction: string } | null>(null);
  const corpoRef = useRef<HTMLDivElement>(null);

  const fixosChave = JSON.stringify([fixos ?? {}, parametros ?? {}]);
  const extrasQs = useMemo(() => {
    const partes: string[] = [];
    if (filtroExtra) partes.push(`${encodeURIComponent(filtroExtra.campo)}=${encodeURIComponent(filtroExtra.valor)}`);
    for (const [k, v] of Object.entries(fixos ?? {})) partes.push(`f_${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    for (const [k, v] of Object.entries(parametros ?? {})) if (v != null && v !== '') partes.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return partes.length ? `&${partes.join('&')}` : '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroExtra, fixosChave]);

  // a Pesquisa sobre o meta da escolha: o SetDefault do chamador (a abertura), o F4 e o status da tela da view aberta
  const aplicar = (m: Meta, esc: string) => {
    setMeta(m);
    const tipo = m.colunas.find((c) => c.campo === m.abertura.campo)?.tipo ?? 'texto';
    setCampo(m.abertura.campo);
    setOperacao(m.abertura.operacao);
    setValor(m.abertura.valor ?? (tipo === 'data' ? hojeNaLoja() : ''));
    setValor2(tipo === 'data' ? hojeNaLoja() : '');
    setColunaSoma(m.totalizador?.[0] ?? null);
    // o F4 (arquivo local do legado) vem depois do SetDefault do chamador e antes do status do banco (uPesquisa.pas:1601-1648)
    const f4 = lerLocal<ConfigF4>('f4', m.view ?? resourcePath);
    if (f4 && m.colunas.some((c) => c.campo === f4.campo)) {
      const t = m.colunas.find((c) => c.campo === f4.campo)!.tipo;
      setCampo(f4.campo);
      setOperacao(m.operacoes[t].includes(f4.operacao) ? f4.operacao : m.operacoes[t][0]);
      setValor(t === 'data' ? hojeNaLoja() : '');
      setValor2(t === 'data' ? hojeNaLoja() : '');
      if (f4.soma && m.totalizador?.includes(f4.soma)) setColunaSoma(f4.soma);
    }
    // o status da tela (RecuperarStatus): o campo, a operação e o valor que o operador guardou com Ctrl+Shift+S — reabre sem pesquisar
    if (!resourcePath.startsWith('lookup/')) {
      pedir<{ campo: string; operacao: Operacao; valor: string; valor2: string } | null>(`/cadastro/pesquisa/status?recurso=${encodeURIComponent(resourcePath)}${esc}`)
        .then((st) => {
          if (!st || !m.colunas.some((c) => c.campo === st.campo)) return;
          setCampo(st.campo);
          setOperacao(st.operacao);
          setValor(st.valor);
          setValor2(st.valor2);
        })
        .catch(() => undefined);
    }
    // os relatórios salvos desta view (PercorreOrigem; ItemIndex := 0)
    pedir<Array<{ codrelatoriodef: number; nome: string }>>(`/cadastro/pesquisa/relatorios?recurso=${encodeURIComponent(resourcePath)}${esc}`)
      .then((rs) => { const lista = Array.isArray(rs) ? rs : null; setRelatorios(lista); setRelatorioSel(lista?.[0]?.codrelatoriodef ?? null); })
      .catch(() => { setRelatorios(null); setRelatorioSel(null); });
  };

  // a janela de opções (TfrmOpcoes) vem ANTES da Pesquisa: a Pesquisa só abre — com a abertura, o F4 e o status — sobre a escolha
  useEffect(() => {
    pedir<Meta>(`/cadastro/pesquisa/meta?recurso=${encodeURIComponent(resourcePath)}`)
      .then((m) => {
        if (!m.opcoes.length) { aplicar(m, ''); setOpcaoEscolhida(true); return; }
        setMeta(m);
        setOpcao(m.opcoes.find((o) => o.padrao)?.id ?? m.opcoes[0].id);
        setComplemento(m.complemento?.find((o) => o.padrao)?.id ?? m.complemento?.[0]?.id ?? null);
        setOpcaoEscolhida(false);
      })
      .catch((e) => { mensagem.erro(e); onFechar(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourcePath]);
  // o OK da janela de opções: os campos são os da view da escolha (no A pagar, GET_APAGAR, GET_APAGAR_CEN, GET_CP ou GET_CP_CEN)
  const escolherOpcao = () => {
    const esc = escolhaQs(opcao, complemento);
    pedir<Meta>(`/cadastro/pesquisa/meta?recurso=${encodeURIComponent(resourcePath)}${esc}`)
      .then((m) => { aplicar(m, esc); setOpcaoEscolhida(true); })
      .catch((e) => mensagem.erro(e));
  };

  const tipo: TipoCampo = meta?.colunas.find((c) => c.campo === campo)?.tipo ?? 'texto';

  // trocar de campo volta a operação ao 1º item ("Igual a") e o valor ao padrão do tipo (cbbCamposCloseUp, uPesquisa.pas:323-328)
  const trocarCampo = (c: string) => {
    setCampo(c);
    setOperacao('igual');
    const t = meta?.colunas.find((x) => x.campo === c)?.tipo ?? 'texto';
    setValor(t === 'data' ? hojeNaLoja() : '');
    setValor2(t === 'data' ? hojeNaLoja() : '');
  };

  const focarGrade = () => {
    setTimeout(() => corpoRef.current?.querySelector<HTMLElement>('[role="row"][tabindex], tbody tr[tabindex]')?.focus(), 60);
  };
  // F7 — "VÁRIOS FILTROS" (FSubSelect + cdsFiltros, uPesquisa.pas:1509-1517, :2160-2235, :2527-2553): ligado, cada pesquisa junta o
  // filtro atual aos ANTERIORES (and) e entra na lista se não for repetido; desligar esvazia a lista; F5 esvazia; Alt+Del na lista tira
  // o filtro (vale na próxima pesquisa). O texto vazio não é filtro e não entra
  const [acumulando, setAcumulando] = useState(false);
  const [filtros, setFiltros] = useState<FiltroCampo[]>([]);
  const pesquisar = () => {
    if (!meta || !campo) return;
    atual.current = null;
    const filtroAtual: FiltroCampo = { campo, operacao, valor, valor2 };
    const anteriores = acumulando ? filtros.filter((f) => !mesmoFiltro(f, filtroAtual)) : [];
    setConsulta((c) => ({ ...filtroAtual, opcao: opcao ?? undefined, complemento: complemento ?? undefined, filtros: anteriores, n: (c?.n ?? 0) + 1 }));
    const vazio = tipo === 'texto' && operacao !== 'contido' && !valor.trim();
    if (acumulando && !vazio && !filtros.some((f) => mesmoFiltro(f, filtroAtual))) setFiltros([...filtros, filtroAtual]);
    focarGrade();
  };
  const alternarAcumulando = () => {
    if (acumulando) setFiltros([]);
    setAcumulando(!acumulando);
  };
  const rotuloFiltro = (f: FiltroCampo) => {
    const t = meta?.colunas.find((c) => c.campo === f.campo);
    const v = f.operacao === 'entre' ? `${f.valor} e ${f.valor2}` : f.valor;
    return `${t?.titulo ?? f.campo} ${ROTULO_OP[f.operacao].toLowerCase()}${v ? ` ${v}` : ''}`;
  };

  // a URL da consulta: o campo, a operação, o valor, a situação, a escolha da janela e os filtros da tela + o que o chamador pede
  const urlDa = (c: Consulta, extra: Record<string, string>) => {
    const qs = new URLSearchParams({ recurso: resourcePath, campo: c.campo, operacao: c.operacao, valor: c.valor, valor2: c.valor2, situacao, ...extra });
    if (c.filtros?.length) qs.set('filtros', JSON.stringify(c.filtros));
    return `/cadastro/pesquisa?${qs.toString()}${escolhaQs(c.opcao, c.complemento)}${extrasQs}`;
  };
  const ordem = (o: { field: string; direction: string } | null | undefined): Record<string, string> =>
    o ? { ordenacao: o.field, ordemDesc: String(o.direction === 'desc') } : {};

  const fetchData = useCallback(async ({ pagination, sort }: GridFetchParams) => {
    if (!consulta) { linhas.current = []; setPaginaAtual([]); return { data: [], total: 0 }; }
    ordemAtual.current = sort[0] ?? null;
    // a página do DataTable do DS começa em 1; a do servidor, em 0
    const url = urlDa(consulta, {
      pagina: String(Math.max(0, pagination.page - 1)), porPagina: String(pagination.pageSize), ...(colunaSoma ? { soma: colunaSoma } : {}), ...ordem(sort[0]),
    });
    try {
      const r = await pedir<{ linhas: Record<string, any>[]; total: number; soma?: number }>(url);
      linhas.current = r.linhas;
      setPaginaAtual(r.linhas);
      setTotal(r.total);
      setSoma(r.soma ?? null);
      return { data: r.linhas, total: r.total };
    } catch (e) {
      mensagem.erro(e);
      linhas.current = [];
      setPaginaAtual([]);
      setTotal(null);
      return { data: [], total: 0 };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta, resourcePath, situacao, extrasQs, colunaSoma]);

  // os códigos do resultado inteiro, na ordem em que a grade está — pedidos só quando o cadastro navegar (←/→/↑/↓)
  const fonteDaNavegacao = (c: Consulta) => {
    const url = urlDa(c, { soCodigos: 'true', ...ordem(ordemAtual.current) });
    return async () => (await pedir<{ codigos: Array<number | string> }>(url)).codigos.map(Number).filter(Number.isFinite);
  };
  // a linha posicionada: a que tem o foco do teclado na grade; senão a clicada; senão a 1ª
  const linhaPosicionada = (): Record<string, any> | null => {
    const corpo = corpoRef.current;
    const linhaComFoco = (document.activeElement as HTMLElement | null)?.closest('[role="row"][tabindex]');
    if (corpo && linhaComFoco && corpo.contains(linhaComFoco)) {
      const i = Array.from(corpo.querySelectorAll('[role="row"][tabindex]')).indexOf(linhaComFoco);
      if (i >= 0 && linhas.current[i]) return linhas.current[i];
    }
    return atual.current ?? linhas.current[0] ?? null;
  };
  // o atalho de detalhe (o cdsDetalhes, uPesquisa.pas:1867-1907): a consulta da linha numa janela "código - auxiliar - descrição"
  const abrirDetalhe = async (tecla: string) => {
    const l = linhaPosicionada();
    if (!l || !meta) return false;
    const codigo = l[meta.retorno];
    try {
      const d = await pedir<Omit<Detalhe, 'cabecalho'>>(`/cadastro/pesquisa/detalhe?recurso=${encodeURIComponent(resourcePath)}&tecla=${tecla}&codigo=${encodeURIComponent(String(codigo))}`);
      setDetalhe({ ...d, cabecalho: [codigo, l.codbarra, l.descricao].filter((x) => x != null && x !== '').join(' - ') });
    } catch (e) { mensagem.erro(e); }
  };

  const chaveDe = (l: Record<string, any>) => String(l[meta?.retorno ?? colunasDaTela?.[0]?.campo ?? 'id']);
  const alternarMarca = (l: Record<string, any>) => setMarcados((m) => {
    const n = new Map(m);
    const k = chaveDe(l);
    if (n.has(k)) n.delete(k); else n.set(k, l);
    return n;
  });
  // T: marca todos (o resultado inteiro, até 1.000 linhas — o legado marca o dataset carregado) ou, se há marcadas, desmarca todas
  const marcarDesmarcarTodos = async () => {
    if (marcados.size) { setMarcados(new Map()); return; }
    if (!consulta) return;
    try {
      const r = await pedir<{ linhas: Record<string, any>[]; total: number }>(urlDa(consulta, { pagina: '0', porPagina: '1000', ...ordem(ordemAtual.current) }));
      // (acima de 1.000 o contador do rodapé mostra quantos ficaram marcados contra o total)
      setMarcados(new Map(r.linhas.map((l) => [chaveDe(l), l])));
    } catch (e) { mensagem.erro(e); }
  };
  // Ctrl+A (Excel) e Ctrl+B (CSV) na grade (uPesquisa.pas:1127-1138): o resultado inteiro, com todas as colunas da view — o legado
  // exporta o dataset carregado; aqui vem do servidor em páginas de 1.000
  const exportar = async () => {
    if (!consulta || !meta) return;
    const todas: Record<string, any>[] = [];
    try {
      for (let pagina = 0; ; pagina++) {
        const r = await pedir<{ linhas: Record<string, any>[]; total: number }>(urlDa(consulta, { pagina: String(pagina), porPagina: '1000', ...ordem(ordemAtual.current) }));
        todas.push(...r.linhas);
        if (!r.linhas.length || todas.length >= r.total) break;
      }
      // o valor como o operador lê: número com vírgula decimal (o Excel em português), data dd/mm/aaaa
      const formata = (v: unknown, tipo: TipoCampo) => {
        if (v == null || v === '') return '';
        if (tipo === 'numero') { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 6, useGrouping: false }) : String(v); }
        if (tipo === 'data') { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v)); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v); }
        return String(v);
      };
      exportarGradeCsv(todas, meta.colunas.map((c) => ({ titulo: c.titulo, valor: (l: Record<string, any>) => formata(l[c.campo], c.tipo) })), `Pesquisa ${meta.titulo ?? resourcePath}`);
    } catch (e) { mensagem.erro(e); }
  };

  // &Imprimir (uPesquisa.pas:570-665): o relatório escolhido com o filtro da pesquisa + os marcados; sem resultado, o foco vai ao valor
  const imprimir = () => {
    if (relatorioSel == null) { mensagem.erro(new Error('Selecione uma configuração.')); return; }
    if (!consulta || !total) { setTimeout(() => document.querySelector<HTMLElement>('[data-pesquisa="valor"] input')?.focus(), 0); return; }
    let codigos = [...marcados.keys()];
    if (codigos.length > TETO_MARCADOS_IMPRESSAO) { setMarcados(new Map()); codigos = []; }
    const url = urlDa(consulta, {}).replace('/cadastro/pesquisa?', '/cadastro/pesquisa/imprimir?');
    // a janela abre no clique (imprimirRelatorio): nada de await antes
    imprimirRelatorio(url, { codrelatoriodef: relatorioSel, marcados: codigos }).catch((e) => mensagem.erro(e));
  };
  // &Etiquetas (uPesquisa.pas:423-568): os códigos do resultado inteiro, na ordem da grade
  const codigosDoResultado = async (): Promise<number[]> => {
    if (!consulta || !total) return [];
    const r = await pedir<{ codigos: Array<number | string> }>(urlDa(consulta, { soCodigos: 'true', ...ordem(ordemAtual.current) }));
    return r.codigos.map(Number).filter(Number.isFinite);
  };

  // a última pesquisa: gravada ao fechar a janela quando houve consulta com resultado
  const consultaRef = useRef<Consulta | null>(null);
  consultaRef.current = consulta;
  const totalRef = useRef<number | null>(null);
  totalRef.current = total;
  const viewRef = useRef(resourcePath);
  viewRef.current = meta?.view ?? resourcePath;
  useEffect(() => () => {
    const c = consultaRef.current;
    if (c && (totalRef.current ?? 0) > 0) gravarLocal('ultima', viewRef.current, { campo: c.campo, operacao: c.operacao, valor: c.valor, valor2: c.valor2, filtros: c.filtros } satisfies UltimaPesquisa);
  }, [resourcePath]);
  // ↑ no campo de valor: repete a última pesquisa desta view (recompõe campo, operação e valor e pesquisa — na escolha já feita)
  const repetirUltima = () => {
    const u = lerLocal<UltimaPesquisa>('ultima', viewRef.current);
    if (!u || !meta?.colunas.some((c) => c.campo === u.campo)) return false;
    setCampo(u.campo);
    setOperacao(u.operacao);
    setValor(u.valor);
    setValor2(u.valor2);
    // com vários filtros, o legado liga o F7 (o SendKeys('{F7}') de :2039-2083) e repete a pesquisa com todos
    const anteriores = (u.filtros ?? []).filter((f) => meta.colunas.some((c) => c.campo === f.campo));
    if (anteriores.length) { setAcumulando(true); setFiltros([...anteriores, { campo: u.campo, operacao: u.operacao, valor: u.valor, valor2: u.valor2 }]); }
    setConsulta((c) => ({ campo: u.campo, operacao: u.operacao, valor: u.valor, valor2: u.valor2, opcao: opcao ?? undefined, complemento: complemento ?? undefined, filtros: anteriores, n: (c?.n ?? 0) + 1 }));
    focarGrade();
  };
  // F4 (SalvaConfig): guarda campo, operação e a coluna do totalizador desta pesquisa
  const salvarF4 = () => { if (campo) gravarLocal('f4', viewRef.current, { campo, operacao, soma: colunaSoma } satisfies ConfigF4); };

  const confirmar = (row?: Record<string, any> | null) => {
    if (multisselecao && onSelecionarVarios) {
      const escolhidas = marcados.size ? [...marcados.values()] : [row ?? linhaPosicionada()].filter((x): x is Record<string, any> => !!x);
      if (escolhidas.length) onSelecionarVarios(escolhidas);
      return;
    }
    const r = row ?? atual.current ?? linhas.current[0];
    if (r) onSelecionar(r, consulta ? fonteDaNavegacao(consulta) : undefined);
  };

  const colunas: ColunaPesquisa[] = useMemo(
    () => colunasDaTela ?? (meta?.colunas ?? []).map((c) => ({ campo: c.campo, label: c.titulo, tipo: c.tipo === 'numero' ? 'number' : c.tipo === 'data' ? 'date' : 'text' })),
    [colunasDaTela, meta],
  );
  const retorno = meta?.retorno ?? colunas[0]?.campo ?? 'id';
  // a identidade da linha na grade: a posição no resultado (`_linha` do servidor) — o código repete quando a view do legado multiplica
  const idDaLinha = (r: Record<string, any>): string | number => r._linha ?? r[retorno] ?? r[colunas[0]?.campo ?? 'id'];
  const columns = useMemo(
    () =>
      colunas.map((c, i) => ({
        field: c.campo,
        headerName: c.label,
        type: c.tipo ?? 'text',
        width: c.largura,
        sortable: true,
        // a 2ª coluna (descrição) é o "título" no card/mobile; o código fica estreito
        isPrimary: i === 1,
      })),
    [colunas],
  );

  // Enter = Tab nos combos (o FormKeyPress do TfrmMaster); no valor, pesquisa e leva o foco à grade
  const avancarCom = (proximo: string) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || document.querySelector('[role="listbox"]')) return;
    e.preventDefault();
    e.stopPropagation();
    document.querySelector<HTMLElement>(`[data-pesquisa="${proximo}"] input, [data-pesquisa="${proximo}"] button, [data-pesquisa="${proximo}"] [role=combobox]`)?.focus();
  };
  const noValor = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp' && (e.target as HTMLElement).tagName === 'INPUT') {
      if (repetirUltima() !== false) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    pesquisar();
  };

  const rodape = [
    total == null ? null : `${total.toLocaleString('pt-BR')} registro${total === 1 ? '' : 's'}`,
    multisselecao ? `${marcados.size} registro${marcados.size === 1 ? '' : 's'} selecionado${marcados.size === 1 ? '' : 's'}` : null,
    meta?.situacao ? `Ativo: ${SIT_LABEL[situacao]} (F6 no cadastro)` : null,
    meta?.obrigatorio,
  ].filter(Boolean).join(' · ');

  return (
    <ShortcutScope>
      <TeclasDaPesquisa
        statusTela={!resourcePath.startsWith('lookup/') && !!meta && opcaoEscolhida ? {
          // Ctrl+Shift+S / Ctrl+Shift+D (uMaster.pas FormKeyDown → fStatusTela.Salvar/Excluir): sem mensagem, como no legado
          salvar: () => void fetch(`${BASE}/cadastro/pesquisa/status?recurso=${encodeURIComponent(resourcePath)}${escolhaQs(opcao, complemento)}`, {
            method: 'PUT', headers: apiHeaders({ 'content-type': 'application/json' }), body: JSON.stringify({ campo, operacao, valor, valor2, soma: colunaSoma }),
          }).then((res) => { handle401(res); }).catch(() => undefined),
          apagar: () => void fetch(`${BASE}/cadastro/pesquisa/status?recurso=${encodeURIComponent(resourcePath)}${escolhaQs(opcao, complemento)}`, {
            method: 'DELETE', headers: apiHeaders(),
          }).then((res) => { handle401(res); }).catch(() => undefined),
        } : null}
        salvarF4={meta && opcaoEscolhida ? salvarF4 : null}
        variosFiltros={meta && opcaoEscolhida ? { alternar: alternarAcumulando, limpar: () => setFiltros([]) } : null}
        detalhes={consulta && !detalhe ? (meta?.detalhes ?? []).map((d) => d.tecla) : []}
        abrirDetalhe={abrirDetalhe}
        focarValor={() => {
          setValor('');
          setTimeout(() => document.querySelector<HTMLElement>('[data-pesquisa="valor"] input')?.focus(), 0);
        }}
      />
      <Modal
        open
        onClose={onFechar}
        size="lg"
        title={meta?.titulo ? `Pesquisa ${meta.titulo}` : 'Pesquisa'}
        description={rodape || 'Escolha o campo, a operação e o valor · Enter pesquisa · Enter/duplo clique confirma · Esc fecha'}
        primaryAction={opcaoEscolhida ? { label: '&OK', onClick: () => confirmar() } : { label: '&OK', onClick: escolherOpcao }}
        secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
      >
        {meta && !opcaoEscolhida && (
          <div className="flex flex-col gap-gp-md" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); escolherOpcao(); } }}>
            <div role="radiogroup" aria-label="Opções da pesquisa" className="flex flex-col gap-gp-xs">
              {meta.opcoes.map((o) => (
                <label key={o.id} className="flex items-center gap-gp-xs text-body-sm">
                  <input type="radio" name="opcao-pesquisa" checked={opcao === o.id} onChange={() => setOpcao(o.id)} autoFocus={opcao === o.id} />
                  {o.rotulo}
                </label>
              ))}
            </div>
            {!!meta.complemento?.length && (
              // o complemento (OpcoesCompl, MultComp = False: um só) — no A pagar, com ou sem o centro de custo do rateio
              <div role="radiogroup" aria-label="Complemento" className="flex flex-wrap gap-x-gp-md gap-y-gp-xs border-t border-border-subtle pt-gp-sm">
                {meta.complemento.map((o) => (
                  <label key={o.id} className="flex items-center gap-gp-xs text-body-sm">
                    <input type="radio" name="complemento-pesquisa" checked={complemento === o.id} onChange={() => setComplemento(o.id)} />
                    {o.rotulo}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        {meta && opcaoEscolhida && (
          <div className="flex flex-col gap-gp-sm">
            <div className="flex flex-wrap items-end gap-gp-sm" data-enter="nativo">
              <div className="w-56" data-pesquisa="campo" onKeyDown={avancarCom('operacao')}>
                <SelectField label="&Campos" value={campo} onChange={trocarCampo}
                  options={meta.colunas.map((c) => ({ value: c.campo, label: c.titulo }))} />
              </div>
              <div className="w-48" data-pesquisa="operacao" onKeyDown={avancarCom('valor')}>
                <SelectField label="O&peração" value={operacao} onChange={(v) => setOperacao(v as Operacao)}
                  options={meta.operacoes[tipo].map((o) => ({ value: o, label: ROTULO_OP[o] }))} />
              </div>
              <ValorDoFrame tipo={operacao === 'contido' ? 'texto' : tipo} entre={operacao === 'entre'} valor={valor} valor2={valor2}
                setValor={setValor} setValor2={setValor2} onKeyDown={noValor} />
              {operacao === 'contido' && <small className="pb-2 text-fg-muted">{EXEMPLO_CONTIDO[tipo]}</small>}
            </div>
            <div
              ref={corpoRef}
              // marca "isto é um clique" só durante o evento: o onRowClick do mesmo clique o vê; um Enter depois, não
              onClickCapture={() => { clique.current = true; setTimeout(() => { clique.current = false; }, 0); }}
              onDoubleClick={() => {
                // na multisseleção o duplo clique marca a linha e confirma (uPesquisa.pas:959-967)
                if (multisselecao && atual.current) {
                  const k = chaveDe(atual.current);
                  const m = new Map(marcados);
                  if (!m.has(k)) m.set(k, atual.current);
                  setMarcados(m);
                  if (onSelecionarVarios) onSelecionarVarios([...m.values()]);
                  return;
                }
                confirmar();
              }}
              // Espaço marca/desmarca a linha e desce; T marca/desmarca todos (com o foco na grade)
              onKeyDownCapture={(e) => {
                const linhaEl = (e.target as HTMLElement).closest?.('[role="row"][tabindex]');
                if (!linhaEl) return;
                if (e.ctrlKey && (e.code === 'KeyA' || e.code === 'KeyB')) {
                  e.preventDefault();
                  e.stopPropagation();
                  void exportar();
                  return;
                }
                if (!multisselecao) return;
                if (e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  const l = linhaPosicionada();
                  if (l) alternarMarca(l);
                  (linhaEl.nextElementSibling as HTMLElement | null)?.focus();
                } else if (e.key === 't' || e.key === 'T') {
                  e.preventDefault();
                  e.stopPropagation();
                  void marcarDesmarcarTodos();
                }
              }}
            >
              <DataTable
                fetchData={fetchData}
                columns={columns as any}
                getRowId={idDaLinha}
                toolbar={{ enableSearch: false, enableFilters: false }}
                paginationConfig={{ enabled: true, initialPageSize: 100 }}
                cardBreakpoint={false}
                // a cor da 1ª regra que casa (calculada no servidor — `_cor`)
                getRowClassName={({ row }: { row: any }) => `${CLASSE_DA_COR[row._cor] ?? ''}${multisselecao && marcados.has(chaveDe(row)) ? ' font-semibold' : ''}`}
                // a coluna de seleção (SELECIONAR): controlada aqui para valer entre as páginas e devolver as linhas
                selectionConfig={multisselecao ? { enabled: true, enableGlobal: false } : undefined}
                // as marcas são por CÓDIGO (valem entre as páginas e voltam ao chamador); na grade, as linhas da página com código marcado
                selectionModel={multisselecao ? { type: 'include', ids: new Set(paginaAtual.filter((l) => marcados.has(chaveDe(l))).map(idDaLinha)) } : undefined}
                onSelectionModelChange={multisselecao ? (m: { type: 'include' | 'exclude'; ids: Set<string | number> }) => {
                  if (m.type !== 'include') return;
                  const ids = new Set([...m.ids].map(String));
                  setMarcados((antes) => {
                    const n = new Map(antes);
                    // só as linhas da página que mudaram de estado: marcada agora → entra o código; desmarcada → sai
                    for (const l of linhas.current) {
                      const k = chaveDe(l);
                      const agora = ids.has(String(idDaLinha(l)));
                      if (agora === antes.has(k)) continue;
                      if (agora) n.set(k, l); else n.delete(k);
                    }
                    return n;
                  });
                } : undefined}
                // o clique só posiciona (o legado confirma com Enter, duplo clique ou OK); o Enter na linha focada confirma
                onRowClick={(row: any) => {
                  if (clique.current) { clique.current = false; atual.current = row; return; }
                  confirmar(row);
                }}
              />
            </div>
            {(relatorios || meta.etiqueta) && (
              <div className="flex flex-wrap items-end gap-gp-sm">
                {relatorios && (
                  <>
                    <div className="w-72">
                      <SelectField label="Configurações de impressão salvas" value={relatorioSel != null ? String(relatorioSel) : undefined}
                        onChange={(v) => setRelatorioSel(v ? Number(v) : null)}
                        options={relatorios.map((r) => ({ value: String(r.codrelatoriodef), label: r.nome }))} />
                    </div>
                    <Button label="&Imprimir" variant="soft" onClick={imprimir} />
                  </>
                )}
                {meta.etiqueta === 'produto' && (
                  <BotaoEtiquetas codigos={codigosDoResultado} aoErrar={(e) => mensagem.erro(e)} />
                )}
              </div>
            )}
            {(meta.totalizador?.length || meta.rotuloDetalhes) ? (
              <div className="flex flex-wrap items-end gap-gp-md">
                {!!meta.totalizador?.length && (
                  <>
                    <div className="w-48">
                      <SelectField label="Total" value={colunaSoma ?? undefined} onChange={(v) => setColunaSoma(v || null)}
                        options={meta.totalizador.map((c) => ({ value: c, label: meta.colunas.find((x) => x.campo === c)?.titulo ?? c }))} />
                    </div>
                    <span className="pb-2 text-body-sm font-semibold tabular-nums" aria-label="Soma">
                      {soma == null ? '' : soma.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </>
                )}
                {meta.rotuloDetalhes && <small className="pb-2 text-fg-muted">{meta.rotuloDetalhes}</small>}
              </div>
            ) : null}
            {acumulando && (
              <div role="region" aria-label="Vários filtros" className="rounded-radius-base border border-border-subtle p-pad-sm">
                <small className="text-fg-muted"> Vários filtros ativado. (&lt;F5&gt; Limpar; &lt;Alt&gt; + &lt;Del&gt; Remover) </small>
                <ul className="mt-gp-xs flex flex-col gap-gp-2xs">
                  {filtros.map((f, i) => (
                    <li key={`${f.campo}-${f.operacao}-${f.valor}-${f.valor2}`} tabIndex={0} className="flex items-center justify-between rounded-radius-base px-pad-xs text-body-sm focus:bg-bg-subtle"
                      onKeyDown={(e) => { if (e.altKey && e.key === 'Delete') { e.preventDefault(); setFiltros(filtros.filter((_, j) => j !== i)); } }}>
                      <span>{rotuloFiltro(f)}</span>
                      <button type="button" aria-label={`Remover o filtro ${rotuloFiltro(f)}`} className="text-fg-muted" onClick={() => setFiltros(filtros.filter((_, j) => j !== i))}>✕</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!meta.legenda?.length && (
              <div role="list" aria-label="Legenda" className="flex flex-wrap gap-x-gp-md gap-y-gp-xs text-body-xs">
                {meta.legenda.map((l, i) => (
                  <span key={i} role="listitem" className={CLASSE_DA_COR[l.cor] ?? 'text-fg-default'}>■ {l.legenda}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
      {detalhe && (
        <Modal open onClose={() => setDetalhe(null)} size="lg" title={`${detalhe.titulo}: ${detalhe.cabecalho}`}
          secondaryAction={{ label: 'Fechar', onClick: () => setDetalhe(null) }}>
          {detalhe.indisponivel ? (
            <p className="text-body-sm text-fg-muted">{detalhe.indisponivel}</p>
          ) : (
            <DataTable
              rows={detalhe.linhas.map((l, i) => ({ __i: i, ...l }))}
              columns={Object.keys(detalhe.linhas[0] ?? {}).map((k) => ({ field: k, headerName: k, type: typeof detalhe.linhas[0][k] === 'number' ? 'number' : 'text', sortable: true })) as any}
              getRowId={(r: any) => r.__i}
              toolbar={{ enableSearch: false, enableFilters: false }}
              paginationConfig={{ enabled: false }}
              cardBreakpoint={false}
            />
          )}
        </Modal>
      )}
    </ShortcutScope>
  );
}

/**
 * &Etiquetas: o resultado inteiro vai às etiquetas de preço, desmarcado para imprimir e com quantidade 1 (o cdsImpressao do frmEtiqueta);
 * o preço, o custo e a promoção acumulativa o servidor das etiquetas monta (`de-itens`). Sem resultado, as etiquetas abrem vazias.
 */
function BotaoEtiquetas({ codigos, aoErrar }: { codigos: () => Promise<number[]>; aoErrar: (e: unknown) => void }) {
  const navigate = useNavigate();
  const abrir = async () => {
    try {
      const ids = await codigos();
      if (ids.length > TETO_ETIQUETAS) {
        aoErrar(new Error(`O resultado tem ${ids.length.toLocaleString('pt-BR')} produtos; as etiquetas recebem até ${TETO_ETIQUETAS.toLocaleString('pt-BR')}. Restrinja a pesquisa.`));
        return;
      }
      if (!ids.length) { navigate('/estoque/etiquetas'); return; }
      abrirEtiquetasCom({ fonte: 'cadastro', itens: ids.map((idproduto) => ({ idproduto })), marcar: false }, navigate);
    } catch (e) { aoErrar(e); }
  };
  return <Button label="&Etiquetas" variant="soft" onClick={() => void abrir()} />;
}

function ValorDoFrame({ tipo, entre, valor, valor2, setValor, setValor2, onKeyDown }: {
  tipo: TipoCampo; entre: boolean; valor: string; valor2: string;
  setValor: (v: string) => void; setValor2: (v: string) => void; onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  if (tipo === 'data') {
    return (
      <div className="flex items-end gap-gp-sm" data-pesquisa="valor" onKeyDown={onKeyDown}>
        <div className="w-44"><DateField label="Data" value={valor || undefined} onChange={(v) => setValor(v ?? '')} /></div>
        {entre && <div className="w-44"><DateField label="à" value={valor2 || undefined} onChange={(v) => setValor2(v ?? '')} /></div>}
      </div>
    );
  }
  if (tipo === 'numero') {
    return (
      <div className="flex items-end gap-gp-sm" data-pesquisa="valor" onKeyDown={onKeyDown}>
        <div className="w-40"><Field label="Valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></div>
        {entre && <div className="w-40"><Field label="à" inputMode="decimal" value={valor2} onChange={(e) => setValor2(e.target.value)} /></div>}
      </div>
    );
  }
  // o campo de texto só aceita maiúsculas (CharCase do edtTexto, UFrameGeral.dfm:56)
  return (
    <div className="w-72" data-pesquisa="valor" onKeyDown={onKeyDown}>
      <Field label="Texto" value={valor} onChange={(e) => setValor(e.target.value.toUpperCase())} autoFocus />
    </div>
  );
}

/**
 * As teclas próprias do `frmPesquisa` (uPesquisa.pas), num escopo só da Pesquisa — com ela aberta, as teclas são dela e não chegam
 * ao cadastro de baixo. F3 = SetaFocoFrame (limpa o valor e põe o foco). O F5/F7 (filtros acumulados) e o F6 (modo do filtro da
 * coluna) voltam nos cortes B/E do dossiê.
 */
function TeclasDaPesquisa({ focarValor, detalhes, abrirDetalhe, statusTela, salvarF4, variosFiltros }: {
  focarValor: () => void; detalhes: string[]; abrirDetalhe: (tecla: string) => Promise<false | void>;
  statusTela: { salvar: () => void; apagar: () => void } | null;
  salvarF4: (() => void) | null;
  variosFiltros: { alternar: () => void; limpar: () => void } | null;
}) {
  useShortcut('f3', () => focarValor());
  // F7 liga/desliga os "Vários filtros"; F5 esvazia a lista (uPesquisa.pas:1503-1517)
  useShortcut('f7', () => variosFiltros?.alternar(), { when: !!variosFiltros });
  useShortcut('f5', () => variosFiltros?.limpar(), { when: !!variosFiltros });
  // F4 = SalvaConfig (campo, operação e totalizador desta pesquisa, na estação)
  useShortcut('f4', () => salvarF4?.(), { when: !!salvarF4 });
  // o status da tela (CONFIG_STATUS_TELA): Ctrl+Shift+S guarda o campo, a operação e o valor; Ctrl+Shift+D apaga
  useShortcut('ctrl+shift+s', () => statusTela?.salvar(), { when: !!statusTela });
  useShortcut('ctrl+shift+d', () => statusTela?.apagar(), { when: !!statusTela });
  // F8-F12: os atalhos de detalhe da pesquisa (o `ATALHO` do cdsDetalhes — na de produto, preços, códigos auxiliares e estoques)
  useShortcut('f8', () => void abrirDetalhe('f8'), { when: detalhes.includes('f8') });
  useShortcut('f9', () => void abrirDetalhe('f9'), { when: detalhes.includes('f9') });
  useShortcut('f10', () => void abrirDetalhe('f10'), { when: detalhes.includes('f10') });
  useShortcut('f11', () => void abrirDetalhe('f11'), { when: detalhes.includes('f11') });
  useShortcut('f12', () => void abrirDetalhe('f12'), { when: detalhes.includes('f12') });
  return null;
}
