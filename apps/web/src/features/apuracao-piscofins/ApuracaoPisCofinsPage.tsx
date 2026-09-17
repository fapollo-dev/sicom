import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * APURAÇÃO PIS/COFINS (`FRMAPURACAOPISCOFINS`).
 *
 * As apurações realizadas, o crédito e o débito lado a lado, e o **saldo por tributo** — que é o valor a
 * recolher do M200/M600. Quando o crédito supera o débito, o que sobra transporta, e a tela diz isso em vez
 * de mostrar um valor a recolher negativo.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = '/fiscal/sped/apuracao-pc';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

interface Apuracao {
  codapuracao_pc: number; dataini: string; datafim: string; operador: string;
  linhas: number; credito: number; debito: number; dtcadastro: string;
}
interface Item {
  codapuracao_pc_det: number; tipo: string; descricao: string; cst_pis: number | null;
  basecalculo: number; aliqpis: number; valorpis: number; aliqcofins: number; valorcofins: number;
}
interface Detalhe {
  codapuracao_pc: number; dataini: string; datafim: string; itens: Item[];
  totais: {
    baseCredito: number; baseDebito: number; creditoPis: number; creditoCofins: number;
    debitoPis: number; debitoCofins: number; aRecolherPis: number; aRecolherCofins: number;
    creditoTransportarPis: number; creditoTransportarCofins: number;
  };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: res.statusText };
    throw Object.assign(new Error(env.code), { envelope: env });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export function ApuracaoPisCofinsPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<Apuracao[]>([]);
  const [aberta, setAberta] = useState<Detalhe | null>(null);
  const [periodo, setPeriodo] = useState({ dtini: diaUm(), dtfim: hoje() });
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try { setLista(await req<Apuracao[]>(P)); } catch (e) { mensagem.erro(e); }
  }, [mensagem]);

  useEffect(() => { void carregar(); }, [carregar]);

  const apurar = async () => {
    setOcupado(true);
    try {
      await req('/fiscal/sped/apuracao-pc', { method: 'POST', body: JSON.stringify(periodo) });
      mensagem.sucesso('Período apurado.');
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const abrir = async (cod: number) => {
    try { setAberta(await req<Detalhe>(`${P}/${cod}`)); } catch (e) { mensagem.erro(e); }
  };

  const excluir = async (cod: number) => {
    setOcupado(true);
    try {
      await req(`${P}/${cod}`, { method: 'DELETE' });
      mensagem.sucesso('Apuração excluída — apure de novo para refazer.');
      if (aberta?.codapuracao_pc === cod) setAberta(null);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const t = aberta?.totais;

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Apuração PIS/COFINS" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Apura o período e popula o bloco M do EFD-Contribuições. A apuração é <strong>idempotente</strong>:
          apurar de novo o mesmo período refaz os números.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={periodo.dtini} onChange={(e) => setPeriodo({ ...periodo, dtini: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={periodo.dtfim} onChange={(e) => setPeriodo({ ...periodo, dtfim: e.target.value })} /></div>
          <Button label="&Apurar" disabled={ocupado} onClick={() => void apurar()} />
        </div>
      </section>

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th className="p-pad-xs">Código</th><th className="p-pad-xs">Período</th>
              <th className="p-pad-xs">Linhas</th><th className="p-pad-xs">Crédito</th>
              <th className="p-pad-xs">Débito</th><th className="p-pad-xs">Operador</th><th />
            </tr>
          </thead>
          <tbody>
            {lista.map((a) => (
              <tr key={a.codapuracao_pc} className="border-b border-border">
                <td className="p-pad-xs">{a.codapuracao_pc}</td>
                <td className="p-pad-xs">{dataBr(a.dataini)} — {dataBr(a.datafim)}</td>
                <td className="p-pad-xs tabular-nums">{a.linhas}</td>
                <td className="p-pad-xs tabular-nums">{moeda(a.credito)}</td>
                <td className="p-pad-xs tabular-nums">{moeda(a.debito)}</td>
                <td className="p-pad-xs">{a.operador}</td>
                <td className="p-pad-xs">
                  <span className="flex gap-gp-xs">
                    <Button variant="outline" label="Abrir" onClick={() => void abrir(a.codapuracao_pc)} />
                    <Button variant="outline" label="Excluir" disabled={ocupado} onClick={() => void excluir(a.codapuracao_pc)} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {aberta && t && (
        <>
          <section className="flex flex-wrap gap-gp-lg rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div>
              <div className="text-body-sm text-fg-muted">Crédito (PIS / COFINS)</div>
              <div className="text-title-sm tabular-nums">{moeda(t.creditoPis)} / {moeda(t.creditoCofins)}</div>
            </div>
            <div>
              <div className="text-body-sm text-fg-muted">Débito (PIS / COFINS)</div>
              <div className="text-title-sm tabular-nums">{moeda(t.debitoPis)} / {moeda(t.debitoCofins)}</div>
            </div>
            <div className="rounded-radius-sm border border-border bg-bg-subtle px-pad-sm py-pad-xs">
              <div className="text-body-sm text-fg-muted">A recolher (M200 / M600)</div>
              <div className="text-title-sm tabular-nums">{moeda(t.aRecolherPis)} / {moeda(t.aRecolherCofins)}</div>
            </div>
            {(t.creditoTransportarPis > 0 || t.creditoTransportarCofins > 0) && (
              <div>
                <div className="text-body-sm text-fg-muted">Crédito a transportar</div>
                <div className="text-title-sm tabular-nums">{moeda(t.creditoTransportarPis)} / {moeda(t.creditoTransportarCofins)}</div>
              </div>
            )}
          </section>

          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full min-w-[840px] border-collapse text-body-sm">
              <thead>
                <tr className="border-b border-border text-left text-fg-muted">
                  <th className="p-pad-xs">Tipo</th><th className="p-pad-xs">Descrição</th>
                  <th className="p-pad-xs">CST</th><th className="p-pad-xs">Base de cálculo</th>
                  <th className="p-pad-xs">Alíq. PIS</th><th className="p-pad-xs">PIS</th>
                  <th className="p-pad-xs">Alíq. COFINS</th><th className="p-pad-xs">COFINS</th>
                </tr>
              </thead>
              <tbody>
                {aberta.itens.map((i) => (
                  <tr key={i.codapuracao_pc_det} className="border-b border-border">
                    <td className="p-pad-xs">{i.tipo === 'C' ? 'Crédito' : 'Débito'}</td>
                    <td className="p-pad-xs">{i.descricao}</td>
                    <td className="p-pad-xs">{i.cst_pis ?? ''}</td>
                    <td className="p-pad-xs tabular-nums">{moeda(i.basecalculo)}</td>
                    <td className="p-pad-xs tabular-nums">{Number(i.aliqpis).toFixed(2)}%</td>
                    <td className="p-pad-xs tabular-nums">{moeda(i.valorpis)}</td>
                    <td className="p-pad-xs tabular-nums">{Number(i.aliqcofins).toFixed(2)}%</td>
                    <td className="p-pad-xs tabular-nums">{moeda(i.valorcofins)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
