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
}
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
  /** as colunas da grade (o recorte desta tela; a lista de CAMPOS vem da view inteira) */
  colunas: ColunaPesquisa[];
  onSelecionar: (row: Record<string, any>) => void;
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
export function Pesquisa({ resourcePath, colunas, onSelecionar, onFechar, filtroExtra, situacaoInicial }: Props) {
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
  const linhas = useRef<Record<string, any>[]>([]);
  const atual = useRef<Record<string, any> | null>(null);
  const clique = useRef(false);
  const corpoRef = useRef<HTMLDivElement>(null);

  const extrasQs = useMemo(() => (filtroExtra ? `&${encodeURIComponent(filtroExtra.campo)}=${encodeURIComponent(filtroExtra.valor)}` : ''), [filtroExtra]);

  useEffect(() => {
    pedir<Meta>(`/cadastro/pesquisa/meta?recurso=${encodeURIComponent(resourcePath)}`)
      .then((m) => {
        setMeta(m);
        const tipo = m.colunas.find((c) => c.campo === m.abertura.campo)?.tipo ?? 'texto';
        setCampo(m.abertura.campo);
        setOperacao(m.abertura.operacao);
        setValor(m.abertura.valor ?? (tipo === 'data' ? hojeNaLoja() : ''));
        setValor2(tipo === 'data' ? hojeNaLoja() : '');
        const padrao = m.opcoes.find((o) => o.padrao)?.id ?? m.opcoes[0]?.id ?? null;
        setOpcao(padrao);
        setOpcaoEscolhida(!m.opcoes.length);
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
    if (sort[0]) { qs.set('ordenacao', sort[0].field); qs.set('ordemDesc', String(sort[0].direction === 'desc')); }
    try {
      const r = await pedir<{ linhas: Record<string, any>[]; total: number }>(`/cadastro/pesquisa?${qs.toString()}${extrasQs}`);
      linhas.current = r.linhas;
      setTotal(r.total);
      return { data: r.linhas, total: r.total };
    } catch (e) {
      mensagem.erro(e);
      linhas.current = [];
      setTotal(null);
      return { data: [], total: 0 };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta, resourcePath, situacao, extrasQs]);

  const confirmar = (row?: Record<string, any> | null) => {
    const r = row ?? atual.current ?? linhas.current[0];
    if (r) onSelecionar(r);
  };

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
                // o clique só posiciona (o legado confirma com Enter, duplo clique ou OK); o Enter na linha focada confirma
                onRowClick={(row: any) => {
                  if (clique.current) { clique.current = false; atual.current = row; return; }
                  confirmar(row);
                }}
              />
            </div>
          </div>
        )}
      </Modal>
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
function TeclasDaPesquisa({ focarValor }: { focarValor: () => void }) {
  useShortcut('f3', () => focarValor());
  return null;
}
