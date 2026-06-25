import { useEffect, useMemo, useRef, useState } from 'react';
import { createResourceApi } from './resourceApi';
import { Button } from '../ui/Button';
import { ShortcutScope } from '../keyboard';

export interface ColunaPesquisa {
  campo: string;
  label: string;
}

const OPERADORES = [
  { v: 'contem', label: 'Contém' },
  { v: 'comeca', label: 'Começa com' },
  { v: 'igual', label: 'Igual' },
  { v: 'diferente', label: 'Diferente' },
  { v: 'maior', label: 'Maior' },
  { v: 'menor', label: 'Menor' },
];

// rdgAtivo do form-base: F6 cicla nesta ordem
type Situacao = 'ativos' | 'inativos' | 'todos';
const SITUACOES: Situacao[] = ['ativos', 'inativos', 'todos'];
const SITUACAO_LABEL: Record<Situacao, string> = {
  ativos: 'Ativos',
  inativos: 'Inativos',
  todos: 'Todos',
};

interface Props {
  resourcePath: string;
  colunas: ColunaPesquisa[];
  onSelecionar: (row: Record<string, any>) => void;
  onFechar: () => void;
}

/**
 * Pesquisa — núcleo fiel do frmPesquisa: grid sobre a view GET_*, filtro
 * campo+operador+valor, ordenação por coluna, e seleção por Enter/duplo-clique.
 * Teclado: ↑/↓ navega, Enter seleciona, Esc fecha (memória muscular do operador).
 */
export function Pesquisa({ resourcePath, colunas, onSelecionar, onFechar }: Props) {
  const api = useMemo(() => createResourceApi(resourcePath), [resourcePath]);
  const [campo, setCampo] = useState(colunas[0]?.campo ?? '');
  const [operador, setOperador] = useState('contem');
  const [valor, setValor] = useState('');
  const [orderBy, setOrderBy] = useState<string | undefined>(undefined);
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>('asc');
  const [situacao, setSituacao] = useState<Situacao>('ativos');
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [sel, setSel] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const buscar = async () => {
    const r = await api.listar({ campo, operador, valor, orderBy, orderDir, situacao });
    setRows(r);
    setSel(0);
  };

  useEffect(() => {
    void buscar();
    boxRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderBy, orderDir, situacao]);

  const ciclaSituacao = () => setSituacao((s) => SITUACOES[(SITUACOES.indexOf(s) + 1) % SITUACOES.length]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'F6') {
      e.preventDefault();
      ciclaSituacao();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[sel]) onSelecionar(rows[sel]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onFechar();
    }
  };

  const sort = (c: string) => {
    if (orderBy === c) setOrderDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setOrderBy(c);
      setOrderDir('asc');
    }
  };

  return (
    <ShortcutScope>
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
      }}
      onClick={onFechar}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-label="Pesquisa"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 8, padding: 16, width: 720, maxHeight: '80vh', outline: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>Pesquisar</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* rdgAtivo do form-base — F6 cicla */}
            <div role="radiogroup" aria-label="Situação [F6]" style={{ display: 'flex', gap: 2 }}>
              {SITUACOES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={situacao === s}
                  onClick={() => setSituacao(s)}
                  style={{
                    padding: '4px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                    border: '1px solid #bbb',
                    background: situacao === s ? '#cfe3f5' : '#fff',
                    fontWeight: situacao === s ? 600 : 400,
                  }}
                >
                  {SITUACAO_LABEL[s]}
                </button>
              ))}
            </div>
            <button onClick={onFechar} aria-label="Fechar">✕</button>
          </div>
        </header>

        {/* filtro: campo + operador + valor */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <select value={campo} onChange={(e) => setCampo(e.target.value)} aria-label="campo">
            {colunas.map((c) => <option key={c.campo} value={c.campo}>{c.label}</option>)}
          </select>
          <select value={operador} onChange={(e) => setOperador(e.target.value)} aria-label="operador">
            {OPERADORES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <input
            aria-label="valor"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void buscar())}
            style={{ padding: '6px 8px', border: '1px solid #999', borderRadius: 4, flex: 1 }}
          />
          <Button label="&Localizar" onClick={() => void buscar()} />
        </div>

        {/* grid */}
        <div style={{ overflow: 'auto', border: '1px solid #eee', borderRadius: 4 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #ccc' }}>
                {colunas.map((c) => (
                  <th key={c.campo} onClick={() => sort(c.campo)} style={{ cursor: 'pointer', padding: 6 }}>
                    {c.label}{orderBy === c.campo ? (orderDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={i}
                  onClick={() => setSel(i)}
                  onDoubleClick={() => onSelecionar(r)}
                  style={{ background: i === sel ? '#cfe3f5' : undefined, cursor: 'pointer' }}
                >
                  {colunas.map((c) => <td key={c.campo} style={{ padding: 6 }}>{String(r[c.campo] ?? '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <small>↑/↓ navega · Enter seleciona · Esc fecha · F6 situação · clique no título ordena</small>
      </div>
    </div>
    </ShortcutScope>
  );
}
