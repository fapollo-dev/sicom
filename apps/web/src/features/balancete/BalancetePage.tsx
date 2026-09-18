import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/** BALANCETE DE VERIFICAÇÃO (`FRMRELBALANCETE`). Dossiê: `uRelBalancete.md`. */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioDoMes = () => `${hoje().slice(0, 8)}01`;
interface Linha { codiexpandido: string; descricao: string; nivel: number; sintetica: boolean; saldoAnterior: number; debito: number; credito: number; saldoAtual: number }
interface Res { linhas: Linha[]; totais: Record<string, number> }

export function BalancetePage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: inicioDoMes(), dataFim: hoje(), contaIni: '', contaFim: '', nivelMax: '5', semMovimento: false, analiticas: true, degrau: true });
  const [res, setRes] = useState<Res | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim, nivelMax: f.nivelMax, semMovimento: String(f.semMovimento), analiticas: String(f.analiticas) });
      if (f.contaIni.trim()) q.set('contaIni', f.contaIni.trim()); if (f.contaFim.trim()) q.set('contaFim', f.contaFim.trim());
      const r = await fetch(`${BASE}/contabil/balancete?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) { const b = await r.json().catch(() => ({})); const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText }; throw Object.assign(new Error(env.code), { envelope: env }); }
      setRes((await r.json()) as Res);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Balancete de verificação" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">Por conta do plano: saldo anterior, débitos e créditos do período e saldo atual. As sintéticas somam tudo abaixo do seu código — inclusive as contas sem nível cadastrado.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-40"><Field label="Conta &inicial" value={f.contaIni} onChange={(e) => setF({ ...f, contaIni: e.target.value })} /></div>
          <div className="w-40"><Field label="Conta &final" value={f.contaFim} onChange={(e) => setF({ ...f, contaFim: e.target.value })} /></div>
          <div className="w-24"><Field label="&Nível até" value={f.nivelMax} onChange={(e) => setF({ ...f, nivelMax: e.target.value })} /></div>
          <label className="flex items-center gap-gp-xs text-body-sm"><input type="checkbox" checked={f.analiticas} onChange={(e) => setF({ ...f, analiticas: e.target.checked })} />Imprime analíticas</label>
          <label className="flex items-center gap-gp-xs text-body-sm"><input type="checkbox" checked={f.semMovimento} onChange={(e) => setF({ ...f, semMovimento: e.target.checked })} />Contas sem movimento</label>
          <label className="flex items-center gap-gp-xs text-body-sm"><input type="checkbox" checked={f.degrau} onChange={(e) => setF({ ...f, degrau: e.target.checked })} />Descrições em degrau</label>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void buscar()} />
        </div>
      </section>
      {res && (
        <>
          <p className="text-body-sm text-fg-muted">{res.totais.contas} conta(s) · débitos {moeda(res.totais.debito)} · créditos {moeda(res.totais.credito)} · saldo atual {moeda(res.totais.saldoAtual)}</p>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full min-w-[900px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Conta</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs text-right">Saldo anterior</th><th className="p-pad-xs text-right">Débito</th><th className="p-pad-xs text-right">Crédito</th><th className="p-pad-xs text-right">Saldo atual</th></tr></thead>
              <tbody>{res.linhas.map((l) => (
                <tr key={l.codiexpandido} className={`border-b border-border ${l.sintetica ? 'font-semibold' : ''}`}>
                  <td className="p-pad-xs tabular-nums">{l.codiexpandido}</td>
                  <td className="p-pad-xs" style={f.degrau ? { paddingLeft: `${8 + (l.nivel - 1) * 14}px` } : undefined}>{l.descricao}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.saldoAnterior)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(l.debito)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(l.credito)}</td>
                  <td className={`p-pad-xs text-right tabular-nums ${l.saldoAtual < 0 ? 'text-fg-danger' : ''}`}>{moeda(l.saldoAtual)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
