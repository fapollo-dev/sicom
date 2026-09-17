import { useMemo, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, lucroPercentual, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * SIMULADOR DE VENDAS (`FRMSIMULADORVENDA`).
 * Dossiê: `uSimuladorVenda.md`.
 *
 * O que foi vendido no período, produto a produto — e o campo de preço simulado ao lado, para responder "se
 * eu tivesse vendido a tanto, quanto teria sobrado?". A linha e o rodapé recalculam enquanto se digita.
 *
 * ⚠️ o "Lucro %" é **markup sobre o custo** (`(venda/custo − 1) × 100`), como no legado — não margem.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown, d = 3) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: d });
const pct = (v: unknown) => `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

interface Linha {
  codproduto: number; descricao: string | null; codbarra: string | null; unidade: string | null;
  qtde: number; vrvenda: number; vrcusto: number; total_custo: number; sub_total_venda: number;
  acrescimo: number; desconto: number; total_venda: number; lucro_total: number; lucro_perc: number;
}
interface Resultado {
  linhas: Linha[];
  totais: { custo: number; subtotal: number; desconto: number; acrescimo: number; venda: number; lucro: number; lucroPerc: number };
}

export function SimuladorVendaPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: diaUm(), dataFim: hoje(), produto: '' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [simulado, setSimulado] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim });
      if (f.produto) q.set('produto', f.produto);
      const r = await fetch(`${BASE}/relatorios/simulador-venda?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado); setSimulado({});
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  /** a linha com o preço simulado: mesma conta do servidor, com a venda unitária trocada. */
  const simular = (l: Linha) => {
    const novo = simulado[l.codproduto];
    if (novo == null || novo === '') return null;
    const preco = Number(novo.replace(',', '.'));
    if (!Number.isFinite(preco)) return null;
    const sub = Math.trunc(Number(l.qtde) * preco * 100) / 100;
    const venda = Math.round((sub + Number(l.acrescimo) - Number(l.desconto) + Number.EPSILON) * 100) / 100;
    const lucro = Math.round((venda - Number(l.total_custo) + Number.EPSILON) * 100) / 100;
    return { venda, lucro, perc: lucroPercentual(venda, Number(l.total_custo)) };
  };

  const totaisSimulados = useMemo(() => {
    if (!res) return null;
    let venda = 0; let lucro = 0; let mexidos = 0;
    for (const l of res.linhas) {
      const s = simular(l);
      if (s) { venda += s.venda; lucro += s.lucro; mexidos += 1; } else { venda += Number(l.total_venda); lucro += Number(l.lucro_total); }
    }
    if (!mexidos) return null;
    venda = Math.round((venda + Number.EPSILON) * 100) / 100;
    lucro = Math.round((lucro + Number.EPSILON) * 100) / 100;
    return { venda, lucro, perc: lucroPercentual(venda, res.totais.custo), mexidos };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, simulado]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Simulador de vendas" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          O que foi vendido no período, produto a produto. Mexa no <strong>preço simulado</strong> e veja o
          que teria acontecido com o lucro. O <em>Lucro %</em> é markup sobre o custo, como no original.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-64"><Field label="&Produto (descrição ou EAN)" value={f.produto} onChange={(e) => setF({ ...f, produto: e.target.value })} /></div>
          <Button label="&Consultar" disabled={ocupado} onClick={() => void buscar()} />
          {Object.keys(simulado).length > 0 && <Button variant="outline" label="&Limpar simulação" onClick={() => setSimulado({})} />}
        </div>
      </section>

      {res && (
        <section className="flex flex-wrap gap-gp-lg rounded-radius-md border border-border bg-bg-surface p-pad-md">
          {[['Custo total', res.totais.custo], ['Subtotal', res.totais.subtotal], ['Descontos', res.totais.desconto],
            ['Acréscimos', res.totais.acrescimo], ['Venda', res.totais.venda], ['Lucro', res.totais.lucro]].map(([r, v]) => (
            <div key={String(r)}>
              <div className="text-body-sm text-fg-muted">{r}</div>
              <div className="text-title-sm tabular-nums">{moeda(v)}</div>
            </div>
          ))}
          <div>
            <div className="text-body-sm text-fg-muted">Lucro %</div>
            <div className="text-title-sm tabular-nums">{pct(res.totais.lucroPerc)}</div>
          </div>
          {totaisSimulados && (
            <div className="rounded-radius-sm border border-border bg-bg-subtle px-pad-sm py-pad-xs">
              <div className="text-body-sm text-fg-muted">Simulado ({totaisSimulados.mexidos} produto(s))</div>
              <div className="text-title-sm tabular-nums">
                {moeda(totaisSimulados.venda)} · lucro {moeda(totaisSimulados.lucro)} · {pct(totaisSimulados.perc)}
              </div>
            </div>
          )}
        </section>
      )}

      {res && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full min-w-[1000px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">EAN</th><th className="p-pad-xs">Produto</th>
                <th className="p-pad-xs">Qtde</th><th className="p-pad-xs">Custo méd.</th>
                <th className="p-pad-xs">Venda méd.</th><th className="p-pad-xs">Custo total</th>
                <th className="p-pad-xs">Venda total</th><th className="p-pad-xs">Lucro</th>
                <th className="p-pad-xs">Lucro %</th><th className="p-pad-xs">Preço simulado</th>
                <th className="p-pad-xs">Lucro simulado</th>
              </tr>
            </thead>
            <tbody>
              {res.linhas.map((l) => {
                const s = simular(l);
                return (
                  <tr key={l.codproduto} className="border-b border-border">
                    <td className="p-pad-xs font-mono">{l.codbarra}</td>
                    <td className="p-pad-xs">{l.descricao}</td>
                    <td className="p-pad-xs tabular-nums">{nfmt(l.qtde)}</td>
                    <td className="p-pad-xs tabular-nums">{moeda(l.vrcusto)}</td>
                    <td className="p-pad-xs tabular-nums">{moeda(l.vrvenda)}</td>
                    <td className="p-pad-xs tabular-nums">{moeda(l.total_custo)}</td>
                    <td className="p-pad-xs tabular-nums">{moeda(l.total_venda)}</td>
                    <td className={`p-pad-xs tabular-nums ${Number(l.lucro_total) < 0 ? 'text-fg-danger' : ''}`}>{moeda(l.lucro_total)}</td>
                    <td className="p-pad-xs tabular-nums">{pct(l.lucro_perc)}</td>
                    <td className="p-pad-xs">
                      <input className="h-8 w-24 rounded-radius-sm border border-border bg-bg-base px-pad-xs text-right"
                        placeholder={String(Number(l.vrvenda).toFixed(2))} value={simulado[l.codproduto] ?? ''}
                        onChange={(e) => setSimulado({ ...simulado, [l.codproduto]: e.target.value })} />
                    </td>
                    <td className={`p-pad-xs tabular-nums ${s ? 'font-semibold' : 'text-fg-muted'}`}>
                      {s ? `${moeda(s.lucro)} · ${pct(s.perc)}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
