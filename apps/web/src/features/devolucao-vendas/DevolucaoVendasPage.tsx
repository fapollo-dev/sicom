import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * DEVOLUÇÃO DE VENDAS (`FRMDEVOLUCAOVENDAS`). Dossiê: `uDevolucaoVendas.md`.
 * O cliente volta com mercadoria comprada: acha-se o cupom, marcam-se os itens e o motivo, e registra.
 * O estoque NÃO volta aqui — quem devolve estoque é a NF de devolução (regra do legado).
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qt = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);

interface Item {
  codvendas: number; nroitem: number; nropedido: string | null; nrocupom: number | null; nroserie: string | null;
  dtvenda: string; codproduto: number; descricao: string; codbarra: string | null; qtde: number; vrvenda: number;
  totalItem: number; devolvido: boolean; qtdeDevolvido: number; totalItemDevolvido: number;
  coddevolucaovenda: number | null; datadevolucao: string | null; operadorDevolucao: string | null; motivo: string | null;
}
interface Busca { itens: Item[]; truncado: boolean; totais: { itens: number; devolvidos: number; valor: number; valorDevolvido: number } }
interface Motivo { codmotivoop: number; descricao: string }
interface Consulta { itens: Array<Record<string, unknown>>; totais: { devolucoes: number; valor: number; semMotivo: number } }

const chave = (i: { codvendas: number; nroitem: number; codproduto: number }) => `${i.codvendas}-${i.nroitem}-${i.codproduto}`;

