import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  listarContas, listarOperacoes, obterExtrato, lancar, transferir, estornar,
  type ContaBancaria, type Operacao, type Movimento,
} from './controleContasApi';

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const nomeConta = (c: ContaBancaria) => `${c.banco ?? ''} ${c.titular ?? ''}`.trim() || `Conta ${c.codconta}`;

/**
 * CONTROLE DE CONTAS CORRENTES (FRMCONTROLECONTASBANCARIAS) — corte-1. A tela-hub financeira: escolhe a conta → vê o
 * SALDO + o EXTRATO (razão mov_contas_bancarias) → «Novo lançamento» (operação C/D) ou «Transferência» entre contas
 * (2 pernas atômicas) → estorna manual/transferência. Split LIBERADO, forma-pgto e chaveamento de período = adiados.
 */
export function ControleContasPage() {
  const mensagem = useMensagem();
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [operacoes, setOperacoes] = useState<Operacao[]>([]);
  const [conta, setConta] = useState('');
  const [saldo, setSaldo] = useState(0);
  const [movimentos, setMovimentos] = useState<Movimento[]>([]);
  const [busy, setBusy] = useState(false);
  // form lançamento
  const [op, setOp] = useState('');
  const [valor, setValor] = useState<number | undefined>();
  const [hist, setHist] = useState('');
  // form transferência
  const [destino, setDestino] = useState('');
  const [valorT, setValorT] = useState<number | undefined>();
  const [histT, setHistT] = useState('');

  useEffect(() => {
    void listarContas().then(setContas).catch(() => setContas([]));
    void listarOperacoes().then(setOperacoes).catch(() => setOperacoes([]));
  }, []);

  const carregar = useCallback(async (cod: number) => {
    try {
      const ext = await obterExtrato(cod);
      setSaldo(ext.saldo); setMovimentos(ext.movimentos ?? []);
    } catch (e) { mensagem.erro(e); }
  }, [mensagem]);
  const escolher = (v: string) => { setConta(v); if (v) void carregar(Number(v)); else { setMovimentos([]); setSaldo(0); } };

  const lancarMov = async () => {
    if (busy || !conta) return;
    if (!op) { window.alert('Escolha a operação.'); return; }
    if (valor == null || valor <= 0) { window.alert('Informe o valor (> 0).'); return; }
    setBusy(true);
    try {
      const r = await lancar({ codconta: Number(conta), codopconta: Number(op), valor, historico: hist || undefined });
      mensagem.sucesso(`Lançamento ${r.tipomovimento === 'C' ? 'de crédito' : 'de débito'} gravado. Saldo: ${brl(r.saldo)}.`);
      setValor(undefined); setHist('');
      await carregar(Number(conta));
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const transferirMov = async () => {
    if (busy || !conta) return;
    if (!destino) { window.alert('Escolha a conta de destino.'); return; }
    if (valorT == null || valorT <= 0) { window.alert('Informe o valor (> 0).'); return; }
    setBusy(true);
    try {
      const r = await transferir({ codorigem: Number(conta), coddestino: Number(destino), valor: valorT, historico: histT || undefined });
      mensagem.sucesso(`Transferência ${brl(valorT)} → conta ${destino} (lote ${r.idlote}).`);
      setValorT(undefined); setHistT(''); setDestino('');
      await carregar(Number(conta));
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const estornarMov = async (m: Movimento) => {
    if (busy) return;
    const msg = m.origem === 'TRANSF' ? 'Estornar a TRANSFERÊNCIA? As duas pernas (débito e crédito) serão apagadas.' : 'Estornar este lançamento?';
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const r = await estornar(m.codmovconta);
      mensagem.sucesso(`Estornado — ${r.removidos} lançamento(s) removido(s).`);
      await carregar(Number(conta));
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const opcoesConta = contas.map((c) => ({ value: String(c.codconta), label: nomeConta(c) }));
  const manual = (o?: string | null) => o === 'MANUAL' || o === 'TRANSF';

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Controle de Contas Correntes" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-72"><SelectField label="&Conta corrente" value={conta} onChange={escolher} options={opcoesConta} placeholder="(selecione a conta)" /></div>
        {conta && <div className="flex-1 text-right"><div className="text-body-sm text-fg-muted">Saldo atual</div><div className={`text-title-md font-bold ${saldo < 0 ? 'text-danger' : 'text-fg'}`}>{brl(saldo)}</div></div>}
      </div>

      {conta && (
        <div className="grid grid-cols-1 gap-gp-md md:grid-cols-2">
          <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="text-body-sm font-semibold text-fg-muted">Novo lançamento</div>
            <SelectField label="&Operação" value={op} onChange={setOp} options={operacoes.map((o) => ({ value: String(o.codopconta), label: `${o.descricao} (${o.tipo === 'C' ? 'crédito' : 'débito'})` }))} placeholder="(operação)" />
            <div className="flex gap-gp-sm">
              <div className="w-40"><NumberField label="&Valor" value={valor} decimais={2} min={0} onChange={setValor} /></div>
              <div className="flex-1"><Field label="&Histórico" value={hist} onChange={(e) => setHist(e.target.value)} placeholder="descrição" /></div>
            </div>
            <div><Button label="&Lançar" variant="soft" disabled={busy || !op || !valor} onClick={() => void lancarMov()} /></div>
          </div>

          <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="text-body-sm font-semibold text-fg-muted">Transferência (débito nesta conta → crédito no destino)</div>
            <SelectField label="Conta de &destino" value={destino} onChange={setDestino} options={opcoesConta.filter((o) => o.value !== conta)} placeholder="(conta destino)" />
            <div className="flex gap-gp-sm">
              <div className="w-40"><NumberField label="&Valor" value={valorT} decimais={2} min={0} onChange={setValorT} /></div>
              <div className="flex-1"><Field label="&Histórico" value={histT} onChange={(e) => setHistT(e.target.value)} placeholder="descrição" /></div>
            </div>
            <div><Button label="&Transferir" variant="soft" disabled={busy || !destino || !valorT} onClick={() => void transferirMov()} /></div>
          </div>
        </div>
      )}

      {conta && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <div className="border-b border-border p-pad-xs text-body-sm font-semibold text-fg-muted">Extrato — {movimentos.length} movimento(s)</div>
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="p-pad-xs">Data</th><th className="p-pad-xs">Histórico</th><th className="p-pad-xs">Origem</th>
                <th className="p-pad-xs text-right">Valor</th><th className="p-pad-xs text-right">Saldo</th><th className="p-pad-xs" />
              </tr>
            </thead>
            <tbody>
              {movimentos.map((m) => (
                <tr key={m.codmovconta} className="border-t border-border">
                  <td className="p-pad-xs tabular-nums">{dia(m.data_fechamento)}</td>
                  <td className="p-pad-xs">{m.historico ?? '—'}{m.mov_conciliado === 'S' ? ' 🔒' : ''}</td>
                  <td className="p-pad-xs text-fg-muted">{m.origem ?? '—'}</td>
                  <td className={`p-pad-xs text-right tabular-nums ${m.valor_com_sinal < 0 ? 'text-danger' : 'text-fg'}`}>{m.valor_com_sinal < 0 ? '−' : '+'}{brl(Math.abs(m.valor_com_sinal))}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(m.saldo_corrente)}</td>
                  <td className="p-pad-xs text-right">{manual(m.origem) && m.mov_conciliado !== 'S' ? <Button label="Estornar" variant="ghost" onClick={() => void estornarMov(m)} /> : <span className="text-fg-muted text-body-xs">—</span>}</td>
                </tr>
              ))}
              {!movimentos.length && <tr><td colSpan={6} className="p-pad-md text-fg-muted">Sem movimentos nesta conta.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
