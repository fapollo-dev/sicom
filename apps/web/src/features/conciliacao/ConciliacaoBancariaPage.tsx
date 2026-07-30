import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { listarContas, pendentes, sugestoes, conciliar, type ContaBancaria, type OfxLinha, type MovLinha } from './conciliacaoApi';

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

/**
 * CONCILIAÇÃO BANCÁRIA (OFX) (FRMCONCILIACAOBANCARIA) — corte-1. Escolhe a conta → vê o extrato pendente × o razão
 * interno pendente (mov_contas_bancarias) → «Sugerir» casa automático por data+valor → seleciona os dois lados →
 * «Conciliar» (Σ iguais). Importação das linhas do extrato é via API/ETL (o parser do arquivo .ofx é corte futuro).
 */
export function ConciliacaoBancariaPage() {
  const mensagem = useMensagem();
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [conta, setConta] = useState('');
  const [ofx, setOfx] = useState<OfxLinha[]>([]);
  const [mov, setMov] = useState<MovLinha[]>([]);
  const [selOfx, setSelOfx] = useState<Set<number>>(new Set());
  const [selMov, setSelMov] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => { void listarContas().then(setContas).catch(() => setContas([])); }, []);

  const carregar = async (cod: number) => {
    try {
      const p = await pendentes(cod);
      setOfx(p.ofx ?? []); setMov(p.mov ?? []); setSelOfx(new Set()); setSelMov(new Set());
    } catch (e) { mensagem.erro(e); }
  };
  const escolherConta = (v: string) => { setConta(v); if (v) void carregar(Number(v)); else { setOfx([]); setMov([]); } };

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, id: number) => {
    const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setter(n);
  };

  const sugerir = async () => {
    if (!conta) return;
    try {
      const { pares } = await sugestoes(Number(conta));
      if (!pares.length) { mensagem.sucesso('Nenhum par automático (data+valor) encontrado.'); return; }
      setSelOfx(new Set(pares.map((p) => p.mbo_id)));
      setSelMov(new Set(pares.map((p) => p.codmovconta)));
      mensagem.sucesso(`${pares.length} par(es) sugerido(s) por data+valor. Confira e concilie.`);
    } catch (e) { mensagem.erro(e); }
  };

  const totOfx = ofx.filter((o) => selOfx.has(o.mbo_id)).reduce((s, o) => s + Number(o.mbo_valor), 0);
  const totMov = mov.filter((m) => selMov.has(m.codmovconta)).reduce((s, m) => s + Number(m.valor), 0);
  const iguais = Math.round(totOfx * 100) === Math.round(totMov * 100);

  const conciliarSel = async () => {
    if (busy || !conta) return;
    if (!selOfx.size || !selMov.size) { window.alert('Selecione linhas do extrato E do razão.'); return; }
    if (!iguais) { window.alert(`Os totais precisam ser iguais (extrato ${brl(totOfx)} × razão ${brl(totMov)}).`); return; }
    setBusy(true);
    try {
      const r = await conciliar(Number(conta), [...selOfx], [...selMov]);
      mensagem.sucesso(`Conciliação ${r.cb_id} gravada — ${r.ofx} linha(s) do extrato × ${r.mov} lançamento(s), total ${brl(r.total)}.`);
      await carregar(Number(conta));
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Conciliação Bancária (OFX)" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-72"><SelectField label="&Conta bancária" value={conta} onChange={escolherConta} options={contas.map((c) => ({ value: String(c.codconta), label: `${c.banco ?? ''} ${c.titular ?? ''}`.trim() || String(c.codconta) }))} placeholder="(selecione a conta)" /></div>
        <Button label="&Sugerir automática" variant="ghost" disabled={!conta || !ofx.length} onClick={() => void sugerir()} />
        <Button label="&Conciliar selecionados" variant="soft" disabled={busy || !iguais || !selOfx.size || !selMov.size} onClick={() => void conciliarSel()} />
        <div className="flex-1 text-right text-body-sm">Selecionado — extrato <b className={iguais ? 'text-fg' : 'text-danger'}>{brl(totOfx)}</b> · razão <b className={iguais ? 'text-fg' : 'text-danger'}>{brl(totMov)}</b> {selOfx.size + selMov.size > 0 && (iguais ? '✓' : '≠')}</div>
        <small className="w-full text-fg-muted">Casa o extrato (OFX) com o razão de contas-correntes por data + valor. A importação das linhas é via ETL/API (o parser do arquivo .ofx e os ramos A-Pagar/A-Receber por lote são cortes futuros).</small>
      </div>

      <div className="grid grid-cols-1 gap-gp-md md:grid-cols-2">
        <div className="tablecard overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <div className="border-b border-border p-pad-xs text-body-sm font-semibold text-fg-muted">Extrato (OFX) pendente — {ofx.length}</div>
          <table className="w-full text-body-sm">
            <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs" /><th className="p-pad-xs">Data</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs text-right">Valor</th></tr></thead>
            <tbody>
              {ofx.map((o) => (
                <tr key={o.mbo_id} className={`border-t border-border ${selOfx.has(o.mbo_id) ? 'bg-bg-subtle' : ''}`}>
                  <td className="p-pad-xs"><input type="checkbox" checked={selOfx.has(o.mbo_id)} onChange={() => toggle(selOfx, setSelOfx, o.mbo_id)} /></td>
                  <td className="p-pad-xs">{dia(o.mbo_data)}</td>
                  <td className="p-pad-xs">{o.mbo_descricao ?? '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{o.mbo_credito_debito === 'D' ? '−' : ''}{brl(o.mbo_valor)}</td>
                </tr>
              ))}
              {!ofx.length && <tr><td colSpan={4} className="p-pad-md text-fg-muted">Sem extrato pendente. Importe o extrato (via ETL/API).</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="tablecard overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <div className="border-b border-border p-pad-xs text-body-sm font-semibold text-fg-muted">Razão interno pendente — {mov.length}</div>
          <table className="w-full text-body-sm">
            <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs" /><th className="p-pad-xs">Data</th><th className="p-pad-xs">Histórico</th><th className="p-pad-xs text-right">Valor</th></tr></thead>
            <tbody>
              {mov.map((m) => (
                <tr key={m.codmovconta} className={`border-t border-border ${selMov.has(m.codmovconta) ? 'bg-bg-subtle' : ''}`}>
                  <td className="p-pad-xs"><input type="checkbox" checked={selMov.has(m.codmovconta)} onChange={() => toggle(selMov, setSelMov, m.codmovconta)} /></td>
                  <td className="p-pad-xs">{dia(m.data)}</td>
                  <td className="p-pad-xs">{m.historico ?? m.origem ?? '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(m.valor)}</td>
                </tr>
              ))}
              {!mov.length && <tr><td colSpan={4} className="p-pad-md text-fg-muted">Sem lançamentos pendentes no razão.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
