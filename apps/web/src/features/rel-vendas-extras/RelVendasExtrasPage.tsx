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
  { value: 'ticket-produto', label: 'Produtos vendidos × cupons (rel 21)' },
  { value: 'promocao-loja', label: 'Produtos em promoção por loja (rel 22)' },
  { value: 'por-departamento', label: 'Vendas por departamento — gráfico (rel 26)' },
  { value: 'por-fornecedor', label: 'Giro por fornecedor (rel 33)' },
  { value: 'data-hora', label: 'Vendas por dia e hora (rel 39)' },
  { value: 'cliente-vendedor', label: 'Vendas por cliente e vendedor (rel 29)' },
  { value: 'abc2', label: 'Curva ABC 2 — com preço atual (rel 31)' },
  { value: 'grid', label: 'Grade gerencial por produto (rel 34)' },
  { value: 'piscofins-produto', label: 'PIS/COFINS por produto (rel 15)' },
  { value: 'piscofins-tipo', label: 'PIS/COFINS por tipo (rel 16)' },
];

const COLS: Record<string, [string, string, (v: unknown) => string, boolean?][]> = {
  'ticket-produto': [
    ['descricao', 'Produto', String], ['unidade', 'Un.', String],
    ['qtde', 'Qtde', q3, true], ['total_venda', 'Venda', brl, true], ['total_custo', 'Custo', brl, true],
    ['lucro_vr', 'Lucro', brl, true], ['perc_margem', 'Particip. custo', pcf, true], ['cupons', 'Cupons', String, true],
  ],
  'promocao-loja': [
    ['descricao', 'Produto', String], ['unidade', 'Un.', String],
    ['qtde', 'Qtde', q3, true], ['vrvenda', 'Venda', brl, true], ['vrcusto', 'Custo', brl, true],
  ],
  'por-departamento': [
    ['modalidade', 'Departamento', (v) => String(v ?? 'GRUPO NAO DEFINIDO')],
    ['total_venda', 'Venda', brl, true], ['participacao', '%', pcf, true],
  ],
  'por-fornecedor': [
    ['razao', 'Fornecedor', (v) => String(v ?? '—')], ['descricao', 'Produto', String],
    ['qtde_vnd', 'Vendida', q3, true], ['qtde_estoque', 'Estoque atual', q3, true],
  ],
  'data-hora': [
    ['dia', 'Data', dia], ['hora', 'Hora', (v) => `${v}h`],
    ['total_venda', 'Venda', brl, true], ['total_custo', 'Custo', brl, true],
    ['total_lucro', 'Lucro', brl, true], ['rentabilidade', 'Rentab.', pcf, true], ['cupons', 'Itens', String, true],
  ],
  'cliente-vendedor': [
    ['data', 'Data', dia], ['hora', 'Hora', (v) => String(v ?? '—')], ['pdv', 'PDV', String],
    ['nropedido', 'Pedido', String], ['razao', 'Cliente', (v) => String(v ?? '—')],
    ['vendedor', 'Vendedor', String], ['operacao', 'Forma', (v) => String(v ?? '—')],
    ['total_venda', 'Total', brl, true],
  ],
  'abc2': [
    ['abc', 'ABC', (v) => String(v ?? '—')], ['descricao', 'Produto', String],
    ['qtde', 'Qtde', q3, true], ['total_venda', 'Venda período', brl, true],
    ['vrvenda_atual', 'Preço atual', brl, true], ['margem_atual', 'Particip. custo atual', pcf, true],
    ['perc_acumulado', 'Acum. %', pcf, true],
  ],
  'grid': [
    ['descricao', 'Produto', String], ['nomedpto', 'Depto', (v) => String(v ?? '—')],
    ['qtde', 'Vendida', q3, true], ['total_venda', 'Venda (bruta)', brl, true],
    ['margem_bruta', 'Particip. custo', pcf, true], ['giros', 'Giro/dia', q3, true],
    ['saldo', 'Saldo', q3, true], ['valor_estoque', 'Valor estoque', brl, true],
  ],
  'piscofins-produto': [
    ['chave', 'Produto', String], ['qtde', 'Qtde', q3, true],
    ['total_venda', 'Venda', brl, true], ['total_piscofins_s', 'PIS/COFINS saída', brl, true],
    ['total_piscofins_e', 'PIS/COFINS entrada', brl, true], ['saldo_piscofins', 'Saldo', brl, true],
  ],
  'piscofins-tipo': [
    ['chave', 'Tipo PIS/COFINS', String], ['qtde', 'Qtde', q3, true],
    ['total_venda', 'Venda', brl, true], ['total_piscofins_s', 'PIS/COFINS saída', brl, true],
    ['total_piscofins_e', 'PIS/COFINS entrada', brl, true], ['saldo_piscofins', 'Saldo', brl, true],
  ],
};

/** Variantes avulsas do hub de Vendas (rel 21, 22, 26, 33 e 39) numa tela só. */
export function RelVendasExtrasPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(hoje());
  const [dtfim, setDtfim] = useState(hoje());
  const [modo, setModo] = useState('ticket-produto');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ linhas: Linha[]; totais: Record<string, unknown> }>(
        `/relatorios/vendas-extras/${modo}`, { dtini, dtfim },
      );
      setLinhas(r.linhas); setTotais(r.totais);
      if (!r.linhas.length) mensagem.sucesso('Nenhum registro no período informado.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const cols = COLS[modo];

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Vendas — relatórios complementares" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-96"><SelectField label="&Relatório" value={modo} onChange={(v) => { setModo(v); setLinhas([]); setTotais(null); }} options={MODOS} /></div>
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        {modo === 'data-hora' && (
          <small className="w-full text-fg-muted">A hora vem do número do pedido do PDV (como no original), não do relógio da venda.</small>
        )}
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {Object.entries(totais).map(([k, v]) => (
            <div key={k} className="flex-1 min-w-32 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.replace(/_/g, ' ')}</div>
              <div className="text-title-sm font-bold tabular-nums">{k.startsWith('total') || k === 'vrvenda' ? brl(v) : String(v)}</div>
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
