import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * PRECIFICAÇÃO PELA NF BRUTA (`FRMPRECIFICACAONFBRUTA`). Dossiê: `uPrecificacaoNFBruta.md`.
 * Os itens da nota de entrada com preço atual, custo, PMZ, preço sugerido e markup fixo. Aplicar não muda
 * preço: enfileira o lote (como toda a precificação do Apollo) e grava o markup fixo do produto.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));

interface Item {
  codnfprod: number; codnf: number; nronf: string; dtemissao: string; fornecedor: string | null;
  idproduto: number; codbarra: string | null; descricao: string; quantidade: number; ultcusto: number;
  pmz: number; vrcusto: number; vrvenda: number; vrvendasug: number; markupfixo: number;
  temSugestao: boolean; diferenca: number;
}
interface Consulta { itens: Item[]; truncado: boolean; totais: { itens: number; comSugestao: number; semPreco: number; semMarkupFixo: number } }

export function PrecificacaoNfBrutaPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ nronf: '', dataIni: '', dataFim: '', codparceiro: '', somenteComSugestao: false });
  const [res, setRes] = useState<Consulta | null>(null);
  const [edit, setEdit] = useState<Record<number, { vrvenda: string; markupfixo: string }>>({});
  const [sel, setSel] = useState<Set<number>>(new Set());
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
      const q = new URLSearchParams({ somenteComSugestao: String(f.somenteComSugestao) });
      for (const k of ['nronf', 'dataIni', 'dataFim', 'codparceiro'] as const) if (f[k].trim()) q.set(k, f[k].trim());
      const r = await pedir<Consulta>(`${BASE}/precificacao/nf-bruta?${q}`);
      setRes(r);
      setEdit(Object.fromEntries(r.itens.map((i) => [i.idproduto, { vrvenda: String(i.vrvendasug > 0 ? i.vrvendasug : i.vrvenda), markupfixo: String(i.markupfixo) }])));
      setSel(new Set(r.itens.filter((i) => i.temSugestao).map((i) => i.idproduto)));
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const aplicar = async () => {
    const itens = (res?.itens ?? []).filter((i) => sel.has(i.idproduto)).map((i) => ({
      idproduto: i.idproduto,
      vrvenda: Number((edit[i.idproduto]?.vrvenda ?? '0').replace(',', '.')),
      markupfixo: edit[i.idproduto]?.markupfixo.trim() ? Number(edit[i.idproduto].markupfixo.replace(',', '.')) : undefined,
      nronf: i.nronf,
    })).filter((i) => i.vrvenda > 0);
    if (itens.length === 0) return mensagem.erro(new Error('Marque ao menos um item com preço válido.'));
    if (!window.confirm(`Enfileirar ${itens.length} preço(s) e gravar o markup fixo? O preço só muda quando o lote for processado.`)) return;
    setOcupado(true);
    try {
      const r = await pedir<{ totais: { lotes: number; markupsAtualizados: number } }>(`${BASE}/precificacao/nf-bruta/aplicar`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itens }),
      });
      mensagem.sucesso(`${r.totais.lotes} preço(s) na fila; ${r.totais.markupsAtualizados} markup(s) fixo(s) gravado(s).`);
      await buscar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const alternar = (id: number) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Precificação pela nota" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">Os itens da nota de entrada com o preço atual, o custo de reposição, o PMZ e o preço sugerido. Aplicar <strong>não muda o preço</strong>: coloca o preço novo na fila de lotes e grava o markup fixo do produto.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-36"><Field label="&Nº da nota" value={f.nronf} onChange={(e) => setF({ ...f, nronf: e.target.value })} /></div>
          <div className="w-40"><Field label="Emissão &de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-32"><Field label="&Fornecedor" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value.replace(/\D/g, '') })} /></div>
          <label className="flex items-center gap-1 pb-2 text-body-sm"><input type="checkbox" checked={f.somenteComSugestao} onChange={(e) => setF({ ...f, somenteComSugestao: e.target.checked })} /> só com sugestão</label>
          <Button label="&Consultar" disabled={ocupado} onClick={() => void buscar()} />
          <Button label="&Aplicar" disabled={ocupado || sel.size === 0} onClick={() => void aplicar()} />
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-md text-body-sm">
              <span>Itens <strong className="tabular-nums">{res.totais.itens}</strong></span>
              <span>Com sugestão <strong className="tabular-nums">{res.totais.comSugestao}</strong></span>
              <span>Marcados <strong className="tabular-nums">{sel.size}</strong></span>
              {res.totais.semPreco > 0 && <span className="text-fg-danger">Sem preço cadastrado {res.totais.semPreco}</span>}
              {res.totais.semMarkupFixo > 0 && <span className="text-fg-muted">Sem markup fixo {res.totais.semMarkupFixo}</span>}
              {res.truncado && <span className="text-fg-danger">lista truncada</span>}
            </div>
          </section>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full min-w-[1100px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs"><input type="checkbox" checked={sel.size === res.itens.length && res.itens.length > 0} onChange={(e) => setSel(e.target.checked ? new Set(res.itens.map((i) => i.idproduto)) : new Set())} /></th>
                <th className="p-pad-xs">Nota</th><th className="p-pad-xs">Emissão</th><th className="p-pad-xs">Produto</th>
                <th className="p-pad-xs text-right">Qtde</th><th className="p-pad-xs text-right">Custo rep.</th><th className="p-pad-xs text-right">PMZ</th>
                <th className="p-pad-xs text-right">Preço atual</th><th className="p-pad-xs text-right">Sugerido</th><th className="p-pad-xs text-right">Novo preço</th><th className="p-pad-xs text-right">Markup fixo</th>
              </tr></thead>
              <tbody>{res.itens.map((i) => (
                <tr key={i.codnfprod} className={`border-b border-border ${i.temSugestao ? '' : 'text-fg-muted'}`}>
                  <td className="p-pad-xs"><input type="checkbox" checked={sel.has(i.idproduto)} onChange={() => alternar(i.idproduto)} /></td>
                  <td className="p-pad-xs tabular-nums">{i.nronf}</td><td className="p-pad-xs">{dataBr(i.dtemissao)}</td>
                  <td className="p-pad-xs">{i.idproduto} · {i.descricao}</td>
                  <td className="p-pad-xs text-right tabular-nums">{i.quantidade}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(i.vrcusto)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(i.pmz)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(i.vrvenda)}</td>
                  <td className={`p-pad-xs text-right tabular-nums ${i.temSugestao ? 'font-semibold' : ''}`}>{i.vrvendasug > 0 ? moeda(i.vrvendasug) : ''}</td>
                  <td className="p-pad-xs text-right">
                    <input className="w-24 rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-right tabular-nums"
                           value={edit[i.idproduto]?.vrvenda ?? ''} onChange={(e) => setEdit({ ...edit, [i.idproduto]: { ...edit[i.idproduto], vrvenda: e.target.value } })} />
                  </td>
                  <td className="p-pad-xs text-right">
                    <input className="w-20 rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-right tabular-nums"
                           value={edit[i.idproduto]?.markupfixo ?? ''} onChange={(e) => setEdit({ ...edit, [i.idproduto]: { ...edit[i.idproduto], markupfixo: e.target.value } })} />
                  </td>
                </tr>))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
