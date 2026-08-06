import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
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
const pc = (n: unknown) => (n == null ? '—' : `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}%`);
const q3 = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

interface Linha {
  idproduto: number; codbarra?: string; descricao?: string; unidade?: string; departamento?: string;
  qtde: number; total_venda: number; total_custo: number; lucro: number; desc_acre: number;
  perc: number | null; perc_acumulado: number | null; abc: string | null; abc_herdado: boolean;
}
interface Totais { linhas: number; qtde: number; total_venda: number; total_custo: number; lucro: number; total_geral: number; faixas: Record<string, { linhas: number; valor: number }> }
interface Filtro { truncado?: boolean; max_linhas?: number; sem_curva_configurada?: boolean; cortes?: { a: number; b: number; c: number } | null }

const COR: Record<string, string> = { A: 'text-accent', B: 'text-fg-default', C: 'text-fg-muted' };

/**
 * CURVA ABC DE PRODUTOS VENDIDOS (rel 09 do hub de Vendas) — ordena os produtos pelo que faturaram e classifica
 * pela participação ACUMULADA contra os cortes cadastrados na empresa.
 */
export function RelCurvaAbcPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(hoje());
  const [dtfim, setDtfim] = useState(hoje());
  const [produto, setProduto] = useState('');
  const [exibirFilhos, setExibirFilhos] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [filtro, setFiltro] = useState<Filtro | null>(null);
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ linhas: Linha[]; totais: Totais; filtro: Filtro }>('/relatorios/curva-abc/consultar', {
        dtini, dtfim, produto: produto || undefined, exibirFilhos,
      });
      setLinhas(r.linhas); setTotais(r.totais); setFiltro(r.filtro);
      if (!r.linhas.length) mensagem.sucesso('Nenhuma venda no período informado.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Curva ABC de produtos vendidos" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <div className="w-60"><Field label="&Produto" value={produto} onChange={(e) => setProduto(e.target.value)} placeholder="parte da descrição" /></div>
        <label className="flex items-center gap-gp-xs pb-pad-xs text-body-sm">
          <input type="checkbox" checked={exibirFilhos} onChange={(e) => setExibirFilhos(e.target.checked)} />
          Exibir produtos &filhos
        </label>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        {filtro?.cortes && (
          <small className="w-full text-fg-muted">
            Cortes da empresa: <b>A até {filtro.cortes.a}%</b> · <b>B até {filtro.cortes.a + filtro.cortes.b}%</b> ·
            <b> C até {filtro.cortes.a + filtro.cortes.b + filtro.cortes.c}%</b> do faturamento acumulado
            (os campos B e C são larguras de faixa, somam-se ao anterior).
          </small>
        )}
      </div>

      {filtro?.sem_curva_configurada && (
        <div className="rounded-radius-md border border-warning bg-bg-surface p-pad-sm text-body-sm">
          Esta empresa não tem os cortes da curva ABC cadastrados — sem eles todo o catálogo cai na faixa A.
          Cadastre os percentuais A/B/C na empresa antes de usar esta classificação.
        </div>
      )}
      {filtro?.truncado && (
        <div className="rounded-radius-md border border-warning bg-bg-surface p-pad-sm text-body-sm">
          Exibindo as {filtro.max_linhas} maiores linhas. Os percentuais continuam corretos (calculados sobre o
          faturamento inteiro), mas os totais abaixo cobrem só o que está na tela.
        </div>
      )}

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {['A', 'B', 'C'].map((f) => (
            <div key={f} className="flex-1 min-w-36 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">Faixa {f} — {totais.faixas[f]?.linhas ?? 0} produtos</div>
              <div className={`text-title-sm font-bold tabular-nums ${COR[f]}`}>{brl(totais.faixas[f]?.valor ?? 0)}</div>
            </div>
          ))}
          <div className="flex-1 min-w-36 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
            <div className="text-body-xs text-fg-muted">Faturamento do período</div>
            <div className="text-title-sm font-bold tabular-nums">{brl(totais.total_geral)}</div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs">ABC</th><th className="p-pad-xs">Produto</th>
              <th className="p-pad-xs text-right">Qtde</th><th className="p-pad-xs text-right">Vr. venda</th>
              <th className="p-pad-xs text-right">Vr. custo</th><th className="p-pad-xs text-right">Lucro</th>
              <th className="p-pad-xs text-right">%</th><th className="p-pad-xs text-right">Acum. %</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.idproduto} className="border-t border-border">
                {/* «herdado» = caiu na faixa que a cadeia if/else do legado não cobre e ficou com a letra de cima */}
                <td className={`p-pad-xs font-bold ${COR[l.abc ?? ''] ?? 'text-fg-muted'}`} title={l.abc_herdado ? 'Faixa não coberta pelos cortes: herdou a letra da linha anterior' : undefined}>
                  {l.abc ?? '—'}{l.abc_herdado ? '*' : ''}
                </td>
                <td className="p-pad-xs">{l.descricao}<br /><span className="text-fg-muted">{l.codbarra} · {l.unidade} · {l.departamento ?? '—'}</span></td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{q3(l.qtde)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(l.total_venda)}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.total_custo)}</td>
                <td className={`p-pad-xs text-right tabular-nums ${l.lucro < 0 ? 'text-danger' : ''}`}>{brl(l.lucro)}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{pc(l.perc)}</td>
                <td className="p-pad-xs text-right tabular-nums">{pc(l.perc_acumulado)}</td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={8} className="p-pad-md text-fg-muted">Informe o período e consulte.</td></tr>}
          </tbody>
        </table>
      </div>
      {linhas.some((l) => l.abc_herdado) && (
        <small className="text-fg-muted">
          * A soma dos cortes A+B+C não chega a 100%: essas linhas caem numa faixa que a regra do legado não
          classifica e ficam com a letra da linha anterior. É o comportamento original, reproduzido de propósito.
        </small>
      )}
    </div>
  );
}
