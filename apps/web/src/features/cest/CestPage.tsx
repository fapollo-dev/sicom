import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * CADASTRO DE CEST (`FRMCADCEST`). Dossiê: `uCadCest.md`.
 * A tabela CEST × NCM que o produto aponta e que vai na NF-e. Busca por prefixo (CEST/NCM) ou por trecho da
 * descrição; abaixo, os produtos cujo CEST não existe na tabela (248 no cliente).
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
type Cest = { codcest: number; cest: string; ncm: string | null; descricao: string; seguimento: string | null; item: string | null; anexoxxvii: string | null; produtos: number };
type Busca = { itens: Cest[]; total: number; truncado: boolean };
type SemCad = { produtos: Array<{ idproduto: number; codbarra: string | null; descricao: string; cest: string; formatoInvalido: boolean }>; total: number };
const vazio = () => ({ cest: '', ncm: '', descricao: '', seguimento: '', item: '', anexoxxvii: '' });

export function CestPage() {
  const mensagem = useMensagem();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Busca | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [f, setF] = useState<Record<string, string>>(vazio());
  const [semCad, setSemCad] = useState<SemCad | null>(null);
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
    try { setRes(await pedir<Busca>(`${BASE}/cadastro/cest?${new URLSearchParams({ q: q.trim(), limite: '300' })}`)); } catch (e) { mensagem.erro(e); }
  };
  useEffect(() => { void buscar(); }, []);
  const editar = (c: Cest) => { setSel(c.codcest); setF({ cest: c.cest, ncm: c.ncm ?? '', descricao: c.descricao, seguimento: c.seguimento ?? '', item: c.item ?? '', anexoxxvii: c.anexoxxvii ?? '' }); };
  const novo = () => { setSel(null); setF(vazio()); };
  const gravar = async () => {
    setOcupado(true);
    try {
      const corpo = { cest: f.cest.trim(), ncm: f.ncm.trim() || null, descricao: f.descricao.trim(), seguimento: f.seguimento.trim() || null, item: f.item.trim() || null, anexoxxvii: f.anexoxxvii || null };
      await pedir(`${BASE}/cadastro/cest${sel ? `/${sel}` : ''}`, { method: sel ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
      mensagem.sucesso('CEST gravado.'); novo(); await buscar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const excluir = async () => {
    if (!sel || !window.confirm('Excluir este CEST × NCM?')) return;
    try { await pedir(`${BASE}/cadastro/cest/${sel}`, { method: 'DELETE' }); mensagem.sucesso('CEST excluído.'); novo(); await buscar(); } catch (e) { mensagem.erro(e); }
  };
  const carregarSemCadastro = async () => { try { setSemCad(await pedir<SemCad>(`${BASE}/cadastro/cest/sem-cadastro`)); } catch (e) { mensagem.erro(e); } };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="CEST" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">O Código Especificador da Substituição Tributária, por NCM. É o código que sai na NF-e e no SPED — um produto apontando um CEST que não existe aqui vai com o código errado.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-32"><Field label="&CEST" value={f.cest} maxLength={7} onChange={(e) => setF({ ...f, cest: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="w-32"><Field label="&NCM" value={f.ncm} maxLength={8} onChange={(e) => setF({ ...f, ncm: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="w-[28rem]"><Field label="&Descrição" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
          <div className="w-64"><Field label="Se&gmento" value={f.seguimento} onChange={(e) => setF({ ...f, seguimento: e.target.value })} /></div>
          <div className="w-24"><Field label="&Item" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} /></div>
          <div className="w-32">
            <label className="mb-1 block text-body-sm text-fg-muted">Anexo XXVII</label>
            <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={f.anexoxxvii} onChange={(e) => setF({ ...f, anexoxxvii: e.target.value })}>
              <option value="">—</option><option value="S">Sim</option><option value="N">Não</option>
            </select>
          </div>
          <Button label={sel ? '&Gravar' : '&Incluir'} disabled={ocupado} onClick={() => void gravar()} />
          <Button label="&Novo" variant="outline" onClick={novo} />
          {sel && <Button label="E&xcluir" variant="ghost" onClick={() => void excluir()} />}
        </div>
      </section>

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-80"><Field label="&Buscar (CEST, NCM ou descrição)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }} /></div>
          <Button label="&Pesquisar" onClick={() => void buscar()} />
          {res && <span className="text-body-sm text-fg-muted">{res.itens.length} de {res.total.toLocaleString('pt-BR')} linhas{res.truncado ? ' — refine a busca' : ''}</span>}
        </div>
        {res && (
          <div className="mt-form-gap overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">CEST</th><th className="p-pad-xs">NCM</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs">Segmento</th><th className="p-pad-xs text-right">Produtos</th></tr></thead>
              <tbody>{res.itens.map((c) => (
                <tr key={c.codcest} className={`cursor-pointer border-b border-border hover:bg-bg-muted ${sel === c.codcest ? 'bg-bg-muted' : ''}`} onClick={() => editar(c)}>
                  <td className="p-pad-xs tabular-nums">{c.cest}</td><td className="p-pad-xs tabular-nums">{c.ncm ?? ''}</td>
                  <td className="p-pad-xs">{c.descricao}</td><td className="p-pad-xs text-fg-muted">{c.seguimento ?? ''}</td>
                  <td className="p-pad-xs text-right tabular-nums">{c.produtos}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-center gap-gp-sm">
          <h4 className="text-body-sm font-semibold">Produtos com CEST sem cadastro</h4>
          <Button label="&Verificar" variant="outline" onClick={() => void carregarSemCadastro()} />
          {semCad && <span className={`text-body-sm ${semCad.total > 0 ? 'text-fg-danger' : 'text-fg-muted'}`}>{semCad.total} produto(s) apontam um CEST que não existe na tabela</span>}
        </div>
        {semCad && semCad.total > 0 && (
          <div className="mt-form-gap overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Produto</th><th className="p-pad-xs">Código de barras</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs">CEST</th><th className="p-pad-xs">Formato</th></tr></thead>
              <tbody>{semCad.produtos.map((p) => (
                <tr key={p.idproduto} className="border-b border-border">
                  <td className="p-pad-xs tabular-nums">{p.idproduto}</td><td className="p-pad-xs tabular-nums">{p.codbarra ?? ''}</td><td className="p-pad-xs">{p.descricao}</td>
                  <td className="p-pad-xs tabular-nums">{p.cest}</td><td className={`p-pad-xs ${p.formatoInvalido ? 'text-fg-danger' : ''}`}>{p.formatoInvalido ? 'inválido (7 dígitos)' : 'ok, sem cadastro'}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
