import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: (body as any)?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as T;
}

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (n: unknown) => `${(Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

interface Painel {
  vrcustoreal: number; vrcustorep: number; vrcustocsi: number; creditoicm: number; creditopiscofins: number;
  pmz: number; vrvendasug: number; markup: number; vrvenda: number;
  debitoicm: number; debitopiscofins: number; vendaliq: number; lucrobrutov: number; lucrobrutop: number;
  despopv: number; lucroliqv: number; lucroliqp: number; imprend: number; contsocial: number;
  margeml2v: number; margeml2: number; markdown: number;
}
interface Comp { vrcusto: number; icme?: number; ipi?: number; frete?: number; frete2?: number; seguro?: number; icmst?: number; vrfcpst?: number; despacessorio?: number; vrcustoajuste?: number; bonificacao?: number }
interface Abertura { produto: { idproduto: number; codbarra?: string; descricao?: string }; preco: Record<string, unknown>; empresas: Array<{ idempresa: number; fantasia?: string; qtde?: number }>; painel: Painel; modo_lote_default: boolean }

/**
 * PRECIFICAÇÃO DE MERCADORIAS (FRMPRIFICACAOCUSTO) — corte-1. Painel por produto × empresa: o operador completa os
 * COMPONENTES de custo (percentuais e valores) e a tela deriva as 3 bases (real/reposição/CSI), o PMZ, o preço
 * SUGERIDO (motor fiscal) e a escada de margem; então digita o preço de venda. «Salvar» grava nas empresas marcadas;
 * em modo LOTE o preço vai p/ a fila do Ajuste de Preços (o resto do painel grava). Atacarejo/2-cliques adiados.
 */
export function PrecificacaoCustoPage() {
  const mensagem = useMensagem();
  const [busca, setBusca] = useState('');
  const [ab, setAb] = useState<Abertura | null>(null);
  const [comp, setComp] = useState<Comp>({ vrcusto: 0 });
  const [markup, setMarkup] = useState<number | undefined>();
  const [venda, setVenda] = useState<number | undefined>();
  const [painel, setPainel] = useState<Painel | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [lote, setLote] = useState(false);
  const [busy, setBusy] = useState(false);

  const abrir = async () => {
    const id = Number(busca.trim());
    if (!Number.isFinite(id) || id <= 0) { window.alert('Informe o código (id) do produto.'); return; }
    setBusy(true);
    try {
      const a = await req<Abertura>(`/precificacao/custo/${id}`);
      setAb(a); setPainel(a.painel);
      const p = a.preco as any;
      setComp({ vrcusto: Number(p.vrcusto ?? 0), icme: Number(p.icme ?? 0), ipi: Number(p.ipi ?? 0), frete: Number(p.frete ?? 0), frete2: Number(p.frete2 ?? 0), seguro: Number(p.seguro ?? 0), icmst: Number(p.icmst ?? 0), vrfcpst: Number(p.vrfcpst ?? 0), despacessorio: Number(p.despacessorio ?? 0), vrcustoajuste: Number(p.vrcustoajuste ?? 0), bonificacao: Number(p.bonificacao ?? 0) });
      setMarkup(Number(p.markup ?? 0)); setVenda(Number(p.vrvenda ?? 0));
      setSel(new Set(a.empresas.map((e) => e.idempresa))); setLote(a.modo_lote_default);
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const recalcular = async (patch: Partial<Comp> = {}, mk = markup, vd = venda) => {
    if (!ab) return;
    const c = { ...comp, ...patch };
    setComp(c);
    try {
      setPainel(await req<Painel>('/precificacao/custo/calcular', { method: 'POST', body: JSON.stringify({ ...c, idproduto: ab.produto.idproduto, markup: mk ?? 0, vrvenda: vd ?? 0 }) }));
    } catch (e) { mensagem.erro(e); }
  };

  const aplicarSugerido = () => { if (painel) { setVenda(painel.vrvendasug); void recalcular({}, markup, painel.vrvendasug); } };

  const salvar = async () => {
    if (!ab || busy) return;
    if (!sel.size) { window.alert('Marque ao menos uma empresa.'); return; }
    if (!window.confirm(lote ? `Gerar LOTE de preço ${brl(venda)} para ${sel.size} empresa(s)? O preço atual NÃO muda — vai para a fila do Ajuste de Preços.` : `Aplicar o preço ${brl(venda)} em ${sel.size} empresa(s) agora?`)) return;
    setBusy(true);
    try {
      const r = await req<{ lotes: number; historico: number }>('/precificacao/custo/salvar', { method: 'POST', body: JSON.stringify({ ...comp, idproduto: ab.produto.idproduto, empresas: [...sel], markup: markup ?? 0, vrvenda: venda ?? 0, modoLote: lote }) });
      mensagem.sucesso(lote ? `${r.lotes} lote(s) de preço enfileirado(s).` : `Preço aplicado. ${r.historico} alteração(ões) auditada(s).`);
      setBusca(String(ab.produto.idproduto)); await abrir();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const Linha = ({ rot, val, forte = false, p = false }: { rot: string; val: unknown; forte?: boolean; p?: boolean }) => (
    <div className={`flex justify-between border-b border-border py-0.5 ${forte ? 'font-semibold' : ''}`}>
      <span className="text-fg-muted">{rot}</span><span className="tabular-nums">{p ? pct(val) : brl(val)}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Precificação de Mercadorias" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-56"><Field label="&Produto (id)" value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void abrir(); }} placeholder="código + Enter" /></div>
        <Button label="&Abrir" variant="soft" disabled={busy} onClick={() => void abrir()} />
        {ab && <div className="flex-1 text-body-sm"><b>{ab.produto.descricao}</b><br /><span className="text-fg-muted">{ab.produto.codbarra}</span></div>}
        {ab && <label className="flex items-center gap-1 text-body-sm"><input type="checkbox" checked={lote} onChange={(e) => setLote(e.target.checked)} /> Gerar lote (não aplica agora)</label>}
        {ab && <Button label="&Salvar" variant="soft" disabled={busy} onClick={() => void salvar()} />}
      </div>

      {ab && painel && (
        <div className="grid grid-cols-1 gap-gp-md md:grid-cols-3">
          <div className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="mb-1 text-body-sm font-semibold text-fg-muted">Componentes do custo</div>
            <div className="flex flex-col gap-1">
              <NumberField label="&Custo" value={comp.vrcusto} decimais={4} onChange={(v) => void recalcular({ vrcusto: v ?? 0 })} />
              <div className="grid grid-cols-2 gap-1">
                <NumberField label="ICMS créd. %" value={comp.icme} decimais={2} onChange={(v) => void recalcular({ icme: v ?? 0 })} />
                <NumberField label="IPI %" value={comp.ipi} decimais={2} onChange={(v) => void recalcular({ ipi: v ?? 0 })} />
                <NumberField label="Frete %" value={comp.frete} decimais={2} onChange={(v) => void recalcular({ frete: v ?? 0 })} />
                <NumberField label="Seguro %" value={comp.seguro} decimais={2} onChange={(v) => void recalcular({ seguro: v ?? 0 })} />
                <NumberField label="ICMS-ST R$" value={comp.icmst} decimais={2} onChange={(v) => void recalcular({ icmst: v ?? 0 })} />
                <NumberField label="Desp. acess. R$" value={comp.despacessorio} decimais={2} onChange={(v) => void recalcular({ despacessorio: v ?? 0 })} />
                <NumberField label="Bonificação R$" value={comp.bonificacao} decimais={2} onChange={(v) => void recalcular({ bonificacao: v ?? 0 })} />
                <NumberField label="Ajuste R$" value={comp.vrcustoajuste} decimais={2} onChange={(v) => void recalcular({ vrcustoajuste: v ?? 0 })} />
              </div>
            </div>
          </div>

          <div className="rounded-radius-md border border-border bg-bg-surface p-pad-md text-body-sm">
            <div className="mb-1 font-semibold text-fg-muted">Bases &amp; preço</div>
            <Linha rot="Crédito ICMS" val={painel.creditoicm} />
            <Linha rot="Crédito PIS/COFINS" val={painel.creditopiscofins} />
            <Linha rot="Custo real (líquido)" val={painel.vrcustoreal} forte />
            <Linha rot="Custo reposição" val={painel.vrcustorep} forte />
            <Linha rot="Custo CSI (base)" val={painel.vrcustocsi} forte />
            <Linha rot="PMZ (margem zero)" val={painel.pmz} forte />
            <div className="mt-2 grid grid-cols-2 gap-1">
              <NumberField label="&Markup %" value={markup} decimais={2} onChange={(v) => { setMarkup(v); void recalcular({}, v, venda); }} />
              <NumberField label="Preço de &venda" value={venda} decimais={2} onChange={(v) => { setVenda(v); void recalcular({}, markup, v); }} />
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-fg-muted">Sugerido: <b className="text-accent tabular-nums">{brl(painel.vrvendasug)}</b></span>
              <Button label="Usar sugerido" variant="ghost" onClick={aplicarSugerido} />
            </div>
          </div>

          <div className="rounded-radius-md border border-border bg-bg-surface p-pad-md text-body-sm">
            <div className="mb-1 font-semibold text-fg-muted">Margem sobre o preço</div>
            <Linha rot="Débito ICMS" val={painel.debitoicm} />
            <Linha rot="Débito PIS/COFINS" val={painel.debitopiscofins} />
            <Linha rot="Venda líquida" val={painel.vendaliq} />
            <Linha rot="Lucro bruto" val={painel.lucrobrutov} />
            <Linha rot="Lucro bruto %" val={painel.lucrobrutop} p />
            <Linha rot="Despesa operacional" val={painel.despopv} />
            <Linha rot="Lucro após despesa" val={painel.lucroliqv} />
            <Linha rot="IR" val={painel.imprend} />
            <Linha rot="CSLL" val={painel.contsocial} />
            <Linha rot="Lucro líquido" val={painel.margeml2v} forte />
            <Linha rot="Margem líquida %" val={painel.margeml2} forte p />
            <Linha rot="Markdown %" val={painel.markdown} p />
          </div>
        </div>
      )}

      {ab && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <div className="border-b border-border p-pad-xs text-body-sm font-semibold text-fg-muted">Empresas — o preço é gravado nas marcadas</div>
          <table className="w-full text-body-sm">
            <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs w-8" /><th className="p-pad-xs">Empresa</th><th className="p-pad-xs text-right">Estoque</th></tr></thead>
            <tbody>
              {ab.empresas.map((e) => (
                <tr key={e.idempresa} className={`border-t border-border ${sel.has(e.idempresa) ? 'bg-bg-subtle' : ''}`}>
                  <td className="p-pad-xs"><input type="checkbox" checked={sel.has(e.idempresa)} onChange={() => setSel((s) => { const n = new Set(s); n.has(e.idempresa) ? n.delete(e.idempresa) : n.add(e.idempresa); return n; })} /></td>
                  <td className="p-pad-xs">{e.idempresa} — {e.fantasia ?? ''}</td>
                  <td className="p-pad-xs text-right tabular-nums">{Number(e.qtde ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
