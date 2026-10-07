import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DataTable, type GridFetchParams } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';
import { ShortcutScope, useShortcut } from '../keyboard';
import { apiHeaders, handle401 } from '../auth/session';
import { useMensagem } from '../mensagem';
import { hojeNaLoja } from '../tempo';

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
  colunas: Array<{ campo: string; titulo: string; tipo: TipoCampo }>;
  operacoes: Record<TipoCampo, Operacao[]>;
  abertura: { campo: string; operacao: Operacao; valor: string | null; ordenacao: string | null; ordemDesc: boolean };
  opcoes: Array<{ id: string; rotulo: string; padrao?: boolean }>;
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
}
interface Detalhe { titulo: string; linhas: Array<Record<string, unknown>>; indisponivel: string | null; cabecalho: string }
interface Consulta { campo: string; operacao: Operacao; valor: string; valor2: string; opcao?: string; n: number }

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
  /** o filtro obrigatório do lookup (FRN='S', CLASSE='A'…): igualdades coluna = valor, validadas no servidor */
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
}

/**
 * PESQUISA (frmPesquisa, uPesquisa.pas) — dossiê docs/04-screen-dossier/dossiers/retaguarda/uPesquisa.md, corte A.
 * O operador escolhe &Campos (todas as colunas da view, em ordem alfabética) + O&peração (pelo tipo do campo) + o valor e aperta
 * Enter: a consulta vai ao SERVIDOR (`/cadastro/pesquisa`), com a situação do cadastro, os filtros obrigatórios da tela e sem o teto
 * de 200 linhas — a grade pagina sobre o total. Abre vazia, como o legado. Enter/duplo clique/&OK devolvem o registro; o clique
 * simples só posiciona. Telas com opções antes da Pesquisa (A pagar, A receber) mostram as opções primeiro.
 */
