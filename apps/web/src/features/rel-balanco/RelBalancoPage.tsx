import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * BALANÇO PATRIMONIAL (`FRMRELBALANCO`). Dossiê: `uRelBalanco.md`.
 * Ativo e passivo numa data: saldo anterior (antes do 1º dia do mês), movimento do mês até a data e saldo
 * atual. No legado, o modo "só sintéticas" vinha vazio — nenhuma conta tem CLASSE 'S'.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);

interface Linha { codplanocontas: number; codiexpandido: string; descricao: string; nivel: number; sintetica: boolean; saldoAnterior: number; debito: number; credito: number; saldoAtual: number; degrau: string }
interface Grupo { codigo: string; descricao: string; saldoAnterior: number; debito: number; credito: number; saldoAtual: number }
interface Resultado { data: string; competencia: { de: string; ate: string }; linhas: Linha[]; ativo: Grupo | null; passivo: Grupo | null; diferenca: number | null; totais: { contas: number; contasNoPlano: number; movimentadas: number; sinteticas: number; classeS: number } }

export function RelBalancoPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ data: hoje(), analiticas: true, semMovimento: false, nivelMax: '9' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ data: f.data, analiticas: String(f.analiticas), semMovimento: String(f.semMovimento), nivelMax: f.nivelMax });
      const r = await fetch(`${BASE}/contabil/balanco?${q}`, { headers: apiHeaders() });
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
      <PageHeader title="Balanço patrimonial" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">Ativo e passivo na data escolhida. O saldo anterior vem de tudo lançado antes do 1º dia do mês; débito e crédito são o movimento do mês até a data.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&Data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></div>
          <div className="w-28"><Field label="&Nível até" value={f.nivelMax} onChange={(e) => setF({ ...f, nivelMax: e.target.value.replace(/\D/g, '') || '9' })} /></div>
          <label className="flex items-center gap-1 pb-2 text-body-sm"><input type="checkbox" checked={f.analiticas} onChange={(e) => setF({ ...f, analiticas: e.target.checked })} /> analíticas</label>
          <label className="flex items-center gap-1 pb-2 text-body-sm"><input type="checkbox" checked={f.semMovimento} onChange={(e) => setF({ ...f, semMovimento: e.target.checked })} /> mostrar sem movimento</label>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-md text-body-sm">
              <span>Competência {dataBr(res.competencia.de)} a {dataBr(res.competencia.ate)}</span>
              {res.ativo && <span>Ativo <strong className="tabular-nums">{moeda(res.ativo.saldoAtual)}</strong></span>}
              {res.passivo && <span>Passivo <strong className="tabular-nums">{moeda(res.passivo.saldoAtual)}</strong></span>}
              {res.diferenca != null && <span className={Math.abs(res.diferenca) > 0.01 ? 'font-semibold text-fg-danger' : ''}>Ativo + Passivo <strong className="tabular-nums">{moeda(res.diferenca)}</strong></span>}
              <span className="text-fg-muted">{res.totais.contas} de {res.totais.contasNoPlano} contas · {res.totais.movimentadas} com movimento</span>
            </div>
            {res.totais.classeS === 0 && !f.analiticas && (
              <p className="mt-form-gap text-body-sm text-fg-muted">No legado este modo devolvia zero linhas: o filtro era <code>CLASSE = &apos;S&apos;</code> e nenhuma conta do plano tem essa classe. Aqui sintética é a conta que tem filha.</p>
            )}
          </section>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full min-w-[900px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Conta</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs text-right">Saldo anterior</th>
                <th className="p-pad-xs text-right">Débito</th><th className="p-pad-xs text-right">Crédito</th><th className="p-pad-xs text-right">Saldo atual</th>
              </tr></thead>
              <tbody>{res.linhas.map((l) => (
                <tr key={l.codplanocontas} className={`border-b border-border ${l.sintetica ? 'font-semibold' : ''}`}>
                  <td className="p-pad-xs tabular-nums">{l.codiexpandido}</td>
                  <td className="p-pad-xs"><span style={{ paddingLeft: `${(l.nivel - 1) * 12}px` }}>{l.descricao}</span></td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.saldoAnterior)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.debito)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.credito)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.saldoAtual)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
