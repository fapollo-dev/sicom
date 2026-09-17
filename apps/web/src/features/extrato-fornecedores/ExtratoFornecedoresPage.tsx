import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import {
  DATAS_EXTRATO_FOR, isErroResposta, MODELOS_EXTRATO_FOR, type ErroResposta,
} from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';

/**
 * EXTRATO DE FORNECEDORES (`FRMEXTRATOFORNECEDORES`).
 * Dossiê: `uExtratoFornecedores.md`.
 *
 * O que se deve a cada fornecedor — e, no modelo de **saldo**, quanto se devia numa data passada.
 *
 * ⚠️ a coluna de data muda de significado: é o **pagamento** quando o título está quitado e o **vencimento**
 * quando não. É do legado, e a tela diz isso no cabeçalho em vez de esconder.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

interface Linha {
  codapg: number; duplicata: string | null; nronf: string | null; dtcompra: string | null;
  dtcontabil: string | null; data_referencia: string | null; dtvenc: string | null; dtpgto: string | null;
  razao: string; valor: number; juros: number; acre_desc: number; valor_pg: number;
  quitada: string; idlote: number | null;
}
interface Resultado {
  linhas: Linha[];
  totais: { titulos: number; valor: number; pago: number; juros: number; acreDesc: number; aberto: number };
}

export function ExtratoFornecedoresPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: diaUm(), dataFim: hoje(), base: 'VENCIMENTO', modelo: 'PERIODO', situacao: 'TODOS', parceiro: '',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const porPeriodo = f.modelo === 'PERIODO';

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, modelo: f.modelo, base: f.base, situacao: f.situacao });
      if (porPeriodo) q.set('dataFim', f.dataFim);
      if (f.parceiro) q.set('parceiro', f.parceiro);
      const r = await fetch(`${BASE}/relatorios/extrato-fornecedores?${q}`, { headers: apiHeaders() });
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
      <PageHeader title="Extrato de fornecedores" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          O que se deve a cada fornecedor. O modelo <strong>saldo na data</strong> responde quanto se devia num
          dia passado — e olha a <em>data do pagamento</em>, então um título pago depois daquele dia ainda
          conta como dívida nele.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Modelo
            <select className="h-9 min-w-72 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
              value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })}>
              {MODELOS_EXTRATO_FOR.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <div className="w-40"><Field label={porPeriodo ? '&De' : '&Data' } type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          {porPeriodo && <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>}
          {f.modelo !== 'SALDO' && f.modelo !== 'SALDO2' && (
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Data de referência
              <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
                value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })}>
                {DATAS_EXTRATO_FOR.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Situação
            <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
              value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value })}>
              <option value="TODOS">Todos</option><option value="ABERTO">Somente em aberto</option><option value="BAIXADO">Somente baixados</option>
            </select>
          </label>
          <div className="w-56"><Field label="&Fornecedor" value={f.parceiro} onChange={(e) => setF({ ...f, parceiro: e.target.value })} /></div>
          <Button label="&Consultar" disabled={ocupado} onClick={() => void buscar()} />
          {res && (
            <Button variant="outline" label="&Exportar" onClick={() => exportarGradeCsv(
              res.linhas,
              [
                { titulo: 'Fornecedor', valor: (l: Linha) => l.razao },
                { titulo: 'Duplicata', valor: (l: Linha) => l.duplicata },
                { titulo: 'NF', valor: (l: Linha) => l.nronf },
                { titulo: 'Compra', valor: (l: Linha) => dataBr(l.dtcompra) },
                { titulo: 'Vencimento/Pagamento', valor: (l: Linha) => dataBr(l.data_referencia) },
                { titulo: 'Valor', valor: (l: Linha) => moeda(l.valor) },
                { titulo: 'Juros', valor: (l: Linha) => moeda(l.juros) },
                { titulo: 'Acré./Desc.', valor: (l: Linha) => moeda(l.acre_desc) },
                { titulo: 'Pago', valor: (l: Linha) => moeda(l.valor_pg) },
                { titulo: 'Quitada', valor: (l: Linha) => l.quitada },
              ],
              'extrato-fornecedores',
            )} />
          )}
        </div>
      </section>

      {res && (
        <section className="flex flex-wrap gap-gp-lg rounded-radius-md border border-border bg-bg-surface p-pad-md">
          {[['Títulos', res.totais.titulos], ['Valor', res.totais.valor], ['Em aberto', res.totais.aberto],
            ['Pago', res.totais.pago], ['Juros', res.totais.juros], ['Acré./Desc.', res.totais.acreDesc]].map(([r, v]) => (
            <div key={String(r)}>
              <div className="text-body-sm text-fg-muted">{r}</div>
              <div className="text-title-sm tabular-nums">{r === 'Títulos' ? String(v) : moeda(v)}</div>
            </div>
          ))}
        </section>
      )}

      {res && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full min-w-[980px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Fornecedor</th><th className="p-pad-xs">Duplicata</th>
                <th className="p-pad-xs">NF</th><th className="p-pad-xs">Compra</th>
                <th className="p-pad-xs" title="pagamento quando quitado, vencimento quando não">Venc. / Pagto.</th>
                <th className="p-pad-xs">Valor</th><th className="p-pad-xs">Juros</th>
                <th className="p-pad-xs">Acré./Desc.</th><th className="p-pad-xs">Pago</th>
                <th className="p-pad-xs">Situação</th>
              </tr>
            </thead>
            <tbody>
              {res.linhas.map((l, i) => (
                <tr key={`${l.codapg}-${i}`} className="border-b border-border">
                  <td className="p-pad-xs">{l.razao}</td>
                  <td className="p-pad-xs">{l.duplicata}</td>
                  <td className="p-pad-xs">{l.nronf}</td>
                  <td className="p-pad-xs">{dataBr(l.dtcompra)}</td>
                  <td className="p-pad-xs">{dataBr(l.data_referencia)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.valor)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.juros)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.acre_desc)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.valor_pg)}</td>
                  <td className="p-pad-xs">{l.quitada === 'S' ? 'Quitado' : 'Em aberto'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