export function Pesquisa({ resourcePath, colunas: colunasDaTela, onSelecionar, onFechar, filtroExtra, fixos, parametros, situacaoInicial }: Props) {
  const mensagem = useMensagem();
  const situacao = situacaoInicial ?? 'ativos';
  const [meta, setMeta] = useState<Meta | null>(null);
  const [opcao, setOpcao] = useState<string | null>(null);
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
  const linhas = useRef<Record<string, any>[]>([]);
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

  useEffect(() => {
    pedir<Meta>(`/cadastro/pesquisa/meta?recurso=${encodeURIComponent(resourcePath)}`)
      .then((m) => {
        setMeta(m);
        const tipo = m.colunas.find((c) => c.campo === m.abertura.campo)?.tipo ?? 'texto';
        setCampo(m.abertura.campo);
        setOperacao(m.abertura.operacao);
        setValor(m.abertura.valor ?? (tipo === 'data' ? hojeNaLoja() : ''));
        setValor2(tipo === 'data' ? hojeNaLoja() : '');
        setColunaSoma(m.totalizador?.[0] ?? null);
        const padrao = m.opcoes.find((o) => o.padrao)?.id ?? m.opcoes[0]?.id ?? null;
        setOpcao(padrao);
        setOpcaoEscolhida(!m.opcoes.length);
        // o status da tela (RecuperarStatus): o campo, a operação e o valor que o operador guardou com Ctrl+Shift+S — reabre sem pesquisar
        if (!resourcePath.startsWith('lookup/')) {
          pedir<{ campo: string; operacao: Operacao; valor: string; valor2: string } | null>(`/cadastro/pesquisa/status?recurso=${encodeURIComponent(resourcePath)}`)
            .then((st) => {
              if (!st || !m.colunas.some((c) => c.campo === st.campo)) return;
              setCampo(st.campo);
              setOperacao(st.operacao);
              setValor(st.valor);
              setValor2(st.valor2);
            })
            .catch(() => undefined);
        }
      })
      .catch((e) => { mensagem.erro(e); onFechar(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourcePath]);

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
  const pesquisar = () => {
    if (!meta || !campo) return;
    atual.current = null;
    setConsulta((c) => ({ campo, operacao, valor, valor2, opcao: opcao ?? undefined, n: (c?.n ?? 0) + 1 }));
    focarGrade();
  };

  const fetchData = useCallback(async ({ pagination, sort }: GridFetchParams) => {
    if (!consulta) { linhas.current = []; return { data: [], total: 0 }; }
    const qs = new URLSearchParams({
      recurso: resourcePath, campo: consulta.campo, operacao: consulta.operacao, valor: consulta.valor, valor2: consulta.valor2,
      // a página do DataTable do DS começa em 1; a do servidor, em 0
      situacao, pagina: String(Math.max(0, pagination.page - 1)), porPagina: String(pagination.pageSize),
    });
    if (consulta.opcao) qs.set('opcao', consulta.opcao);
    if (colunaSoma) qs.set('soma', colunaSoma);
    ordemAtual.current = sort[0] ?? null;
    if (sort[0]) { qs.set('ordenacao', sort[0].field); qs.set('ordemDesc', String(sort[0].direction === 'desc')); }
    try {
      const r = await pedir<{ linhas: Record<string, any>[]; total: number; soma?: number }>(`/cadastro/pesquisa?${qs.toString()}${extrasQs}`);
      linhas.current = r.linhas;
      setTotal(r.total);
      setSoma(r.soma ?? null);
      return { data: r.linhas, total: r.total };
    } catch (e) {
      mensagem.erro(e);
      linhas.current = [];
      setTotal(null);
      return { data: [], total: 0 };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta, resourcePath, situacao, extrasQs, colunaSoma]);

  // os códigos do resultado inteiro, na ordem em que a grade está — pedidos só quando o cadastro navegar (←/→/↑/↓)
  const fonteDaNavegacao = (c: Consulta) => {
    const qs = new URLSearchParams({ recurso: resourcePath, campo: c.campo, operacao: c.operacao, valor: c.valor, valor2: c.valor2, situacao, soCodigos: 'true' });
    if (c.opcao) qs.set('opcao', c.opcao);
    const o = ordemAtual.current;
    if (o) { qs.set('ordenacao', o.field); qs.set('ordemDesc', String(o.direction === 'desc')); }
    const url = `/cadastro/pesquisa?${qs.toString()}${extrasQs}`;
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

  const confirmar = (row?: Record<string, any> | null) => {
    const r = row ?? atual.current ?? linhas.current[0];
    if (r) onSelecionar(r, consulta ? fonteDaNavegacao(consulta) : undefined);
  };

  const colunas: ColunaPesquisa[] = useMemo(
    () => colunasDaTela ?? (meta?.colunas ?? []).map((c) => ({ campo: c.campo, label: c.titulo, tipo: c.tipo === 'numero' ? 'number' : c.tipo === 'data' ? 'date' : 'text' })),
    [colunasDaTela, meta],
  );
  const retorno = meta?.retorno ?? colunas[0]?.campo ?? 'id';
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
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    pesquisar();
  };

  const rodape = [
    total == null ? null : `${total.toLocaleString('pt-BR')} registro${total === 1 ? '' : 's'}`,
    meta?.situacao ? `Ativo: ${SIT_LABEL[situacao]} (F6 no cadastro)` : null,
    meta?.obrigatorio,
  ].filter(Boolean).join(' · ');

  return (
    <ShortcutScope>
      <TeclasDaPesquisa
        statusTela={!resourcePath.startsWith('lookup/') && !!meta && opcaoEscolhida ? {
          // Ctrl+Shift+S / Ctrl+Shift+D (uMaster.pas FormKeyDown → fStatusTela.Salvar/Excluir): sem mensagem, como no legado
          salvar: () => void fetch(`${BASE}/cadastro/pesquisa/status?recurso=${encodeURIComponent(resourcePath)}`, {
            method: 'PUT', headers: apiHeaders({ 'content-type': 'application/json' }), body: JSON.stringify({ campo, operacao, valor, valor2, soma: colunaSoma }),
          }).then((res) => { handle401(res); }).catch(() => undefined),
          apagar: () => void fetch(`${BASE}/cadastro/pesquisa/status?recurso=${encodeURIComponent(resourcePath)}`, {
            method: 'DELETE', headers: apiHeaders(),
          }).then((res) => { handle401(res); }).catch(() => undefined),
        } : null}
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
        primaryAction={opcaoEscolhida ? { label: '&OK', onClick: () => confirmar() } : { label: '&OK', onClick: () => setOpcaoEscolhida(true) }}
        secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
      >
        {meta && !opcaoEscolhida && (
          <div role="radiogroup" aria-label="Opções da pesquisa" className="flex flex-col gap-gp-xs"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setOpcaoEscolhida(true); } }}>
            {meta.opcoes.map((o) => (
              <label key={o.id} className="flex items-center gap-gp-xs text-body-sm">
                <input type="radio" name="opcao-pesquisa" checked={opcao === o.id} onChange={() => setOpcao(o.id)} autoFocus={opcao === o.id} />
                {o.rotulo}
              </label>
            ))}
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
              onDoubleClick={() => confirmar()}
            >
              <DataTable
                fetchData={fetchData}
                columns={columns as any}
                getRowId={(r: any) => r[retorno] ?? r[colunas[0]?.campo ?? 'id']}
                toolbar={{ enableSearch: false, enableFilters: false }}
                paginationConfig={{ enabled: true, initialPageSize: 100 }}
                cardBreakpoint={false}
                // a cor da 1ª regra que casa (calculada no servidor — `_cor`)
                getRowClassName={({ row }: { row: any }) => CLASSE_DA_COR[row._cor] ?? ''}
                // o clique só posiciona (o legado confirma com Enter, duplo clique ou OK); o Enter na linha focada confirma
                onRowClick={(row: any) => {
                  if (clique.current) { clique.current = false; atual.current = row; return; }
                  confirmar(row);
                }}
              />
            </div>
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
function TeclasDaPesquisa({ focarValor, detalhes, abrirDetalhe, statusTela }: {
  focarValor: () => void; detalhes: string[]; abrirDetalhe: (tecla: string) => Promise<false | void>;
  statusTela: { salvar: () => void; apagar: () => void } | null;
}) {
  useShortcut('f3', () => focarValor());
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
