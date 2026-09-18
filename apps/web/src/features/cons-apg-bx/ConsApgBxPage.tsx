import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * CONSULTA DE BAIXAS DO A PAGAR POR LOTE (`FRMCONSAPGBX`).
 * Dossiê: `uConsAPGbx.md`.
 *
 * A busca lista os lotes do período; abrir um lote mostra os títulos baixados e o movimento bancário, e o
 * botão **Reverter baixa** desfaz o lote inteiro numa transação (como o legado). Lote revertido fica marcado.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioDoMes = () => `${hoje().slice(0, 8)}01`;

interface LoteResumo { lote: number; semLote: boolean; dataPagamento: string; titulos: number; valorPago: number; juros: number; fornecedores: number; razoes: string; operadorBaixa: string | null; revertido: boolean; parcialmenteRevertido: boolean }
interface Titulo extends Record<string, unknown> { codapg: number; duplicata: string; fornecedor: string; emissao: string; vencimento: string; data_pagamento: string; valorDocumento: number; valorpg: number; juros: number; operador_baixa: string | null; revertida: boolean; revertida_em: string | null; revertida_por: string | null }
interface Movimento extends Record<string, unknown> { codmovconta: number; nroconta: string | null; titular: string | null; valor: number; tipomovimento: string; dtemissao: string; historico: string; contraMovimento: boolean }
interface Detalhe { lote: number; semLote: boolean; revertido: boolean; parcialmenteRevertido: boolean; titulos: Titulo[]; movimentos: Movimento[]; totais: { titulos: number; valorPago: number; juros: number; valorDocumento: number } }

