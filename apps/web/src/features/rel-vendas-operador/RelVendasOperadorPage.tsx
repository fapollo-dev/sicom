import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function req<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
  handle401(res);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: res.status, code: 'ERRO', message: (b as any)?.message ?? res.statusText };
    throw Object.assign(new Error(env.code ?? res.statusText), { envelope: env, status: res.status, body: b });
  }
  return (await res.json()) as T;
}

const brl = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const pcf = (n: unknown) => (n == null ? '—' : `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const q3 = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

type Linha = Record<string, unknown>;

const MODOS = [
  { value: 'data-operador', label: 'Vendas por dia e operador (rel 06)' },
  { value: 'resumo-operador', label: 'Resumo por operador (rel 19)' },
  { value: 'detalhe-vendedor', label: 'Detalhe por vendedor (rel 25)' },
  { value: 'data-vendedor', label: 'Total por vendedor (rel 36)' },
  { value: 'produtos-operador', label: 'Produtos vendidos por operador (rel 46)' },
];

/** colunas por modo: [chave, rótulo, formatador, alinhamento à direita?] */
const COLS: Record<string, [string, string, (v: unknown) => string, boolean?][]> = {
  'data-operador': [
    ['dia', 'Data', dia], ['nome', 'Operador', String],
    ['nrocupons', 'Cupons', String, true], ['total_venda', 'Total', brl, true],
  ],
  'resumo-operador': [
    ['nome', 'Operador', String], ['dias_trabalhados', 'Dias', String, true],
    ['nrocupons', 'Cupons', String, true], ['total_venda', 'Total', brl, true],
    ['media', 'Média/dia', brl, true], ['ticket_medio', 'Ticket*', brl, true],
    ['ajuste_liquido', 'Ajuste líq.', brl, true], ['totqtd', 'Qtde', q3, true],
  ],
  'detalhe-vendedor': [
    ['nomvendedor', 'Vendedor', String], ['desgrupo', 'Grupo', String],
    ['dessubgrupo', 'Subgrupo', String], ['secao', 'Seção', String],
    ['desproduto', 'Produto', String], ['unidade', 'Un.', String],
    ['qtde', 'Qtde', q3, true], ['soma_vrvenda_uni', 'Σ preço unit.', brl, true],
  ],
  'data-vendedor': [
    ['nome', 'Vendedor', (v) => (v == null ? '(sem cadastro)' : String(v))],
    ['total_venda', 'Total', brl, true],
  ],
  'produtos-operador': [
    ['nome', 'Operador', String], ['descricao', 'Produto', String],
    ['qtde', 'Qtde', q3, true], ['total_venda', 'Venda', brl, true],
    ['total_custo', 'Custo', brl, true], ['lucro', 'Lucro', brl, true],
    ['margem', 'Particip. custo', pcf, true], ['rentabilidade', 'Rentab.', pcf, true],
  ],
};

/**
 * VENDAS POR OPERADOR / VENDEDOR — cinco variantes do hub numa tela (rel 06, 19, 25, 36, 46).
 */
export function RelVendasOperadorPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(hoje());
  const [dtfim, setDtfim] = useState(hoje());
  const [modo, setModo] = useState('data-operador');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ linhas: Linha[]; totais: Record<string, unknown> }>(
        `/relatorios/vendas-operador/${modo}`, { dtini, dtfim },
      );
      setLinhas(r.linhas); setTotais(r.totais);
      if (!r.linhas.length) mensagem.sucesso('Não há venda no período informado.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const cols = COLS[modo];

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Vendas por operador e vendedor" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-72"><SelectField label="&Relatório" value={modo} onChange={(v) => { setModo(v); setLinhas([]); setTotais(null); }} options={MODOS} /></div>
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        {modo === 'resumo-operador' && (
          <small className="w-full text-fg-muted">
            * O «Ticket» reproduz a conta do relatório original, que pode dividir por mais grupos do que os
            cupons distintos — por isso ele pode diferir de Total ÷ Cupons. «Ajuste líq.» = acréscimos − descontos.
          </small>
        )}
        {modo === 'produtos-operador' && (
          <small className="w-full text-fg-muted">
            «Particip. custo» é custo ÷ venda (a fórmula desta variante no original), não a margem de lucro.
          </small>
        )}
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {Object.entries(totais).filter(([k]) => k !== 'linhas').slice(0, 5).map(([k, v]) => (
            <div key={k} className="flex-1 min-w-32 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.replace(/_/g, ' ')}</div>
              <div className="text-title-sm font-bold tabular-nums">
                {k.startsWith('total') || k === 'lucro' ? brl(v) : String(v)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              {cols.map(([k, rot, , right]) => (
                <th key={k} className={`p-pad-xs ${right ? 'text-right' : ''}`}>{rot}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i} className="border-t border-border">
                {cols.map(([k, , fmt, right]) => (
                  <td key={k} className={`p-pad-xs ${right ? 'text-right tabular-nums' : ''}`}>{fmt(l[k])}</td>
                ))}
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={cols.length} className="p-pad-md text-fg-muted">Informe o período e consulte.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
