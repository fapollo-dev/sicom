import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * ANÁLISE DE COMPORTAMENTO POR PERÍODO (`FRMRELANALISECOMPORTAMENTOPERIODO`).
 * Dossiê: `uRelAnaliseComportamentoPeriodo.md`.
 *
 * Três períodos com nome próprio ("Natal 2025"), seis métricas cada, e a diferença da referência para os
 * dois comparados. A variação é sobre a **base** comparada — o legado dividia pela referência.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR');
const pct = (v: unknown) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`);

interface Periodo {
  rotulo: string; ini: string; fim: string;
  faturamento: number; faturamentoVenda: number; faturamentoNf: number;
  cmv: number; lucro: number; rentabilidade: number; tickets: number; ticketMedio: number;
}
interface Par { referencia: number; comparado: number; diferenca: number; variacao: number | null }
type Comparacao = { rotulo: string } & Record<string, Par | string>;
interface Resultado { periodos: Periodo[]; comparacoes: Comparacao[]; criterio: Record<string, unknown> }

/** as seis linhas do original, com o formato de cada uma. */
const LINHAS: Array<{ k: keyof Periodo; rotulo: string; fmt: (v: unknown) => string }> = [
  { k: 'faturamento', rotulo: 'Faturamento', fmt: moeda },
  { k: 'cmv', rotulo: 'CMV', fmt: moeda },
  { k: 'lucro', rotulo: 'Lucro', fmt: moeda },
  { k: 'rentabilidade', rotulo: 'Rentabilidade', fmt: pct },
  { k: 'tickets', rotulo: 'Quantidade de tickets', fmt: inteiro },
  { k: 'ticketMedio', rotulo: 'Valor ticket médio', fmt: moeda },
];
const METRICAS = ['Faturamento', 'CMV', 'Lucro', 'Rentabilidade', 'Quantidade de tickets', 'Valor ticket médio'] as const;

const hoje = () => new Date().toISOString().slice(0, 10);
const anoPassado = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
const inicioDoMes = () => `${hoje().slice(0, 8)}01`;

export function AnaliseComportamentoPeriodoPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    refNome: '', refIni: inicioDoMes(), refFim: hoje(),
    c1Nome: '', c1Ini: anoPassado(inicioDoMes()), c1Fim: anoPassado(hoje()),
    c2Nome: '', c2Ini: '', c2Fim: '',
    coddpto: '', codgrupo: '', codsubgrupo: '', codsecao: '', idproduto: '',
    custoReposicao: false,
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try {
      const n = (v: string) => (v.trim() === '' ? undefined : Number(v));
      const corpo = {
        referencia: { nome: f.refNome || undefined, ini: f.refIni, fim: f.refFim },
        comparado1: { nome: f.c1Nome || undefined, ini: f.c1Ini, fim: f.c1Fim },
        comparado2: f.c2Ini && f.c2Fim ? { nome: f.c2Nome || undefined, ini: f.c2Ini, fim: f.c2Fim } : undefined,
        custoReposicao: f.custoReposicao,
        idproduto: n(f.idproduto), codsecao: n(f.codsecao), coddpto: n(f.coddpto),
        codgrupo: n(f.codgrupo), codsubgrupo: n(f.codsubgrupo),
      };
      const r = await fetch(`${BASE}/relatorios/analise-comportamento-periodo`, {
        method: 'POST', headers: { ...apiHeaders(), 'content-type': 'application/json' }, body: JSON.stringify(corpo),
      });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const fmtDe = (m: string) => LINHAS.find((l) => l.rotulo === m)?.fmt ?? moeda;

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Análise de comportamento por período" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Compare até três períodos. Dê um nome a cada um (&quot;Natal 2025&quot;) para ler o quadro mais rápido;
          sem nome, o intervalo vira o rótulo. A variação é sobre o período <strong>comparado</strong>.
        </p>
        <div className="flex flex-col gap-gp-sm">
          {([
            ['Referência', 'refNome', 'refIni', 'refFim'],
            ['Comparado 1', 'c1Nome', 'c1Ini', 'c1Fim'],
            ['Comparado 2 (opcional)', 'c2Nome', 'c2Ini', 'c2Fim'],
          ] as const).map(([rotulo, kn, ki, kf]) => (
            <div key={rotulo} className="flex flex-wrap items-end gap-gp-sm">
              <div className="w-44"><Field label={rotulo} value={f[kn]} placeholder="nome do período" onChange={(e) => setF({ ...f, [kn]: e.target.value })} /></div>
              <div className="w-40"><Field label="&De" type="date" value={f[ki]} onChange={(e) => setF({ ...f, [ki]: e.target.value })} /></div>
              <div className="w-40"><Field label="&Até" type="date" value={f[kf]} onChange={(e) => setF({ ...f, [kf]: e.target.value })} /></div>
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-28"><Field label="&Produto" value={f.idproduto} onChange={(e) => setF({ ...f, idproduto: e.target.value })} /></div>
            <div className="w-28"><Field label="&Seção" value={f.codsecao} onChange={(e) => setF({ ...f, codsecao: e.target.value })} /></div>
            <div className="w-28"><Field label="&Depto" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
            <div className="w-28"><Field label="&Grupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
            <div className="w-28"><Field label="S&ubgrupo" value={f.codsubgrupo} onChange={(e) => setF({ ...f, codsubgrupo: e.target.value })} /></div>
            <label className="flex items-center gap-gp-xs text-body-sm">
              <input type="checkbox" checked={f.custoReposicao} onChange={(e) => setF({ ...f, custoReposicao: e.target.checked })} />
              Custo de reposição
            </label>
            <Button label="&Consultar" disabled={ocupado} onClick={() => void buscar()} />
          </div>
        </div>
      </section>

      {res && (
        <>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full min-w-[640px] border-collapse text-body-sm">
              <thead>
                <tr className="border-b border-border text-left text-fg-muted">
                  <th className="p-pad-xs">Métrica</th>
                  {res.periodos.map((p) => (
                    <th key={p.rotulo} className="p-pad-xs text-right">{p.rotulo}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LINHAS.map((l) => (
                  <tr key={l.k} className="border-b border-border">
                    <td className="p-pad-xs text-fg-muted">{l.rotulo}</td>
                    {res.periodos.map((p) => (
                      <td key={p.rotulo} className={`p-pad-xs text-right tabular-nums ${l.k === 'lucro' && Number(p[l.k]) < 0 ? 'font-semibold text-fg-danger' : ''}`}>
                        {l.fmt(p[l.k])}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-b border-border">
                  <td className="p-pad-xs text-fg-muted">— dos quais, venda no caixa</td>
                  {res.periodos.map((p) => (
                    <td key={p.rotulo} className="p-pad-xs text-right tabular-nums text-fg-muted">{moeda(p.faturamentoVenda)}</td>
                  ))}
                </tr>
                <tr>
                  <td className="p-pad-xs text-fg-muted">— dos quais, nota fiscal</td>
                  {res.periodos.map((p) => (
                    <td key={p.rotulo} className="p-pad-xs text-right tabular-nums text-fg-muted">{moeda(p.faturamentoNf)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {res.comparacoes.map((c) => (
            <div key={c.rotulo} className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
              <h3 className="p-pad-xs text-body-sm font-semibold">{String(c.rotulo)}</h3>
              <table className="w-full min-w-[560px] border-collapse text-body-sm">
                <thead>
                  <tr className="border-b border-border text-left text-fg-muted">
                    <th className="p-pad-xs">Métrica</th>
                    <th className="p-pad-xs text-right">Diferença</th>
                    <th className="p-pad-xs text-right">Variação</th>
                  </tr>
                </thead>
                <tbody>
                  {METRICAS.map((m) => {
                    const par = c[m] as Par | undefined;
                    if (!par) return null;
                    const sobe = par.diferenca > 0;
                    return (
                      <tr key={m} className="border-b border-border">
                        <td className="p-pad-xs text-fg-muted">{m}</td>
                        <td className={`p-pad-xs text-right tabular-nums ${sobe ? 'text-fg-success' : par.diferenca < 0 ? 'text-fg-danger' : ''}`}>
                          {fmtDe(m)(par.diferenca)}
                        </td>
                        <td className={`p-pad-xs text-right tabular-nums ${sobe ? 'text-fg-success' : par.diferenca < 0 ? 'text-fg-danger' : ''}`}>
                          {pct(par.variacao)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
