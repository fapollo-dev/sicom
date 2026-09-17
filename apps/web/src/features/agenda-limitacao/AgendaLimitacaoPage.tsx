import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type AgendaLimitacaoDto, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * AGENDA DE LIMITAÇÃO DE VENDA (`FRMCADAGENDALIMITACAOVENDA`).
 * Dossiê: `uCadAgendaLimitacaoVenda.md`.
 *
 * Quanto de um produto cada cliente pode levar num período. No cliente o uso é sazonal e casado com o
 * "DIA D" — o dia de promoção forte, em que a loja não quer que um atravessador leve a gôndola inteira.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = '/cadastro/agenda-limitacao';

interface Agenda {
  codagenda_produto: number; descricao: string; dtinicio: string; dtfim: string;
  tipo: string; estatus: string; empresas: string | null; itens: number;
}
interface Item {
  codagenda_produto_item: number; idproduto: number; quantidade: number;
  atualizacao_grupo: string; codgrupo: number | null; ativo: string;
  codbarra: string | null; dsprod: string | null; produtos_no_grupo: number;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: res.statusText };
    throw Object.assign(new Error(env.code), { envelope: env });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);

export function AgendaLimitacaoPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<Agenda[]>([]);
  const [aberta, setAberta] = useState<(Agenda & { itens: Item[] }) | null>(null);
  const [form, setForm] = useState<AgendaLimitacaoDto | null>(null);
  const [novos, setNovos] = useState({ ids: '', quantidade: '2' });
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try { setLista(await req<Agenda[]>(P)); } catch (e) { mensagem.erro(e); }
  }, [mensagem]);

  useEffect(() => { void carregar(); }, [carregar]);

  const abrir = async (cod: number) => {
    try { setAberta(await req(`${P}/${cod}`)); setForm(null); } catch (e) { mensagem.erro(e); }
  };

  const criar = async () => {
    if (!form) return;
    setOcupado(true);
    try {
      const r = await req<{ codagenda_produto: number }>(P, { method: 'POST', body: JSON.stringify(form) });
      mensagem.sucesso('Agenda criada.');
      setForm(null); await carregar(); await abrir(r.codagenda_produto);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const adicionar = async () => {
    if (!aberta) return;
    const ids = novos.ids.split(/[\s,;]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) return;
    setOcupado(true);
    try {
      const r = await req<{ adicionados: number }>(`${P}/${aberta.codagenda_produto}/produtos`, {
        method: 'POST', body: JSON.stringify({ idprodutos: ids, quantidade: Number(novos.quantidade) }),
      });
      mensagem.sucesso(`${r.adicionados} produto(s) adicionado(s).`);
      setNovos({ ...novos, ids: '' });
      await abrir(aberta.codagenda_produto); await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const mudarItem = async (it: Item, patch: Record<string, unknown>) => {
    if (!aberta) return;
    try {
      await req(`${P}/${aberta.codagenda_produto}/itens/${it.codagenda_produto_item}`, { method: 'PUT', body: JSON.stringify(patch) });
      await abrir(aberta.codagenda_produto);
    } catch (e) { mensagem.erro(e); }
  };

  const removerItem = async (it: Item) => {
    if (!aberta) return;
    try {
      await req(`${P}/${aberta.codagenda_produto}/itens/${it.codagenda_produto_item}`, { method: 'DELETE' });
      await abrir(aberta.codagenda_produto); await carregar();
    } catch (e) { mensagem.erro(e); }
  };

  const fechada = aberta?.estatus === 'F';

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Agenda de limitação de venda" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Quanto de um produto <strong>cada cliente</strong> pode levar no período. É o que segura a gôndola
          no dia de promoção forte. Agenda <strong>fechada</strong> não se altera.
        </p>
        <Button label="&Nova agenda" onClick={() => { setForm({ descricao: '', dtinicio: hoje(), dtfim: hoje(), tipo: 'Q', estatus: 'A', empresas: ';1;', itens: [] }); setAberta(null); }} />
      </section>

      {form && (
        <section className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="w-80"><Field label="&Descrição" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
          <div className="w-40"><Field label="&Início" type="date" value={form.dtinicio} onChange={(e) => setForm({ ...form, dtinicio: e.target.value })} /></div>
          <div className="w-40"><Field label="&Término" type="date" value={form.dtfim} onChange={(e) => setForm({ ...form, dtfim: e.target.value })} /></div>
          <div className="w-40"><Field label="&Lojas (;1;2;)" value={form.empresas} onChange={(e) => setForm({ ...form, empresas: e.target.value })} /></div>
          <Button label="&Criar" disabled={ocupado || !form.descricao || !form.empresas} onClick={() => void criar()} />
          <Button variant="outline" label="Cancelar" onClick={() => setForm(null)} />
        </section>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th className="p-pad-xs">Descrição</th><th className="p-pad-xs">Período</th>
              <th className="p-pad-xs">Lojas</th><th className="p-pad-xs">Produtos</th>
              <th className="p-pad-xs">Situação</th><th />
            </tr>
          </thead>
          <tbody>
            {lista.map((a) => (
              <tr key={a.codagenda_produto} className="border-b border-border">
                <td className="p-pad-xs">{a.descricao}</td>
                <td className="p-pad-xs">{dataBr(a.dtinicio)} — {dataBr(a.dtfim)}</td>
                <td className="p-pad-xs font-mono">{a.empresas}</td>
                <td className="p-pad-xs">{a.itens}</td>
                <td className="p-pad-xs">{a.estatus === 'F' ? 'Fechada' : 'Aberta'}</td>
                <td className="p-pad-xs"><Button variant="outline" label="Abrir" onClick={() => void abrir(a.codagenda_produto)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {aberta && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h2 className="text-title-sm">
            {aberta.descricao} · {dataBr(aberta.dtinicio)} a {dataBr(aberta.dtfim)}
            {fechada && <span className="ml-gp-sm text-body-sm text-fg-danger">Fechada — não é possível alterar</span>}
          </h2>

          {!fechada && (
            <div className="flex flex-wrap items-end gap-gp-sm">
              <div className="w-96"><Field label="&Produtos (códigos separados por espaço)" value={novos.ids} onChange={(e) => setNovos({ ...novos, ids: e.target.value })} /></div>
              <div className="w-40"><Field label="&Quantidade padrão" type="number" value={novos.quantidade} onChange={(e) => setNovos({ ...novos, quantidade: e.target.value })} /></div>
              <Button label="&Adicionar" disabled={ocupado || !novos.ids} onClick={() => void adicionar()} />
            </div>
          )}

          <table className="w-full border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">EAN</th><th className="p-pad-xs">Produto</th>
                <th className="p-pad-xs">Limite</th><th className="p-pad-xs">Vale p/ o grupo</th>
                <th className="p-pad-xs">Ativo</th><th />
              </tr>
            </thead>
            <tbody>
              {(aberta.itens ?? []).map((it) => (
                <tr key={it.codagenda_produto_item} className="border-b border-border">
                  <td className="p-pad-xs font-mono">{it.codbarra}</td>
                  <td className="p-pad-xs">{it.dsprod}</td>
                  <td className="p-pad-xs">
                    <input type="number" className="h-8 w-24 rounded-radius-sm border border-border bg-bg-base px-pad-xs"
                      disabled={fechada} defaultValue={Number(it.quantidade)}
                      onBlur={(e) => { const q = Number(e.target.value); if (q > 0 && q !== Number(it.quantidade)) void mudarItem(it, { quantidade: q }); }} />
                  </td>
                  <td className="p-pad-xs">
                    <label className="flex items-center gap-gp-xs">
                      <input type="checkbox" disabled={fechada || !it.codgrupo} checked={it.atualizacao_grupo === 'S'}
                        onChange={(e) => void mudarItem(it, { atualizacao_grupo: e.target.checked ? 'S' : 'N' })} />
                      {it.codgrupo ? `grupo ${it.codgrupo} (${it.produtos_no_grupo} produtos)` : 'sem grupo de preço'}
                    </label>
                  </td>
                  <td className="p-pad-xs">
                    <input type="checkbox" disabled={fechada} checked={it.ativo === 'S'}
                      onChange={(e) => void mudarItem(it, { ativo: e.target.checked ? 'S' : 'N' })} />
                  </td>
                  <td className="p-pad-xs">
                    {!fechada && <Button variant="outline" label="Remover" onClick={() => void removerItem(it)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
