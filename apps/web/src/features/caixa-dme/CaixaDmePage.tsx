import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * CAIXA DME (`FRMRELATORIOCAIXADME`). Dossiê: `uRelatorioCaixaDME.md`.
 * Quem movimentou mais de R$ 30 mil em espécie no período (DME, IN RFB 1.761/2017): recebimentos e
 * pagamentos em dinheiro por parceiro não funcionário. Analítico lista os lançamentos de quem passou.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioDoMes = () => `${hoje().slice(0, 8)}01`;

type Linha = { codparceiro: number; razao: string; cnpjCpf: string | null; tipo: string; total: number; lancamentos: number };
type Resultado = { tipo: 'sintetico' | 'analitico'; piso: number; empresa: { fantasia: string; cnpj: string } | null; sintetico: Linha[]; analitico: Array<Record<string, unknown>>; truncado: boolean; totais: { parceiros: number; areceber: { linhas: number; total: number }; apagar: { linhas: number; total: number }; semParceiro: { lancamentos: number; valor: number } } };

export function CaixaDmePage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: inicioDoMes(), dataFim: hoje(), tipo: 'sintetico' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/cobranca/caixa-dme?${new URLSearchParams(f)}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Caixa DME" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">Declaração de Operações Liquidadas com Moeda em Espécie: parceiros (não funcionários) cuja soma em dinheiro no período passa de R$ 30.000, separando o que recebemos (a receber) do que pagamos (a pagar). Escolha o mês da declaração.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-36">
            <label className="mb-1 block text-body-sm text-fg-muted">Tipo</label>
            <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              <option value="sintetico">Sintético</option><option value="analitico">Analítico</option>
            </select>
          </div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void buscar()} />
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-md text-body-sm">
              {res.empresa && <span>{res.empresa.fantasia} · {res.empresa.cnpj}</span>}
              <span>Parceiros acima do piso <strong className="tabular-nums">{res.totais.parceiros}</strong></span>
              <span>A receber <strong className="tabular-nums">{res.totais.areceber.linhas}</strong> ({moeda(res.totais.areceber.total)})</span>
              <span>A pagar <strong className="tabular-nums">{res.totais.apagar.linhas}</strong> ({moeda(res.totais.apagar.total)})</span>
              <span className="text-fg-muted">Dinheiro sem parceiro no período: {res.totais.semParceiro.lancamentos} lançamentos, {moeda(res.totais.semParceiro.valor)} — fora da DME por não ter quem declarar</span>
              {res.truncado && <span className="text-fg-danger">lista truncada</span>}
            </div>
          </section>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <h4 className="p-pad-xs text-body-sm font-semibold">Quem passou de {moeda(res.piso)}</h4>
            <table className="w-full min-w-[800px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Tipo</th><th className="p-pad-xs">Parceiro</th><th className="p-pad-xs">CNPJ/CPF</th><th className="p-pad-xs text-right">Lançamentos</th><th className="p-pad-xs text-right">Total</th></tr></thead>
              <tbody>{res.sintetico.map((l, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="p-pad-xs">{l.tipo === 'ARECEBER' ? 'A receber' : 'A pagar'}</td><td className="p-pad-xs">{l.codparceiro} · {l.razao}</td><td className="p-pad-xs tabular-nums">{l.cnpjCpf ?? <span className="text-fg-danger">sem documento</span>}</td>
                  <td className="p-pad-xs text-right tabular-nums">{l.lancamentos}</td><td className="p-pad-xs text-right tabular-nums font-semibold">{moeda(Math.abs(l.total))}</td>
                </tr>))}</tbody>
            </table>
          </div>
          {res.tipo === 'analitico' && (
            <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
              <h4 className="p-pad-xs text-body-sm font-semibold">Lançamentos em dinheiro de quem passou</h4>
              <table className="w-full min-w-[900px] border-collapse text-body-sm">
                <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Tipo</th><th className="p-pad-xs">Parceiro</th><th className="p-pad-xs">Data</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs text-right">Valor</th></tr></thead>
                <tbody>{res.analitico.map((m) => (
                  <tr key={String(m.codcx)} className="border-b border-border">
                    <td className="p-pad-xs">{m.tipo === 'ARECEBER' ? 'A receber' : 'A pagar'}</td><td className="p-pad-xs">{String(m.codparceiro)} · {String(m.razao)}</td><td className="p-pad-xs">{dataBr(m.data)}</td>
                    <td className="p-pad-xs text-fg-muted">{String(m.descricao ?? '')}</td><td className={`p-pad-xs text-right tabular-nums ${Number(m.valor) < 0 ? 'text-fg-danger' : ''}`}>{moeda(m.valor)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
