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

interface Linha {
  idproduto: number; codbarra?: string; descricao?: string; unidade?: string; fornecedor?: string;
  departamento?: string; estoque: number; est_minimo: number; preco?: number | null; custo?: number | null;
  ultima_entrada?: string | null; parado_com_estoque: boolean;
}
interface Totais { produtos: number; com_estoque: number; estoque_total: number }

/**
 * PRODUTOS SEM MOVIMENTO NO PERÍODO (relatório 13 do hub de Vendas) — o complemento da rel 01: mostra o que
 * NÃO girou. Os 5 modos são os do diálogo do legado.
 */
export function RelSemMovimentoPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(hoje());
  const [dtfim, setDtfim] = useState(hoje());
  const [modo, setModo] = useState('SEM_VENDA');
  const [codfor, setCodfor] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ linhas: Linha[]; totais: Totais }>('/relatorios/sem-movimento/consultar', {
        dtini, dtfim, modo, codfor: codfor ? Number(codfor) : undefined,
      });
      setLinhas(r.linhas); setTotais(r.totais);
      if (!r.linhas.length) mensagem.sucesso('Todos os produtos tiveram movimento no período.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Produtos sem movimento no período" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <div className="w-60"><SelectField label="Tipo de &busca" value={modo} onChange={setModo} options={[
          { value: 'SEM_COMPRA', label: 'Sem compra' },
          { value: 'SEM_VENDA', label: 'Sem venda' },
          { value: 'SEM_NENHUMA', label: 'Sem nenhuma movimentação' },
          { value: 'COMPROU_SEM_SAIDA', label: 'Comprou e não teve saída' },
          { value: 'VENDEU_SEM_COMPRA', label: 'Vendeu e não teve compra' },
        ]} /></div>
        <div className="w-40"><Field label="For&necedor (cód.)" value={codfor} onChange={(e) => setCodfor(e.target.value)} placeholder="todos" /></div>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        <small className="w-full text-fg-muted">
          «Sem venda» é o encalhe: produto que não saiu no período. O que está em <b>vermelho</b> tem estoque
          parado — dinheiro na prateleira sem giro.
        </small>
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {[
            { rot: 'Produtos', val: String(totais.produtos) },
            { rot: 'Com estoque parado', val: String(totais.com_estoque), dg: totais.com_estoque > 0 },
            { rot: 'Quantidade parada', val: q3(totais.estoque_total) },
          ].map((k) => (
            <div key={k.rot} className="flex-1 min-w-36 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.rot}</div>
              <div className={`text-title-sm font-bold tabular-nums ${(k as any).dg ? 'text-danger' : ''}`}>{k.val}</div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs">Produto</th><th className="p-pad-xs">Fornecedor</th>
              <th className="p-pad-xs">Departamento</th>
              <th className="p-pad-xs text-right">Estoque</th><th className="p-pad-xs text-right">Preço</th>
              <th className="p-pad-xs text-right">Últ. entrada</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.idproduto} className="border-t border-border">
                <td className="p-pad-xs">{l.descricao}<br /><span className="text-fg-muted">{l.codbarra} · {l.unidade}</span></td>
                <td className="p-pad-xs text-fg-muted">{l.fornecedor ?? '—'}</td>
                <td className="p-pad-xs text-fg-muted">{l.departamento ?? '—'}</td>
                {/* estoque parado sem giro = o caso que dói */}
                <td className={`p-pad-xs text-right tabular-nums ${l.parado_com_estoque ? 'font-semibold text-danger' : 'text-fg-muted'}`}>{q3(l.estoque)}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.preco)}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{dia(l.ultima_entrada)}</td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={6} className="p-pad-md text-fg-muted">Informe o período e consulte.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
