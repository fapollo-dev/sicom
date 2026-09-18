import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * CONFIGURAÇÃO DE LEGISLAÇÃO DA NF-e (`FRMCONFIGLEGISLACAONFE`). Dossiê: `uConfigLegislacaoNFe.md`.
 * As mensagens legais que saem nas observações da nota. A resolução do legado exigia CFOP e todas as
 * regras do cliente estão sem CFOP — por isso cada linha mostra se ela seria invisível lá.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Alertas { codigoVazado: boolean; mojibake: boolean; semTexto: boolean; invisivelNoLegado: boolean; placeholders: string[] }
interface Regra { codconfiglegislacao: number; descricao: string | null; observacoes: string | null; uf: string | null; codcfop: number | null; codproduto: number | null; codparceiro: number | null; indr: string; alertas: Alertas; especificidade?: number }
interface Lista { itens: Regra[]; totais: { regras: number; semCfop: number; comCodigoVazado: number; comMojibake: number; semTexto: number } }
interface Resolucao { escolhida: Regra | null; candidatas: Regra[]; resolucaoDoLegado: Regra | null }

const vazio = () => ({ descricao: '', observacoes: '', uf: '', codcfop: '', codproduto: '', codparceiro: '' });

export function ConfigLegislacaoPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<Lista | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [f, setF] = useState<Record<string, string>>(vazio());
  const [teste, setTeste] = useState({ uf: '', codcfop: '', codproduto: '', codparceiro: '' });
  const [res, setRes] = useState<Resolucao | null>(null);
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
  const carregar = async () => { try { setLista(await pedir<Lista>(`${BASE}/fiscal/config-legislacao`)); } catch (e) { mensagem.erro(e); } };
  useEffect(() => { void carregar(); }, []);
  const novo = () => { setSel(null); setF(vazio()); };
  const editar = (r: Regra) => {
    setSel(r.codconfiglegislacao);
    setF({ descricao: r.descricao ?? '', observacoes: r.observacoes ?? '', uf: r.uf ?? '', codcfop: r.codcfop == null ? '' : String(r.codcfop), codproduto: r.codproduto == null ? '' : String(r.codproduto), codparceiro: r.codparceiro == null ? '' : String(r.codparceiro) });
  };
  const gravar = async () => {
    setOcupado(true);
    try {
      const corpo = {
        descricao: f.descricao.trim() || null, observacoes: f.observacoes || null, uf: f.uf.trim() || null,
        codcfop: f.codcfop.trim() ? Number(f.codcfop) : null, codproduto: f.codproduto.trim() ? Number(f.codproduto) : null,
        codparceiro: f.codparceiro.trim() ? Number(f.codparceiro) : null,
      };
      await pedir(`${BASE}/fiscal/config-legislacao${sel ? `/${sel}` : ''}`, { method: sel ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
      mensagem.sucesso('Mensagem gravada.'); novo(); await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const excluir = async () => {
    if (!sel || !window.confirm('Excluir esta mensagem?')) return;
    try { await pedir(`${BASE}/fiscal/config-legislacao/${sel}`, { method: 'DELETE' }); mensagem.sucesso('Mensagem excluída.'); novo(); await carregar(); } catch (e) { mensagem.erro(e); }
  };
  const resolver = async () => {
    try {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(teste)) if (v.trim()) q.set(k, v.trim());
      setRes(await pedir<Resolucao>(`${BASE}/fiscal/config-legislacao/resolver?${q}`));
    } catch (e) { mensagem.erro(e); }
  };

  const Aviso = ({ a }: { a: Alertas }) => (
    <span className="flex flex-wrap gap-1">
      {a.invisivelNoLegado && <span className="rounded-radius-sm bg-bg-muted px-1 text-fg-muted">sem CFOP</span>}
      {a.codigoVazado && <span className="rounded-radius-sm px-1 font-semibold text-fg-danger">código Delphi no texto</span>}
      {a.mojibake && <span className="rounded-radius-sm px-1 font-semibold text-fg-danger">acentuação corrompida</span>}
      {a.semTexto && <span className="rounded-radius-sm px-1 text-fg-muted">sem texto</span>}
      {a.placeholders.map((p) => <span key={p} className="rounded-radius-sm bg-bg-muted px-1 tabular-nums">{p}</span>)}
    </span>
  );

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Legislação da NF-e" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">As mensagens legais que entram nas observações da nota e na informação adicional do item. Endereçadas por UF, CFOP, produto ou parceiro — quanto mais específica, mais forte.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-64"><Field label="&Chave" value={f.descricao} maxLength={120} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
          <div className="w-20"><Field label="&UF" value={f.uf} maxLength={2} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase() })} /></div>
          <div className="w-24"><Field label="C&FOP" value={f.codcfop} onChange={(e) => setF({ ...f, codcfop: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="w-28"><Field label="&Produto" value={f.codproduto} onChange={(e) => setF({ ...f, codproduto: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="w-28"><Field label="P&arceiro" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value.replace(/\D/g, '') })} /></div>
          <Button label={sel ? '&Gravar' : '&Incluir'} disabled={ocupado} onClick={() => void gravar()} />
          <Button label="&Novo" variant="outline" onClick={novo} />
          {sel && <Button label="E&xcluir" variant="ghost" onClick={() => void excluir()} />}
        </div>
        <label className="mt-form-gap block text-body-sm text-fg-muted">Observações da NF-e</label>
        <textarea className="mt-1 h-28 w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs font-mono text-body-sm" maxLength={8000} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
      </section>

      {lista && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-md text-body-sm">
              <span>Regras <strong className="tabular-nums">{lista.totais.regras}</strong></span>
              <span className={lista.totais.semCfop > 0 ? 'text-fg-danger' : ''}>Sem CFOP (invisíveis à regra antiga) <strong className="tabular-nums">{lista.totais.semCfop}</strong></span>
              {lista.totais.comCodigoVazado > 0 && <span className="font-semibold text-fg-danger">Com código no texto {lista.totais.comCodigoVazado}</span>}
              {lista.totais.comMojibake > 0 && <span className="font-semibold text-fg-danger">Com acentuação corrompida {lista.totais.comMojibake}</span>}
              {lista.totais.semTexto > 0 && <span className="text-fg-muted">Sem texto {lista.totais.semTexto}</span>}
            </div>
          </section>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full min-w-[900px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Chave</th><th className="p-pad-xs">UF</th><th className="p-pad-xs">CFOP</th><th className="p-pad-xs">Produto</th><th className="p-pad-xs">Parceiro</th>
                <th className="p-pad-xs">Texto</th><th className="p-pad-xs">Avisos</th>
              </tr></thead>
              <tbody>{lista.itens.map((r) => (
                <tr key={r.codconfiglegislacao} className={`cursor-pointer border-b border-border hover:bg-bg-muted ${sel === r.codconfiglegislacao ? 'bg-bg-muted' : ''}`} onClick={() => editar(r)}>
                  <td className="p-pad-xs">{r.descricao ?? ''}</td><td className="p-pad-xs">{r.uf ?? ''}</td><td className="p-pad-xs tabular-nums">{r.codcfop ?? ''}</td>
                  <td className="p-pad-xs tabular-nums">{r.codproduto ?? ''}</td><td className="p-pad-xs tabular-nums">{r.codparceiro ?? ''}</td>
                  <td className="max-w-[24rem] truncate p-pad-xs text-fg-muted">{r.observacoes ?? ''}</td>
                  <td className="p-pad-xs text-body-sm"><Aviso a={r.alertas} /></td>
                </tr>))}</tbody>
            </table>
          </div>
        </>
      )}

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <h4 className="mb-form-gap text-body-sm font-semibold">Testar a resolução</h4>
        <p className="mb-form-gap text-body-sm text-fg-muted">Qual mensagem sairia numa nota com estes dados. A coluna da direita mostra o que a regra antiga (que exigia CFOP) devolveria.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-20"><Field label="UF" value={teste.uf} maxLength={2} onChange={(e) => setTeste({ ...teste, uf: e.target.value.toUpperCase() })} /></div>
          <div className="w-24"><Field label="CFOP" value={teste.codcfop} onChange={(e) => setTeste({ ...teste, codcfop: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="w-28"><Field label="Produto" value={teste.codproduto} onChange={(e) => setTeste({ ...teste, codproduto: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="w-28"><Field label="Parceiro" value={teste.codparceiro} onChange={(e) => setTeste({ ...teste, codparceiro: e.target.value.replace(/\D/g, '') })} /></div>
          <Button label="&Resolver" variant="outline" onClick={() => void resolver()} />
        </div>
        {res && (
          <div className="mt-form-gap text-body-sm">
            <p>Escolhida: <strong>{res.escolhida ? `${res.escolhida.descricao ?? res.escolhida.codconfiglegislacao}` : 'nenhuma'}</strong>{res.escolhida ? ` — ${res.escolhida.observacoes ?? ''}` : ''}</p>
            <p className="text-fg-muted">Pela regra antiga: {res.resolucaoDoLegado ? (res.resolucaoDoLegado.descricao ?? String(res.resolucaoDoLegado.codconfiglegislacao)) : 'nenhuma (o WHERE exigia CFOP)'} · candidatas: {res.candidatas.length}</p>
          </div>
        )}
      </section>
    </div>
  );
}
