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
const q3 = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

type Linha = Record<string, unknown>;

const MODOS = [
  { value: 'resumo', label: 'Cancelamentos — resumo por operador (rel 28)' },
  { value: 'por-operador', label: 'Cancelamentos por operador, com itens (rel 28.1)' },
  { value: 'por-data', label: 'Cancelamentos por data, com itens (rel 28.2)' },
  { value: 'por-fiscal', label: 'Cancelamentos por fiscal (rel 30)' },
  { value: 'descontos-resumo', label: 'Descontos de operador — resumo (rel 32)' },
  { value: 'descontos-itens', label: 'Descontos de operador, com itens (rel 32.1)' },
];

const COLS: Record<string, [string, string, (v: unknown) => string, boolean?][]> = {
  'resumo': [
    ['nome', 'Operador', String], ['responsavel', 'Responsável', String],
    ['historico', 'Histórico', (v) => String(v ?? '—')], ['motivo', 'Motivo', (v) => String(v ?? '—')],
    ['data', 'Última data', dia], ['nrocupons', 'Cupons', String, true], ['total_venda', 'Total', brl, true],
  ],
  'por-operador': [
    ['operadora', 'Operador', String], ['responsavel', 'Responsável', String],
    ['dtvenda', 'Data', dia], ['nrocupom', 'Cupom', String, true], ['descricao', 'Produto', String],
    ['razao', 'Vendedor', (v) => String(v ?? '—')],
    ['qtde', 'Qtde', q3, true], ['total_venda_bruto', 'Bruto', brl, true], ['total_venda_liquido', 'Líquido', brl, true],
  ],
  'por-data': [
    ['dtvenda', 'Data', dia], ['hora', 'Hora', (v) => String(v ?? '—')],
    ['operadora', 'Operador', String], ['responsavel', 'Responsável', String],
    ['nrocupom', 'Cupom', String, true], ['descricao', 'Produto', String],
    ['qtde', 'Qtde', q3, true], ['total_venda_bruto', 'Bruto', brl, true], ['total_venda_liquido', 'Líquido', brl, true],
  ],
  'por-fiscal': [
    ['responsavel', 'Fiscal responsável', String],
    ['nrocupons', 'Cupons cancelados', String, true], ['total_venda', 'Total cancelado', brl, true],
  ],
  'descontos-resumo': [
    ['responsavel', 'Responsável', String], ['operadora', 'Operador', String],
    ['ultimo_data_desconto', 'Último desconto', dia],
    ['nrocupons', 'Ocorrências', String, true], ['descprom', 'Promoção', brl, true],
    ['desc_total_opera', 'Desc. operador', brl, true], ['total_desconto_venda', 'Desconto total', brl, true],
  ],
  'descontos-itens': [
    ['responsavel', 'Responsável', String], ['operadora', 'Operador', String],
    ['dtvenda', 'Data', dia], ['nrocupom', 'Cupom', String, true], ['descricao', 'Produto', String],
    ['qtde', 'Qtde', q3, true], ['total_venda_bruto', 'Bruto', brl, true],
    ['desc_promocao', 'Desconto', brl, true], ['total_venda_liquido', 'Líquido', brl, true],
  ],
};

/**
 * CANCELAMENTOS E DESCONTOS DO PDV (rel 28/30/32 do hub de Vendas) — quem cancelou, quem autorizou e
 * quem deu desconto, cruzando as vendas com o log de eventos do PDV.
 */
export function RelCanceladosPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(hoje());
  const [dtfim, setDtfim] = useState(hoje());
  const [modo, setModo] = useState('resumo');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ linhas: Linha[]; totais: Record<string, unknown> }>(
        `/relatorios/cancelados/${modo}`, { dtini, dtfim },
      );
      setLinhas(r.linhas); setTotais(r.totais);
      if (!r.linhas.length) mensagem.sucesso('Nenhum registro no período informado.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const cols = COLS[modo];

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Cancelamentos e descontos do PDV" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-96"><SelectField label="&Relatório" value={modo} onChange={(v) => { setModo(v); setLinhas([]); setTotais(null); }} options={MODOS} /></div>
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        <small className="w-full text-fg-muted">
          O <b>responsável</b> vem do último evento registrado no PDV para o cupom; sem registro, fica o próprio
          operador do caixa.
        </small>
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {Object.entries(totais).map(([k, v]) => (
            <div key={k} className="flex-1 min-w-32 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.replace(/_/g, ' ')}</div>
              <div className="text-title-sm font-bold tabular-nums">{k.startsWith('total') ? brl(v) : String(v)}</div>
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
