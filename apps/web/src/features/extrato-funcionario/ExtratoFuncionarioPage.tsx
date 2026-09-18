import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * EXTRATO DE FUNCIONÁRIO (`FRMRELFUNCIONARIO`). Dossiê: `uRelFuncionario.md`.
 * Débitos (a receber: compras no convênio, quebras, estornos) e créditos (a pagar: adiantamentos) dos
 * funcionários de um convênio, no período. Sintético por funcionário × tipo × dia; analítico linha a linha.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioDoMes = () => `${hoje().slice(0, 8)}01`;

type Convenio = { codparceiro: number; razao: string; fantasia: string | null; funcionarios: number };
type Func = { codparceiro: number; nome: string; codoperador: number | null; operadores: number; creditos: number; debitos: number; saldo: number; linhas: number };
type Resultado = { tipo: 'sintetico' | 'analitico'; linhas: Array<Record<string, unknown>>; funcionarios: Func[]; truncado: boolean; totais: { linhas: number; funcionarios: number; creditos: number; debitos: number; saldo: number } };

export function ExtratoFuncionarioPage() {
  const mensagem = useMensagem();
  const [convenios, setConvenios] = useState<Convenio[]>([]);
  const [f, setF] = useState({ dataIni: inicioDoMes(), dataFim: hoje(), tipo: 'sintetico', codconvenio: '', codoperador: '', situacao: 'todos', filtro: 'todos' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const pedir = async <T,>(url: string): Promise<T> => {
    const r = await fetch(url, { headers: apiHeaders() });
    handle401(r);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
      throw Object.assign(new Error(env.code), { envelope: env });
    }
    return (await r.json()) as T;
  };
  useEffect(() => { pedir<Convenio[]>(`${BASE}/cobranca/extrato-funcionario/convenios`).then(setConvenios).catch((e) => mensagem.erro(e)); }, []);
  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim, tipo: f.tipo, situacao: f.situacao, filtro: f.filtro });
      if (f.codconvenio) q.set('codconvenio', f.codconvenio);
      if (f.codoperador.trim()) q.set('codoperador', f.codoperador.trim());
      setRes(await pedir<Resultado>(`${BASE}/cobranca/extrato-funcionario?${q}`));
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const Sel = ({ label, k, opts }: { label: string; k: keyof typeof f; opts: Array<[string, string]> }) => (
    <div className="w-44">
      <label className="mb-1 block text-body-sm text-fg-muted">{label}</label>
      <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Extrato de funcionário" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">O extrato do convênio de funcionários: débitos (compras no convênio, quebras de caixa, estornos) e créditos (adiantamentos, acertos). O tipo de cada lançamento vem do texto da observação do título, como no legado. Convênio obrigatório quando o tipo é "Todos".</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <Sel label="Relatório" k="tipo" opts={[['sintetico', 'Extrato (sintético)'], ['analitico', 'Analítico']]} />
          <div className="w-80">
            <label className="mb-1 block text-body-sm text-fg-muted">Convênio</label>
            <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={f.codconvenio} onChange={(e) => setF({ ...f, codconvenio: e.target.value })}>
              <option value="">— todos —</option>
              {convenios.map((c) => <option key={c.codparceiro} value={c.codparceiro}>{c.codparceiro} · {c.razao} ({c.funcionarios})</option>)}
            </select>
          </div>
          <div className="w-28"><Field label="&Operador" value={f.codoperador} onChange={(e) => setF({ ...f, codoperador: e.target.value })} /></div>
          <Sel label="Situação" k="situacao" opts={[['todos', 'Todos'], ['quitados', 'Quitados'], ['abertos', 'Abertos']]} />
          <Sel label="Tipo" k="filtro" opts={[['todos', 'Todos'], ['compra', 'Compra'], ['adiantamento', 'Adiantamento'], ['quebra', 'Quebra'], ['estorno', 'Estorno indevido']]} />
          <Button label="&Gerar" disabled={ocupado} onClick={() => void buscar()} />
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-md text-body-sm">
              <span>Funcionários <strong className="tabular-nums">{res.totais.funcionarios}</strong></span>
              <span>Lançamentos <strong className="tabular-nums">{res.totais.linhas}</strong></span>
              <span>Créditos (+) <strong className="tabular-nums">{moeda(res.totais.creditos)}</strong></span>
              <span>Débitos (−) <strong className="tabular-nums">{moeda(res.totais.debitos)}</strong></span>
              <span>Saldo <strong className={`tabular-nums ${res.totais.saldo < 0 ? 'text-fg-danger' : ''}`}>{moeda(res.totais.saldo)}</strong></span>
              {res.truncado && <span className="text-fg-danger">lista truncada — estreite o período</span>}
            </div>
          </section>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <h4 className="p-pad-xs text-body-sm font-semibold">Por funcionário</h4>
            <table className="w-full min-w-[700px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Funcionário</th><th className="p-pad-xs">Operador</th><th className="p-pad-xs text-right">Lanç.</th><th className="p-pad-xs text-right">Créditos</th><th className="p-pad-xs text-right">Débitos</th><th className="p-pad-xs text-right">Saldo</th></tr></thead>
              <tbody>{res.funcionarios.map((x) => (
                <tr key={x.codparceiro} className="border-b border-border">
                  <td className="p-pad-xs">{x.codparceiro} · {x.nome}</td><td className="p-pad-xs tabular-nums">{x.codoperador ?? ''}{x.operadores > 1 ? ` (+${x.operadores - 1})` : ''}</td>
                  <td className="p-pad-xs text-right tabular-nums">{x.linhas}</td><td className="p-pad-xs text-right tabular-nums">{moeda(x.creditos)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(x.debitos)}</td>
                  <td className={`p-pad-xs text-right tabular-nums font-semibold ${x.saldo < 0 ? 'text-fg-danger' : ''}`}>{moeda(x.saldo)}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <h4 className="p-pad-xs text-body-sm font-semibold">{res.tipo === 'sintetico' ? 'Extrato' : 'Lançamentos'}</h4>
            <table className="w-full min-w-[1000px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Funcionário</th><th className="p-pad-xs">Operador</th>
                {res.tipo === 'analitico' && <th className="p-pad-xs">C. custo</th>}
                <th className="p-pad-xs">Tipo</th><th className="p-pad-xs">Data</th>
                {res.tipo === 'sintetico' ? <><th className="p-pad-xs">Sinal</th><th className="p-pad-xs text-right">Títulos</th></> : <><th className="p-pad-xs">Origem</th><th className="p-pad-xs">Documento</th><th className="p-pad-xs">Parc.</th><th className="p-pad-xs">Tipo doc.</th><th className="p-pad-xs">Quitada</th></>}
                <th className="p-pad-xs text-right">Valor</th>
                {res.tipo === 'analitico' && <th className="p-pad-xs">Obs</th>}
              </tr></thead>
              <tbody>{res.linhas.map((l, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="p-pad-xs">{String(l.nome ?? '')}</td><td className="p-pad-xs tabular-nums">{l.codoperador == null ? '' : String(l.codoperador)}</td>
                  {res.tipo === 'analitico' && <td className="p-pad-xs">{String(l.desccodplc ?? '')}</td>}
                  <td className="p-pad-xs">{String(l.tipo ?? '')}</td><td className="p-pad-xs">{dataBr(l.data)}</td>
                  {res.tipo === 'sintetico'
                    ? <><td className="p-pad-xs">{String(l.sinal)}</td><td className="p-pad-xs text-right tabular-nums">{String(l.titulos ?? '')}</td></>
                    : <><td className="p-pad-xs">{String(l.origem)}</td><td className="p-pad-xs tabular-nums">{String(l.documento ?? '')}</td><td className="p-pad-xs">{String(l.parcelas ?? '')}</td><td className="p-pad-xs">{String(l.tipodoc ?? '')}</td><td className="p-pad-xs">{l.quitada === 'S' ? 'sim' : 'não'}</td></>}
                  <td className={`p-pad-xs text-right tabular-nums font-semibold ${(res.tipo === 'sintetico' ? l.sinal === '-' : Number(l.valor) < 0) ? 'text-fg-danger' : ''}`}>{moeda(Math.abs(Number(l.valor ?? 0)))}</td>
                  {res.tipo === 'analitico' && <td className="p-pad-xs text-fg-muted">{String(l.obs ?? '')}</td>}
                </tr>))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