export function ConsApgBxPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: inicioDoMes(), dataFim: hoje(), codparceiro: '', situacao: 'todos' });
  const [lotes, setLotes] = useState<LoteResumo[] | null>(null);
  const [det, setDet] = useState<Detalhe | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const pedir = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(url, { ...init, headers: { ...apiHeaders(), ...(init?.headers ?? {}) } });
    handle401(r);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
      throw Object.assign(new Error(env.code), { envelope: env });
    }
    return (await r.json()) as T;
  };

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim, situacao: f.situacao });
      if (f.codparceiro.trim()) q.set('codparceiro', f.codparceiro.trim());
      setDet(null);
      setLotes((await pedir<{ lotes: LoteResumo[] }>(`${BASE}/cobranca/cons-apg-bx/lotes?${q}`)).lotes);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const abrir = async (lote: number) => {
    setOcupado(true);
    try { setDet(await pedir<Detalhe>(`${BASE}/cobranca/cons-apg-bx/${lote}`)); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const reverter = async () => {
    if (!det) return;
    if (!window.confirm('Tem certeza que deseja reverter todos os documentos deste lote?')) return;
    setOcupado(true);
    try {
      const r = await pedir<{ titulosRevertidos: number; contraMovimentos: number }>(`${BASE}/cobranca/cons-apg-bx/${det.lote}/reverter`, { method: 'POST' });
      mensagem.sucesso(`Reversão realizada: ${r.titulosRevertidos} título(s) reaberto(s), ${r.contraMovimentos} contra-movimento(s) bancário(s).`);
      await abrir(det.lote); await buscar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Baixas do contas a pagar" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Os lotes de baixa do período. Abra um lote para ver os títulos baixados e o movimento da conta bancária;
          <strong> Reverter baixa</strong> desfaz o lote inteiro, de uma vez.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-32"><Field label="&Fornecedor" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value })} /></div>
          <div className="w-40">
            <label className="mb-1 block text-body-sm text-fg-muted">Situação</label>
            <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value })}>
              <option value="todos">Todos</option><option value="ativos">Ativos</option><option value="revertidos">Revertidos</option>
            </select>
          </div>
          <Button label="&Buscar lotes" disabled={ocupado} onClick={() => void buscar()} />
        </div>
      </section>

      {lotes && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full min-w-[900px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Lote</th><th className="p-pad-xs">Pagamento</th><th className="p-pad-xs text-right">Títulos</th>
                <th className="p-pad-xs">Fornecedores</th><th className="p-pad-xs text-right">Pago</th><th className="p-pad-xs text-right">Juros</th>
                <th className="p-pad-xs">Operador</th><th className="p-pad-xs">Situação</th>
              </tr>
            </thead>
            <tbody>
              {lotes.length === 0 && <tr><td colSpan={8} className="p-pad-md text-center text-fg-muted">Nenhum lote no período.</td></tr>}
              {lotes.map((l) => (
                <tr key={l.lote} onClick={() => void abrir(l.lote)} className={`cursor-pointer border-b border-border hover:bg-bg-subtle ${det?.lote === l.lote ? 'bg-bg-subtle font-semibold' : ''}`}>
                  <td className="p-pad-xs tabular-nums">{l.semLote ? <span className="text-fg-muted">(baixa avulsa)</span> : l.lote}</td>
                  <td className="p-pad-xs">{dataBr(l.dataPagamento)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{l.titulos}</td>
                  <td className="p-pad-xs">{l.fornecedores > 1 ? `${l.fornecedores} — ${l.razoes}` : l.razoes}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.valorPago)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.juros)}</td>
                  <td className="p-pad-xs">{l.operadorBaixa ?? ''}</td>
                  <td className="p-pad-xs">{l.revertido ? <span className="font-semibold text-fg-danger">Revertido</span> : l.parcialmenteRevertido ? 'Parcial' : 'Ativo'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {det && (
        <>
          <div className="flex flex-wrap items-center gap-gp-sm">
            <h3 className="text-body-sm font-semibold">{det.semLote ? 'Baixa avulsa' : `Lote ${det.lote}`} · {det.totais.titulos} título(s) · pago {moeda(det.totais.valorPago)}</h3>
            {det.revertido ? <span className="rounded-radius-sm border border-border px-pad-sm py-pad-xs text-body-sm font-semibold text-fg-danger">Lote revertido</span>
              : <Button label="&Reverter baixa" variant="outline" disabled={ocupado} onClick={() => void reverter()} />}
          </div>

          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <h4 className="p-pad-xs text-body-sm font-semibold">Títulos baixados</h4>
            <table className="w-full min-w-[900px] border-collapse text-body-sm">
              <thead>
                <tr className="border-b border-border text-left text-fg-muted">
                  <th className="p-pad-xs">Documento</th><th className="p-pad-xs">Fornecedor</th><th className="p-pad-xs">Emissão</th><th className="p-pad-xs">Vencimento</th>
                  <th className="p-pad-xs">Pagamento</th><th className="p-pad-xs text-right">Valor</th><th className="p-pad-xs text-right">Pago</th><th className="p-pad-xs text-right">Juros</th>
                  <th className="p-pad-xs">Operador</th><th className="p-pad-xs">Situação</th>
                </tr>
              </thead>
              <tbody>
                {det.titulos.map((t) => (
                  <tr key={t.codapg} className={`border-b border-border ${t.revertida ? 'text-fg-muted' : ''}`}>
                    <td className="p-pad-xs">{t.duplicata}</td><td className="p-pad-xs">{t.fornecedor}</td>
                    <td className="p-pad-xs">{dataBr(t.emissao)}</td><td className="p-pad-xs">{dataBr(t.vencimento)}</td><td className="p-pad-xs">{dataBr(t.data_pagamento)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{moeda(t.valorDocumento)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(t.valorpg)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(t.juros)}</td>
                    <td className="p-pad-xs">{t.operador_baixa ?? ''}</td>
                    <td className="p-pad-xs">{t.revertida ? `Revertida ${t.revertida_em ? dataBr(t.revertida_em) : ''} ${t.revertida_por ?? ''}` : 'Baixada'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <h4 className="p-pad-xs text-body-sm font-semibold">Movimento da conta bancária</h4>
            {det.movimentos.length === 0 ? <p className="p-pad-xs text-body-sm text-fg-muted">Sem movimento bancário neste lote.</p> : (
              <table className="w-full min-w-[820px] border-collapse text-body-sm">
                <thead>
                  <tr className="border-b border-border text-left text-fg-muted">
                    <th className="p-pad-xs">Data</th><th className="p-pad-xs">Conta</th><th className="p-pad-xs">Titular</th><th className="p-pad-xs">Tipo</th>
                    <th className="p-pad-xs text-right">Valor</th><th className="p-pad-xs">Histórico</th>
                  </tr>
                </thead>
                <tbody>
                  {det.movimentos.map((m) => (
                    <tr key={m.codmovconta} className={`border-b border-border ${m.contraMovimento ? 'text-fg-danger' : ''}`}>
                      <td className="p-pad-xs">{dataBr(m.dtemissao)}</td><td className="p-pad-xs">{m.nroconta ?? ''}</td><td className="p-pad-xs">{m.titular ?? ''}</td>
                      <td className="p-pad-xs">{m.tipomovimento === 'D' ? 'Débito' : 'Crédito'}</td>
                      <td className="p-pad-xs text-right tabular-nums">{moeda(m.valor)}</td><td className="p-pad-xs">{m.historico}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
