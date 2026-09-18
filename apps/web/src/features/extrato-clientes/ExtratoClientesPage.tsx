import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/** EXTRATO DE CLIENTES (`FRMEXTRATOCLIENTES`). Dossiê: `uExtratoClientes.md`. */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null || v === '' ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioDoMes = () => `${hoje().slice(0, 8)}01`;
type Titulo = Record<string, unknown>;
interface Res { tipo: string; modelo: string; titulos?: Titulo[]; clientes?: Array<Record<string, unknown>>; totais: Record<string, number>; truncado: boolean }

export function ExtratoClientesPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ modelo: 'periodo', campoData: 'emissao', dataIni: inicioDoMes(), dataFim: hoje(), status: 'todos', codparceiro: '', valorMax: '', tipo: 'analitico' });
  const [res, setRes] = useState<Res | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ modelo: f.modelo, campoData: f.campoData, dataIni: f.dataIni, status: f.status, tipo: f.tipo });
      if (f.modelo === 'periodo') q.set('dataFim', f.dataFim);
      if (f.codparceiro.trim()) q.set('codparceiro', f.codparceiro.trim());
      if (f.modelo === 'saldo' && f.valorMax.trim()) q.set('valorMax', f.valorMax.trim());
      const r = await fetch(`${BASE}/cobranca/extrato-clientes?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) { const b = await r.json().catch(() => ({})); const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText }; throw Object.assign(new Error(env.code), { envelope: env }); }
      setRes((await r.json()) as Res);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const Sel = ({ label, k, opts }: { label: string; k: keyof typeof f; opts: Array<[string, string]> }) => (
    <div className="w-56"><label className="mb-1 block text-body-sm text-fg-muted">{label}</label>
      <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
  );
  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Extrato de clientes" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">Os títulos do cliente por período, por data de referência ou o saldo em aberto numa data. Títulos agrupados não aparecem (o título-pai os representa). No "saldo em", a data de pagamento é a da baixa quando o título não a tem.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <Sel label="Modelo" k="modelo" opts={[['periodo', 'Extrato por período'], ['refMenor', 'Referência a menor'], ['refMaior', 'Referência a maior'], ['saldo', 'Saldo do contas a receber em']]} />
          {f.modelo !== 'saldo' && <Sel label="Filtro de datas" k="campoData" opts={[['emissao', 'Emissão'], ['vencimento', 'Vencimento'], ['baixa', 'Baixa']]} />}
          <div className="w-40"><Field label={f.modelo === 'periodo' ? '&De' : '&Data de referência'} type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          {f.modelo === 'periodo' && <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>}
          <Sel label="Filtro" k="status" opts={[['aberto', 'Somente em aberto'], ['baixado', 'Somente baixados'], ['todos', 'Todos']]} />
          <div className="w-32"><Field label="&Cliente" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value })} /></div>
          {f.modelo === 'saldo' && <div className="w-32"><Field label="&Valor até" value={f.valorMax} onChange={(e) => setF({ ...f, valorMax: e.target.value })} /></div>}
          <Sel label="Tipo" k="tipo" opts={[['analitico', 'Analítico'], ['sintetico', 'Sintético']]} />
          <Button label="&Gerar" disabled={ocupado} onClick={() => void buscar()} />
        </div>
      </section>
      {res && (
        <>
          <p className="text-body-sm text-fg-muted">{res.totais.titulos} título(s) · valor {moeda(res.totais.valor)} · juros {moeda(res.totais.juros)} · pago {moeda(res.totais.valorPg)}{res.truncado ? ' — lista truncada' : ''}</p>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            {res.tipo === 'sintetico' ? (
              <table className="w-full min-w-[700px] border-collapse text-body-sm">
                <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Cliente</th><th className="p-pad-xs text-right">Títulos</th><th className="p-pad-xs text-right">Valor</th><th className="p-pad-xs text-right">Juros</th><th className="p-pad-xs text-right">Acre/Desc</th><th className="p-pad-xs text-right">Pago</th></tr></thead>
                <tbody>{(res.clientes ?? []).map((c) => <tr key={String(c.codparceiro)} className="border-b border-border"><td className="p-pad-xs">{String(c.razao)}</td><td className="p-pad-xs text-right tabular-nums">{String(c.titulos)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(c.valor)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(c.juros)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(c.acreDesc)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(c.valorPg)}</td></tr>)}</tbody>
              </table>
            ) : (
              <table className="w-full min-w-[1000px] border-collapse text-body-sm">
                <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Cliente</th><th className="p-pad-xs">Documento</th><th className="p-pad-xs">NF</th><th className="p-pad-xs">Emissão</th><th className="p-pad-xs">Vencimento</th><th className="p-pad-xs">Pagamento</th><th className="p-pad-xs text-right">Valor</th><th className="p-pad-xs text-right">Juros</th><th className="p-pad-xs text-right">Pago</th><th className="p-pad-xs">Situação</th><th className="p-pad-xs">Mês</th></tr></thead>
                <tbody>{(res.titulos ?? []).map((t) => <tr key={String(t.codrcb)} className="border-b border-border"><td className="p-pad-xs">{String(t.razao)}</td><td className="p-pad-xs">{String(t.duplicata)}</td><td className="p-pad-xs">{String(t.nronf ?? '')}</td><td className="p-pad-xs">{dataBr(t.dtvenda)}</td><td className="p-pad-xs">{dataBr(t.dtvenc)}</td><td className="p-pad-xs">{dataBr(t.dtpgto)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(t.valor)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(t.juros)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(t.valorPg)}</td><td className="p-pad-xs">{t.quitada === 'S' ? 'Baixado' : 'Em aberto'}</td><td className="p-pad-xs">{String(t.mes ?? '')}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
