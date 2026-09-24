import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { DateField } from '../../shared/ui/DateField';
import {
  listarContasCC, listarDestinos, listarModalidades, obterExtrato, obterSaldo, lancarSaldo, transferir, estornar, listarALiberar, liberarMovimentos, mudarDataLiberacao,
  type ContaCC, type Movimento, type PainelSaldo, type MovALiberar,
} from './controleContasApi';

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const nomeDestino = (c: { codconta: number; nroconta: string | null; titular: string | null; idempresa: number }) => `${c.nroconta ?? c.codconta} · ${c.titular ?? ''} (loja ${c.idempresa})`;
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/**
 * CONTROLE DE CONTAS CORRENTES (FRMCONTROLECONTASBANCARIAS; uControleContasBancarias-spec.md). A lista é a das contas do
 * operador (CONTAS_BANCARIAS_OP) — de qualquer loja; o painel tem os 5 números do legado (Entradas e Saídas de tudo, Total a
 * prazo, Saldo futuro, Saldo atual), com "posicionar saldo nesta data". Os botões seguem as permissões da conta. Abaixo, a
 * transferência (destino em qualquer conta), o lançamento e o extrato (a data é a emissão, com hora).
 */
export function ControleContasPage() {
  const mensagem = useMensagem();
  const [contas, setContas] = useState<ContaCC[]>([]);
  const [destinos, setDestinos] = useState<Array<{ codconta: number; nroconta: string | null; titular: string | null; idempresa: number }>>([]);
  const [modalidades, setModalidades] = useState<Array<{ idpgto: number; modalidade: string }>>([]);
  const [conta, setConta] = useState('');
  const [saldo, setSaldo] = useState(0);
  const [painel, setPainel] = useState<PainelSaldo | null>(null);
  const [posicionar, setPosicionar] = useState<{ ativo: boolean; data: string }>({ ativo: false, data: hoje() });
  const [aLiberar, setALiberar] = useState<{ itens: MovALiberar[]; marcados: Set<number>; data: string } | null>(null);
  const [movimentos, setMovimentos] = useState<Movimento[]>([]);
  const [busy, setBusy] = useState(false);
  // form do lançamento de saldo (UlancamentoSaldo): valor com sinal, modalidade, histórico, data, senha administrativa
  const [ls, setLs] = useState({ valor: '', idpgto: '', historico: 'SALDO INICIAL', data: hoje(), senha: '' });
  // form transferência
  const [destino, setDestino] = useState('');
  const [valorT, setValorT] = useState<number | undefined>();
  const [histT, setHistT] = useState('');

  useEffect(() => {
    void listarContasCC().then(setContas).catch(() => setContas([]));
    void listarDestinos().then(setDestinos).catch(() => setDestinos([]));
    void listarModalidades().then(setModalidades).catch(() => setModalidades([]));
  }, []);

  const sel = contas.find((c) => String(c.codconta) === conta);
  const carregar = useCallback(async (cod: number, ate?: string) => {
    const c = contas.find((x) => x.codconta === cod);
    try {
      setPainel(c && c.visualizar_saldos !== 'S' ? null : await obterSaldo(cod, ate));
      if (c && c.habiltiar_detalhar_conta !== 'S') { setMovimentos([]); return; }
      const ext = await obterExtrato(cod);
      setSaldo(ext.saldo); setMovimentos(ext.movimentos ?? []);
    } catch (e) { mensagem.erro(e); }
  }, [mensagem, contas]);
  const escolher = (v: string) => { setConta(v); if (v) void carregar(Number(v), posicionar.ativo ? posicionar.data : undefined); else { setMovimentos([]); setSaldo(0); setPainel(null); } };

  const lancarMov = async () => {
    if (busy || !conta) return;
    const valor = Number(ls.valor.replace(/\./g, '').replace(',', '.'));
    if (!ls.idpgto) { mensagem.erro(new Error('Informe a modalidade!')); return; }
    if (!Number.isFinite(valor) || valor === 0) { mensagem.erro(new Error('Informe o valor.')); return; }
    if (!ls.senha) { mensagem.erro(new Error('Favor informar a senha.')); return; }
    setBusy(true);
    try {
      await lancarSaldo({ codconta: Number(conta), valor, idpgto: Number(ls.idpgto), historico: ls.historico || undefined, data: ls.data, senhaAdm: ls.senha });
      mensagem.sucesso('Transação efetuada com sucesso!');
      setLs({ ...ls, valor: '', senha: '' });
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
    const msg = transferencia(m) ? 'Deseja remover a transferência? As duas movimentações do lote serão apagadas.' : 'Deseja remover registro?';
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const r = await estornar(m.codmovconta);
      mensagem.sucesso(`Removido — ${r.removidos} movimentação(ões).`);
      await carregar(Number(conta));
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  // "Liberar Movimentações" (uControleContasBancarias.pas:197-278): a pesquisa dos a prazo em multisseleção e uma data
  const abrirLiberacao = async () => {
    if (!sel) return;
    try { setALiberar({ itens: await listarALiberar(sel.codconta), marcados: new Set(), data: hoje() }); } catch (e) { mensagem.erro(e); }
  };
  const liberar = async (ids: number[], data: string) => {
    if (!sel || !ids.length) return;
    setBusy(true);
    try {
      const r = await liberarMovimentos({ codconta: sel.codconta, codmovcontas: ids, data });
      if (r.liberados > 0) mensagem.sucesso('Alterações Realizadas com Sucesso');
      setALiberar(null);
      await carregar(sel.codconta, posicionar.ativo ? posicionar.data : undefined);
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  const mudarData = async (m: Movimento) => {
    const d = window.prompt('Nova data de liberação (AAAA-MM-DD)', hoje());
    if (!d) { mensagem.erro(new Error('Operação cancelada pelo usuário.')); return; }
    setBusy(true);
    try { await mudarDataLiberacao(m.codmovconta, d); await carregar(Number(conta)); } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  const opcoesDestino = destinos.filter((d) => String(d.codconta) !== conta).map((d) => ({ value: String(d.codconta), label: nomeDestino(d) }));
  const pode = (flag: keyof ContaCC) => !!sel && sel[flag] === 'S';
  // como o legado: a transferência sai pelo lote (UconsMovBancaria.pas:925); a movimentação sem lote, pelo cadastro (:107)
  const transferencia = (m: Movimento) => m.nrodocumento === 'TRANSFERENCIA' && Number(m.idlote ?? 0) > 0;
  const removivel = (m: Movimento) => transferencia(m) || !Number(m.idlote ?? 0);

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Controle de Contas Correntes" />
      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs">Conta</th><th className="p-pad-xs">Nº conta</th><th className="p-pad-xs">Titular</th><th className="p-pad-xs">Banco</th>
              <th className="p-pad-xs">Loja</th><th className="p-pad-xs">Dt. chaveamento</th><th className="p-pad-xs">Usuário chaveamento</th>
            </tr>
          </thead>
          <tbody>
            {contas.map((c) => (
              <tr key={c.codconta} tabIndex={0} aria-selected={String(c.codconta) === conta}
                className={`cursor-pointer border-t border-border ${String(c.codconta) === conta ? 'bg-bg-subtle font-semibold' : ''}`}
                onClick={() => escolher(String(c.codconta))} onKeyDown={(e) => { if (e.key === 'Enter') escolher(String(c.codconta)); }}>
                <td className="p-pad-xs tabular-nums">{c.codconta}</td><td className="p-pad-xs">{c.nroconta ?? ''}</td><td className="p-pad-xs">{c.titular ?? ''}</td>
                <td className="p-pad-xs">{c.banco ?? ''}{c.caixa ? ' (caixa)' : ''}</td><td className="p-pad-xs tabular-nums">{c.idempresa}</td>
                <td className="p-pad-xs tabular-nums">{c.dtchaveamento ? dia(c.dtchaveamento) : ''}</td><td className="p-pad-xs">{c.operadorchaveamento ?? ''}</td>
              </tr>
            ))}
            {!contas.length && <tr><td colSpan={7} className="p-pad-md text-fg-muted">Nenhuma conta ligada a este operador.</td></tr>}
          </tbody>
        </table>
      </div>

      {sel && (
        <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="text-body-sm text-fg-muted">
            {sel.banco ?? ''} · {sel.titular ?? ''} · Nº {sel.nroconta ?? ''}{sel.gerente ? ` · gerente ${sel.gerente}` : ''}{sel.fone1 ? ` · ${sel.fone1}` : ''}{sel.dtabertura ? ` · aberta em ${dia(sel.dtabertura)}` : ''}
          </div>
          {painel ? (
            <div className="grid grid-cols-2 gap-gp-sm sm:grid-cols-5">
              {([['Entradas', painel.entradas], ['Saídas', -painel.saidas], ['Total a prazo', painel.a_prazo], ['Saldo futuro', painel.futuro], ['Saldo atual', painel.saldo]] as Array<[string, number]>).map(([rot, v]) => (
                <div key={rot}><div className="text-body-sm text-fg-muted">{rot}</div><div className={`text-title-sm font-bold tabular-nums ${v < 0 ? 'text-danger' : 'text-fg'}`}>{brl(v)}</div></div>
              ))}
            </div>
          ) : <small className="text-fg-muted">Sem permissão para ver os saldos desta conta.</small>}
          <div className="flex flex-wrap items-end gap-gp-sm">
            <CheckboxField label="Posicionar saldo nesta data" value={posicionar.ativo ? 'S' : 'N'}
              onChange={(v) => { const n = { ...posicionar, ativo: v === 'S' }; setPosicionar(n); void carregar(sel.codconta, n.ativo ? n.data : undefined); }} />
            <div className="w-44"><DateField label="Data" value={posicionar.data}
              onChange={(v) => { const n = { ...posicionar, data: v ?? hoje() }; setPosicionar(n); if (n.ativo) void carregar(sel.codconta, n.data); }} /></div>
          </div>
        </div>
      )}

      {sel && (
        <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex flex-wrap items-center gap-gp-sm">
            <div className="text-body-sm font-semibold text-fg-muted">Movimentos a prazo</div>
            <div className="flex-1" />
            {!aLiberar && <Button label="Liberar &movimentações" variant="soft" disabled={busy || !pode('habiltiar_libe_moviment')} onClick={() => void abrirLiberacao()} />}
          </div>
          {aLiberar && (
            <>
              {aLiberar.itens.length === 0 ? <small className="text-fg-muted">Nenhum movimento a prazo nesta conta.</small> : (
                <div className="max-h-72 overflow-auto rounded-md border border-border">
                  <table className="w-full text-body-sm">
                    <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs" /><th className="p-pad-xs">Emissão</th><th className="p-pad-xs">Vencimento</th><th className="p-pad-xs">Documento</th><th className="p-pad-xs">Histórico</th><th className="p-pad-xs">Modalidade</th><th className="p-pad-xs text-right">Valor</th></tr></thead>
                    <tbody>
                      {aLiberar.itens.map((m) => (
                        <tr key={m.codmovconta} className="border-t border-border">
                          <td className="p-pad-xs"><CheckboxField label="Liberar" value={aLiberar.marcados.has(m.codmovconta) ? 'S' : 'N'}
                            onChange={() => { const x = new Set(aLiberar.marcados); if (x.has(m.codmovconta)) x.delete(m.codmovconta); else x.add(m.codmovconta); setALiberar({ ...aLiberar, marcados: x }); }} /></td>
                          <td className="p-pad-xs tabular-nums">{dia(m.dtemissao)}</td><td className="p-pad-xs tabular-nums">{dia(m.dtvenc)}</td><td className="p-pad-xs">{m.nrodocumento ?? ''}</td>
                          <td className="p-pad-xs">{m.historico ?? ''}</td><td className="p-pad-xs">{m.modalidade ?? ''}</td>
                          <td className={`p-pad-xs text-right tabular-nums ${m.valor < 0 ? 'text-danger' : ''}`}>{brl(m.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-gp-sm">
                <div className="w-44"><DateField label="Data da liberação" value={aLiberar.data} onChange={(v) => setALiberar({ ...aLiberar, data: v ?? hoje() })} /></div>
                <Button label="Cancelar" variant="ghost" onClick={() => setALiberar(null)} />
                <Button label="&Liberar" disabled={busy || aLiberar.marcados.size === 0} onClick={() => void liberar([...aLiberar.marcados], aLiberar.data)} />
              </div>
            </>
          )}
        </div>
      )}

      {conta && (
        <div className="grid grid-cols-1 gap-gp-md md:grid-cols-2">
          <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="text-body-sm font-semibold text-fg-muted">Lançamento de saldo</div>
            <SelectField label="&Modalidade" value={ls.idpgto} onChange={(v) => setLs({ ...ls, idpgto: v })} options={modalidades.map((m) => ({ value: String(m.idpgto), label: m.modalidade }))} placeholder="(modalidade)" />
            <div className="flex flex-wrap gap-gp-sm">
              <div className="w-40"><Field label="&Valor (− débito)" inputMode="decimal" value={ls.valor} onChange={(e) => setLs({ ...ls, valor: e.target.value })} /></div>
              <div className="w-40"><DateField label="Data" value={ls.data} onChange={(v) => setLs({ ...ls, data: v ?? hoje() })} /></div>
              <div className="flex-1"><Field label="&Histórico" value={ls.historico} onChange={(e) => setLs({ ...ls, historico: e.target.value })} /></div>
            </div>
            <div className="w-56"><Field label="Senha administrativa" type="password" value={ls.senha} onChange={(e) => setLs({ ...ls, senha: e.target.value })} /></div>
            <div><Button label="&Efetuar" variant="soft" disabled={busy || !ls.idpgto || !ls.valor || !pode('habiltiar_lanca_saldo')} onClick={() => void lancarMov()} /></div>
          </div>

          <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="text-body-sm font-semibold text-fg-muted">Transferência (débito nesta conta → crédito no destino)</div>
            <SelectField label="Conta de &destino" value={destino} onChange={setDestino} options={opcoesDestino} placeholder="(conta destino)" />
            <div className="flex gap-gp-sm">
              <div className="w-40"><NumberField label="&Valor" value={valorT} decimais={2} min={0} onChange={setValorT} /></div>
              <div className="flex-1"><Field label="&Histórico" value={histT} onChange={(e) => setHistT(e.target.value)} placeholder="descrição" /></div>
            </div>
            <div><Button label="&Transferir" variant="soft" disabled={busy || !destino || !valorT || !pode('habilitar_tranfer')} onClick={() => void transferirMov()} /></div>
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
                  <td className="p-pad-xs tabular-nums">{dia(m.dtemissao ?? m.data_fechamento)}{m.hora && m.hora !== '00:00' ? ` ${m.hora}` : ''}</td>
                  <td className="p-pad-xs">{m.historico ?? '—'}{m.mov_conciliado === 'S' ? ' 🔒' : ''}</td>
                  <td className="p-pad-xs text-fg-muted">{m.origem ?? '—'}</td>
                  <td className={`p-pad-xs text-right tabular-nums ${m.valor_com_sinal < 0 ? 'text-danger' : 'text-fg'}`}>{m.valor_com_sinal < 0 ? '−' : '+'}{brl(Math.abs(m.valor_com_sinal))}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(m.saldo_corrente)}</td>
                  <td className="p-pad-xs text-right">
                    {/* o menu da linha do detalhamento: liberar (UconsMovBancaria.pas:769), mudar a data (:870) e remover */}
                    {m.a_prazo && pode('habiltiar_libe_moviment') && <Button label="Liberar" variant="ghost" onClick={() => { const d = window.prompt('Data da liberação (AAAA-MM-DD)', hoje()); if (d) void liberar([m.codmovconta], d); else mensagem.erro(new Error('Operação cancelada pelo usuário.')); }} />}
                    {!m.a_prazo && <Button label="Mudar data" variant="ghost" onClick={() => void mudarData(m)} />}
                    {removivel(m) && <Button label="Remover" variant="ghost" onClick={() => void estornarMov(m)} />}
                  </td>
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