export function DevolucaoVendasPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ nrocupom: '', nropdv: '', dataIni: '', dataFim: '' });
  const [res, setRes] = useState<Busca | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [qtdes, setQtdes] = useState<Record<string, string>>({});
  const [motivos, setMotivos] = useState<Motivo[]>([]);
  const [motivo, setMotivo] = useState('');
  const [hist, setHist] = useState<Consulta | null>(null);
  const [periodo, setPeriodo] = useState({ dataIni: `${hoje().slice(0, 8)}01`, dataFim: hoje() });
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
  useEffect(() => { pedir<Motivo[]>(`${BASE}/relatorios/devolucao-vendas/motivos`).then(setMotivos).catch((e) => mensagem.erro(e)); }, []);

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      for (const k of ['nrocupom', 'nropdv', 'dataIni', 'dataFim'] as const) if (f[k].trim()) q.set(k, f[k].trim());
      const r = await pedir<Busca>(`${BASE}/relatorios/devolucao-vendas/venda?${q}`);
      setRes(r); setSel(new Set());
      setQtdes(Object.fromEntries(r.itens.map((i) => [chave(i), String(i.qtde)])));
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const alternar = (k: string) => { const n = new Set(sel); if (n.has(k)) n.delete(k); else n.add(k); setSel(n); };
  const acao = async (tipo: 'registrar' | 'reverter') => {
    const alvo = (res?.itens ?? []).filter((i) => sel.has(chave(i)));
    if (!alvo.length) return mensagem.erro(new Error('Marque ao menos um item.'));
    const pergunta = tipo === 'registrar'
      ? `Registrar a devolução de ${alvo.length} item(ns)? O estoque NÃO é alterado — isso é a NF de devolução.`
      : `Reverter ${alvo.length} registro(s) de devolução?`;
    if (!window.confirm(pergunta)) return;
    setOcupado(true);
    try {
      const corpo = tipo === 'registrar'
        ? { codmotivoop: motivo ? Number(motivo) : undefined, itens: alvo.map((i) => ({ codvendas: i.codvendas, nroitem: i.nroitem, codproduto: i.codproduto, qtdeDevolvido: Number((qtdes[chave(i)] ?? String(i.qtde)).replace(',', '.')) })) }
        : { itens: alvo.map((i) => ({ codvendas: i.codvendas, nroitem: i.nroitem, codproduto: i.codproduto })) };
      await pedir(`${BASE}/relatorios/devolucao-vendas/${tipo}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
      mensagem.sucesso(tipo === 'registrar' ? 'Devolução registrada.' : 'Devolução revertida.');
      await buscar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const verHistorico = async () => {
    try { setHist(await pedir<Consulta>(`${BASE}/relatorios/devolucao-vendas?${new URLSearchParams(periodo)}`)); } catch (e) { mensagem.erro(e); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Devolução de vendas" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">Ache o cupom, marque os itens que o cliente devolveu e informe o motivo. <strong>O estoque não é alterado aqui</strong> — quem devolve mercadoria ao estoque é a nota fiscal de devolução.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-32"><Field label="&Cupom" value={f.nrocupom} onChange={(e) => setF({ ...f, nrocupom: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="w-24"><Field label="&PDV" value={f.nropdv} onChange={(e) => setF({ ...f, nropdv: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="w-40"><Field label="Venda &de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <Button label="&Buscar" disabled={ocupado} onClick={() => void buscar()} />
          <div className="w-64">
            <label className="mb-1 block text-body-sm text-fg-muted">Motivo</label>
            <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              <option value="">— sem motivo —</option>
              {motivos.map((m) => <option key={m.codmotivoop} value={m.codmotivoop}>{m.descricao}</option>)}
            </select>
          </div>
          <Button label="&Registrar devolução" disabled={ocupado || sel.size === 0} onClick={() => void acao('registrar')} />
          <Button label="Re&verter" variant="outline" disabled={ocupado || sel.size === 0} onClick={() => void acao('reverter')} />
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-md text-body-sm">
              <span>Itens <strong className="tabular-nums">{res.totais.itens}</strong></span>
              <span>Valor <strong className="tabular-nums">{moeda(res.totais.valor)}</strong></span>
              <span>Já devolvidos <strong className="tabular-nums">{res.totais.devolvidos}</strong> ({moeda(res.totais.valorDevolvido)})</span>
              <span>Marcados <strong className="tabular-nums">{sel.size}</strong></span>
              {res.truncado && <span className="text-fg-danger">lista truncada</span>}
            </div>
          </section>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full min-w-[1000px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs"></th><th className="p-pad-xs">Venda</th><th className="p-pad-xs">Cupom</th><th className="p-pad-xs">Item</th>
                <th className="p-pad-xs">Produto</th><th className="p-pad-xs text-right">Qtde</th><th className="p-pad-xs text-right">Preço</th><th className="p-pad-xs text-right">Total</th>
                <th className="p-pad-xs text-right">Devolver</th><th className="p-pad-xs">Situação</th>
              </tr></thead>
              <tbody>{res.itens.map((i) => {
                const k = chave(i);
                return (
                  <tr key={k} className={`border-b border-border ${i.devolvido ? 'bg-bg-muted' : ''}`}>
                    <td className="p-pad-xs"><input type="checkbox" checked={sel.has(k)} onChange={() => alternar(k)} /></td>
                    <td className="p-pad-xs">{dataBr(i.dtvenda)}</td><td className="p-pad-xs tabular-nums">{i.nrocupom ?? ''}</td><td className="p-pad-xs tabular-nums">{i.nroitem}</td>
                    <td className="p-pad-xs">{i.codproduto} · {i.descricao}</td>
                    <td className="p-pad-xs text-right tabular-nums">{qt(i.qtde)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(i.vrvenda)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{moeda(i.totalItem)}</td>
                    <td className="p-pad-xs text-right">
                      <input className="w-20 rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-right tabular-nums" disabled={i.devolvido}
                             value={qtdes[k] ?? ''} onChange={(e) => setQtdes({ ...qtdes, [k]: e.target.value })} />
                    </td>
                    <td className="p-pad-xs">{i.devolvido ? `devolvido ${qt(i.qtdeDevolvido)}${i.motivo ? ` · ${i.motivo}` : ''}` : ''}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </>
      )}

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <h4 className="pb-2 text-body-sm font-semibold">Devoluções do período</h4>
          <div className="w-40"><Field label="De" type="date" value={periodo.dataIni} onChange={(e) => setPeriodo({ ...periodo, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="Até" type="date" value={periodo.dataFim} onChange={(e) => setPeriodo({ ...periodo, dataFim: e.target.value })} /></div>
          <Button label="&Listar" variant="outline" onClick={() => void verHistorico()} />
          {hist && <span className="pb-2 text-body-sm text-fg-muted">{hist.totais.devolucoes} devolução(ões) · {moeda(hist.totais.valor)}{hist.totais.semMotivo > 0 ? ` · ${hist.totais.semMotivo} sem motivo` : ''}</span>}
        </div>
        {hist && hist.itens.length > 0 && (
          <div className="mt-form-gap overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Quando</th><th className="p-pad-xs">Operador</th><th className="p-pad-xs">Cupom</th><th className="p-pad-xs">Produto</th><th className="p-pad-xs text-right">Qtde</th><th className="p-pad-xs text-right">Total</th><th className="p-pad-xs">Motivo</th></tr></thead>
              <tbody>{hist.itens.map((d) => (
                <tr key={String(d.coddevolucaovenda)} className="border-b border-border">
                  <td className="p-pad-xs">{dataBr(d.datadevolucao)}</td><td className="p-pad-xs">{String(d.operador ?? '')}</td>
                  <td className="p-pad-xs tabular-nums">{String(d.nrocupom ?? '')}</td><td className="p-pad-xs">{String(d.codproduto)} · {String(d.descricao ?? '')}</td>
                  <td className="p-pad-xs text-right tabular-nums">{qt(d.qtdeDevolvido)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(d.total)}</td>
                  <td className={`p-pad-xs ${d.motivo ? '' : 'text-fg-muted'}`}>{String(d.motivo ?? 'sem motivo')}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
