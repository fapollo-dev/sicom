import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * CADASTRO DE FIGURAS FISCAIS (`FRMCADFIGURASFISCAIS`). Dossiê: `uCadFigurasFiscais.md`.
 * O catálogo que as regras do indexador tributário apontam. São 16.838 figuras no cliente, mas só 11
 * aparecem em alguma regra — o filtro "só em uso" mostra quais.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
type Figura = { codfigurafiscal: number; descfigurafiscal: string; codreduzido: string | null; indr: string; regras: number };
type Busca = { itens: Figura[]; total: number; emUso: number; truncado: boolean };

export function FiguraFiscalPage() {
  const mensagem = useMensagem();
  const [q, setQ] = useState('');
  const [emUso, setEmUso] = useState(false);
  const [res, setRes] = useState<Busca | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [f, setF] = useState({ descfigurafiscal: '', codreduzido: '' });
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
  const buscar = async (uso = emUso) => {
    try { setRes(await pedir<Busca>(`${BASE}/fiscal/figuras-fiscais?${new URLSearchParams({ q: q.trim(), somenteEmUso: String(uso) })}`)); } catch (e) { mensagem.erro(e); }
  };
  useEffect(() => { void buscar(); }, []);
  const novo = () => { setSel(null); setF({ descfigurafiscal: '', codreduzido: '' }); };
  const gravar = async () => {
    setOcupado(true);
    try {
      await pedir(`${BASE}/fiscal/figuras-fiscais${sel ? `/${sel}` : ''}`, { method: sel ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ descfigurafiscal: f.descfigurafiscal, codreduzido: f.codreduzido.trim() || null }) });
      mensagem.sucesso('Figura fiscal gravada.'); novo(); await buscar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const excluir = async () => {
    if (!sel || !window.confirm('Excluir esta figura fiscal?')) return;
    try { await pedir(`${BASE}/fiscal/figuras-fiscais/${sel}`, { method: 'DELETE' }); mensagem.sucesso('Figura excluída.'); novo(); await buscar(); } catch (e) { mensagem.erro(e); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Figuras fiscais" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">A figura fiscal é a chave das regras do indexador tributário — a tributação que as notas usam. Figura com regra apontando para ela não pode ser excluída.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-[26rem]"><Field label="&Descrição" value={f.descfigurafiscal} maxLength={255} onChange={(e) => setF({ ...f, descfigurafiscal: e.target.value })} /></div>
          <div className="w-40"><Field label="Código &reduzido" value={f.codreduzido} maxLength={20} onChange={(e) => setF({ ...f, codreduzido: e.target.value })} /></div>
          <Button label={sel ? '&Gravar' : '&Incluir'} disabled={ocupado || !f.descfigurafiscal.trim()} onClick={() => void gravar()} />
          <Button label="&Novo" variant="outline" onClick={novo} />
          {sel && <Button label="E&xcluir" variant="ghost" onClick={() => void excluir()} />}
        </div>
      </section>
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-72"><Field label="&Buscar" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }} /></div>
          <Button label="&Pesquisar" onClick={() => void buscar()} />
          <label className="flex items-center gap-1 pb-2 text-body-sm"><input type="checkbox" checked={emUso} onChange={(e) => { setEmUso(e.target.checked); void buscar(e.target.checked); }} /> só as usadas em regras</label>
          {res && <span className="text-body-sm text-fg-muted">{res.itens.length} de {res.total.toLocaleString('pt-BR')} figuras · {res.emUso} em uso{res.truncado ? ' — refine a busca' : ''}</span>}
        </div>
        {res && (
          <div className="mt-form-gap overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Código</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs">Reduzido</th><th className="p-pad-xs text-right">Regras</th></tr></thead>
              <tbody>{res.itens.map((x) => (
                <tr key={x.codfigurafiscal} className={`cursor-pointer border-b border-border hover:bg-bg-muted ${sel === x.codfigurafiscal ? 'bg-bg-muted' : ''}`} onClick={() => { setSel(x.codfigurafiscal); setF({ descfigurafiscal: x.descfigurafiscal, codreduzido: x.codreduzido ?? '' }); }}>
                  <td className="p-pad-xs tabular-nums">{x.codfigurafiscal}</td><td className="p-pad-xs">{x.descfigurafiscal}</td>
                  <td className="p-pad-xs">{x.codreduzido ?? ''}</td><td className={`p-pad-xs text-right tabular-nums ${x.regras > 0 ? 'font-semibold' : 'text-fg-muted'}`}>{x.regras}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
