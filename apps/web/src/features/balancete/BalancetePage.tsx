import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { hojeNaLoja } from '../../shared/tempo';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';

/**
 * BALANCETE DE VERIFICAÇÃO (`FRMRELBALANCETE`). Dossiê: `uRelBalancete.md`.
 *
 * O legado só imprime (BalanceteVerificacao.fr3); a grade aqui é a prévia do que sai no relatório. O "nível" é o do combo do legado —
 * o comprimento do código expandido (30 = tudo) —, as sintéticas somam os filhos pelo CODPAI e a descrição em degrau vem com os espaços.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hoje = () => hojeNaLoja();
const inicioDoMes = () => `${hoje().slice(0, 8)}01`;
// os itens do ComboBoxNivel do legado (o '8' repetido e sem o '9', como no .dfm)
const NIVEIS = ['1', '2', '3', '4', '5', '6', '7', '8', '8', '10', '15', '20', '25', '30'];
interface Linha { codiexpandido: string; descricao: string; classe: string | null; sintetica: boolean; saldoAnterior: number; debito: number; credito: number; saldoAtual: number }
interface Res { linhas: Linha[]; totais: Record<string, number> }

export function BalancetePage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: inicioDoMes(), dataFim: hoje(), contaIni: '', contaFim: '', nivelMax: '30', semMovimento: false, analiticas: true, degrau: true,
    negrito: true, pagina: '1', empresas: '',
  });
  const [res, setRes] = useState<Res | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const params = () => {
    const q = new URLSearchParams({
      dataIni: f.dataIni, dataFim: f.dataFim, nivelMax: f.nivelMax, semMovimento: String(f.semMovimento), analiticas: String(f.analiticas),
      degrau: String(f.degrau), negrito: String(f.negrito), pagina: f.pagina || '1',
    });
    if (f.contaIni.trim()) q.set('contaIni', f.contaIni.trim());
    if (f.contaFim.trim()) q.set('contaFim', f.contaFim.trim());
    if (f.empresas.trim()) q.set('empresas', f.empresas.replace(/\s/g, ''));
    return q;
  };
  const buscar = async () => {
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/contabil/balancete?${params()}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) { const b = await r.json().catch(() => ({})); const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText }; throw Object.assign(new Error(env.code), { envelope: env }); }
      setRes((await r.json()) as Res);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Balancete de verificação" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">Por conta do plano: saldo anterior, débitos e créditos do período e saldo atual. O nível é o comprimento do código da conta (30 = todas).</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-40"><Field label="Conta &inicial" value={f.contaIni} onChange={(e) => setF({ ...f, contaIni: e.target.value })} /></div>
          <div className="w-40"><Field label="Conta &final" value={f.contaFim} onChange={(e) => setF({ ...f, contaFim: e.target.value })} /></div>
          <div className="w-24">
            <label className="mb-1 block text-body-sm text-fg-muted">Nível</label>
            <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={f.nivelMax} onChange={(e) => setF({ ...f, nivelMax: e.target.value })}>
              {NIVEIS.map((n, i) => <option key={`${n}-${i}`} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="w-24"><Field label="&Página" value={f.pagina} onChange={(e) => setF({ ...f, pagina: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="w-40"><Field label="&Lojas (vírgula)" value={f.empresas} onChange={(e) => setF({ ...f, empresas: e.target.value })} /></div>
        </div>
        <div className="mt-form-gap flex flex-wrap items-center gap-gp-md">
          <label className="flex items-center gap-gp-xs text-body-sm"><input type="checkbox" checked={f.degrau} onChange={(e) => setF({ ...f, degrau: e.target.checked })} />Descrições em degrau</label>
          <label className="flex items-center gap-gp-xs text-body-sm"><input type="checkbox" checked={f.analiticas} onChange={(e) => setF({ ...f, analiticas: e.target.checked })} />Imprime contas analíticas</label>
          <label className="flex items-center gap-gp-xs text-body-sm"><input type="checkbox" checked={f.negrito} onChange={(e) => setF({ ...f, negrito: e.target.checked })} />Imprime contas sintéticas em negrito</label>
          <label className="flex items-center gap-gp-xs text-body-sm"><input type="checkbox" checked={f.semMovimento} onChange={(e) => setF({ ...f, semMovimento: e.target.checked })} />Imprimir contas sem movimento</label>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void buscar()} />
          <Button label="&Imprimir" variant="soft" disabled={ocupado} onClick={() => {
            void imprimirRelatorio(`/contabil/balancete/impressao?${params().toString()}`).catch((e) => mensagem.erro(e));
          }} />
        </div>
      </section>
      {res && (
        <>
          <p className="text-body-sm text-fg-muted">{res.totais.contas} conta(s) · débitos {moeda(res.totais.debito)} · créditos {moeda(res.totais.credito)} · saldo atual {moeda(res.totais.saldoAtual)}</p>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full min-w-[900px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Conta</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs text-right">Saldo anterior</th><th className="p-pad-xs text-right">Débito</th><th className="p-pad-xs text-right">Crédito</th><th className="p-pad-xs text-right">Saldo atual</th></tr></thead>
              <tbody>{res.linhas.map((l) => (
                <tr key={l.codiexpandido} className={`border-b border-border ${f.negrito && l.classe === 'T' ? 'font-semibold' : ''}`}>
                  <td className="p-pad-xs tabular-nums">{l.codiexpandido}</td>
                  <td className="whitespace-pre p-pad-xs">{l.descricao}</td>
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
