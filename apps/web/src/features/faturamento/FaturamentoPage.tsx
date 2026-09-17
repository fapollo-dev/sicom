import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { DATAS_FATURAMENTO, isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';

/**
 * FATURAMENTO DA NOTA (`FRMFATURAMENTO2`).
 * Dossiê: `uFaturamento2.md`.
 *
 * As parcelas de cada nota: quando vencem, quanto, e se já viraram título. A legenda de três estados do
 * original — **vencendo hoje**, **atrasada**, **faturada** — está nas cores da tabela.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

interface Linha {
  codfaturamento: number; idnf: number; nronf: string | null; serie: string | null; tipo: string;
  titular: string; totalnf: number | null; dtemissao: string | null; vencimento: string | null;
  valor: number; liberado: string; modalidade: string | null; nrofatura: number | null;
  totalparcelasfatura: number | null; duplicata: string | null; codbarrasboleto: string | null;
  situacao: string; data_invalida: boolean;
}
interface Resultado {
  linhas: Linha[];
  totais: { parcelas: number; notas: number; valor: number; vencendoHoje: number; atrasadas: number; faturadas: number; dataInvalida: number };
}

const COR: Record<string, string> = {
  VENCE_HOJE: 'text-fg-warning font-semibold',
  ATRASADA: 'text-fg-danger font-semibold',
  FATURADA: 'text-fg-muted',
};
const ROTULO: Record<string, string> = {
  VENCE_HOJE: 'Vence hoje', ATRASADA: 'Atrasada', FATURADA: 'Faturada',
  A_VENCER: 'A vencer', SEM_VENCIMENTO: 'Sem vencimento',
};

export function FaturamentoPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: diaUm(), dataFim: hoje(), base: 'PARCELA', tipo: 'E', liberado: 'N',
    nronf: '', codparceiro: '',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim, base: f.base, tipo: f.tipo, liberado: f.liberado });
      if (f.nronf) q.set('nronf', f.nronf);
      if (f.codparceiro) q.set('codparceiro', f.codparceiro);
      const r = await fetch(`${BASE}/compras/faturamento?${q}`, { headers: apiHeaders() });
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
      <PageHeader title="Faturamento da nota" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          As parcelas de cada nota: quando vencem, quanto, e se já viraram título no financeiro. Só nota
          <strong> processada</strong> aparece, como no original.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Filtrar por
            <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
              value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })}>
              {DATAS_FATURAMENTO.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Lado
            <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
              value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              <option value="E">A pagar (nota de entrada)</option><option value="S">A receber (nota de saída)</option>
            </select>
          </label>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Situação
            <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
              value={f.liberado} onChange={(e) => setF({ ...f, liberado: e.target.value })}>
              <option value="N">A faturar</option><option value="S">Já faturadas</option><option value="TODOS">Todas</option>
            </select>
          </label>
          <div className="w-32"><Field label="&Nota fiscal" value={f.nronf} onChange={(e) => setF({ ...f, nronf: e.target.value })} /></div>
          <div className="w-32"><Field label="&Parceiro" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value })} /></div>
          <Button label="&Consultar" disabled={ocupado} onClick={() => void buscar()} />
          {res && (
            <Button variant="outline" label="&Exportar" onClick={() => exportarGradeCsv(
              res.linhas,
              [
                { titulo: 'NF', valor: (l: Linha) => l.nronf },
                { titulo: 'Série', valor: (l: Linha) => l.serie },
                { titulo: 'Titular', valor: (l: Linha) => l.titular },
                { titulo: 'Emissão', valor: (l: Linha) => dataBr(l.dtemissao) },
                { titulo: 'Vencimento', valor: (l: Linha) => dataBr(l.vencimento) },
                { titulo: 'Parcela', valor: (l: Linha) => `${l.nrofatura ?? ''}/${l.totalparcelasfatura ?? ''}` },
                { titulo: 'Valor', valor: (l: Linha) => moeda(l.valor) },
                { titulo: 'Modalidade', valor: (l: Linha) => l.modalidade },
                { titulo: 'Situação', valor: (l: Linha) => ROTULO[l.situacao] ?? l.situacao },
                { titulo: 'Duplicata', valor: (l: Linha) => l.duplicata },
              ],
              'faturamento',
            )} />
          )}
        </div>
      </section>

      {res && (
        <section className="flex flex-wrap gap-gp-lg rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div><div className="text-body-sm text-fg-muted">Parcelas</div><div className="text-title-sm tabular-nums">{res.totais.parcelas}</div></div>
          <div><div className="text-body-sm text-fg-muted">Notas</div><div className="text-title-sm tabular-nums">{res.totais.notas}</div></div>
          <div><div className="text-body-sm text-fg-muted">Valor</div><div className="text-title-sm tabular-nums">{moeda(res.totais.valor)}</div></div>
          <div><div className="text-body-sm text-fg-muted">Vencendo hoje</div><div className="text-title-sm tabular-nums text-fg-warning">{res.totais.vencendoHoje}</div></div>
          <div><div className="text-body-sm text-fg-muted">Atrasadas</div><div className="text-title-sm tabular-nums text-fg-danger">{res.totais.atrasadas}</div></div>
          <div><div className="text-body-sm text-fg-muted">Faturadas</div><div className="text-title-sm tabular-nums">{res.totais.faturadas}</div></div>
          {res.totais.dataInvalida > 0 && (
            <div>
              <div className="text-body-sm text-fg-muted">Data suspeita</div>
              <div className="text-title-sm tabular-nums text-fg-danger">{res.totais.dataInvalida}</div>
            </div>
          )}
        </section>
      )}

      {res && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full min-w-[1000px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">NF</th><th className="p-pad-xs">Titular</th>
                <th className="p-pad-xs">Emissão</th><th className="p-pad-xs">Vencimento</th>
                <th className="p-pad-xs">Parcela</th><th className="p-pad-xs">Valor</th>
                <th className="p-pad-xs">Modalidade</th><th className="p-pad-xs">Duplicata</th>
                <th className="p-pad-xs">Situação</th>
              </tr>
            </thead>
            <tbody>
              {res.linhas.map((l) => (
                <tr key={l.codfaturamento} className="border-b border-border">
                  <td className="p-pad-xs">{l.nronf}{l.serie ? `/${l.serie}` : ''}</td>
                  <td className="p-pad-xs">{l.titular}</td>
                  <td className="p-pad-xs">{dataBr(l.dtemissao)}</td>
                  <td className={`p-pad-xs ${l.data_invalida ? 'text-fg-danger' : ''}`}>
                    {dataBr(l.vencimento)}{l.data_invalida ? ' ⚠' : ''}
                  </td>
                  <td className="p-pad-xs tabular-nums">{l.nrofatura ?? ''}/{l.totalparcelasfatura ?? ''}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.valor)}</td>
                  <td className="p-pad-xs">{l.modalidade}</td>
                  <td className="p-pad-xs">{l.duplicata}</td>
                  <td className={`p-pad-xs ${COR[l.situacao] ?? ''}`}>{ROTULO[l.situacao] ?? l.situacao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
