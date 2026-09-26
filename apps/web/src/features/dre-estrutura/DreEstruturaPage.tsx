import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import {
  isErroResposta, referenciasDaExpressao, TIPOS_CALCULO_DRE, type DreEstruturaDto, type ErroResposta,
} from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * CONFIGURADOR DO DRE CONTÁBIL (`FRMCONFIGDRECONTABIL`).
 * Dossiê: `uConfigDreContabil.md`.
 *
 * A árvore que define **como o DRE é somado**: cada linha soma as contas vinculadas (`P`), as filhas (`F`) ou
 * o que a expressão disser (`E`). Mexer aqui muda todo relatório de resultado — por isso a tela mostra, em
 * cada linha, quantas filhas e quantas contas ela tem: é o que diz se dá para apagá-la.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = '/cadastro/dre-estrutura';

interface Linha {
  codestrutura: number; codexpandido: string; descricao: string; tipo_calculo: string; classe: string;
  expressao: string | null; nivel: number; codpai: number | null; ativo: string;
  contas: number; filhas: number;
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

const vazia = (): DreEstruturaDto => ({
  codexpandido: '', descricao: '', tipo_calculo: 'P', classe: 'A',
  expressao: null, nivel: 1, codpai: null, ativo: 'S',
});

export function DreEstruturaPage() {
  const mensagem = useMensagem();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [editando, setEditando] = useState<number | null>(null);
  const [form, setForm] = useState<DreEstruturaDto | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // o vínculo em lote do legado: as duas grades (disponíveis × vinculadas), o filtro e os quatro botões
  const [vinculo, setVinculo] = useState<{ linha: Linha; disponiveis: Conta[]; vinculadas: Conta[]; filtro: string; marcadasD: Set<number>; marcadasV: Set<number> } | null>(null);

  const carregar = useCallback(async () => {
    try { setLinhas(await req<Linha[]>(P)); } catch (e) { mensagem.erro(e); }
  }, [mensagem]);

  useEffect(() => { void carregar(); }, [carregar]);

  const porCodigo = useMemo(() => new Map(linhas.map((l) => [l.codexpandido, l])), [linhas]);

  const abrir = (l: Linha | null) => {
    setEditando(l?.codestrutura ?? null);
    setForm(l ? {
      codexpandido: l.codexpandido, descricao: l.descricao,
      tipo_calculo: l.tipo_calculo as DreEstruturaDto['tipo_calculo'],
      classe: l.classe as DreEstruturaDto['classe'],
      expressao: l.expressao, nivel: Number(l.nivel), codpai: l.codpai, ativo: l.ativo as 'S' | 'N',
    } : vazia());
  };

  const salvar = async () => {
    if (!form) return;
    setOcupado(true);
    try {
      if (editando == null) await req(P, { method: 'POST', body: JSON.stringify(form) });
      else await req(`${P}/${editando}`, { method: 'PUT', body: JSON.stringify(form) });
      mensagem.sucesso(editando == null ? 'Linha criada.' : 'Linha atualizada.');
      setForm(null); setEditando(null);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const excluir = async (l: Linha) => {
    setOcupado(true);
    try { await req(`${P}/${l.codestrutura}`, { method: 'DELETE' }); mensagem.sucesso('Linha excluída.'); await carregar(); }
    catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  /** ao trocar o tipo, a classe vem junto: a correlação é fixa (P→A, F/E→S). */
  const abrirVinculo = async (l: Linha, filtro = '') => {
    try {
      const todas = await req<Conta[]>(`${P}/${l.codestrutura}/disponiveis?${new URLSearchParams({ filtro })}`);
      const atuais = vinculo?.linha.codestrutura === l.codestrutura ? vinculo.vinculadas : todas.filter((c) => c.vinculada);
      const ids = new Set(atuais.map((c) => c.codplanocontas));
      setVinculo({ linha: l, filtro, vinculadas: atuais, disponiveis: todas.filter((c) => !ids.has(c.codplanocontas)), marcadasD: new Set(), marcadasV: new Set() });
    } catch (e) { mensagem.erro(e); }
  };
  const mover = (paraVinculadas: boolean, todas: boolean) => {
    if (!vinculo) return;
    const origem = paraVinculadas ? vinculo.disponiveis : vinculo.vinculadas;
    const marcadas = paraVinculadas ? vinculo.marcadasD : vinculo.marcadasV;
    const vao = origem.filter((c) => todas || marcadas.has(c.codplanocontas));
    const ficam = origem.filter((c) => !(todas || marcadas.has(c.codplanocontas)));
    const destino = [...(paraVinculadas ? vinculo.vinculadas : vinculo.disponiveis), ...vao]
      .sort((a, b) => String(a.codiexpandido ?? '').localeCompare(String(b.codiexpandido ?? '')));
    setVinculo(paraVinculadas
      ? { ...vinculo, disponiveis: ficam, vinculadas: destino, marcadasD: new Set() }
      : { ...vinculo, vinculadas: ficam, disponiveis: destino, marcadasV: new Set() });
  };
  const gravarVinculo = async () => {
    if (!vinculo) return;
    setOcupado(true);
    try {
      await req(`${P}/contas`, { method: 'POST', body: JSON.stringify({ codestrutura: vinculo.linha.codestrutura, codplanocontas: vinculo.vinculadas.map((c) => c.codplanocontas) }) });
      mensagem.sucesso(`${vinculo.vinculadas.length} conta(s) vinculada(s) a ${vinculo.linha.descricao}.`);
      setVinculo(null);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const trocarTipo = (tipo: string) => {
    if (!form) return;
    const meta = TIPOS_CALCULO_DRE.find((t) => t.value === tipo)!;
    setForm({
      ...form, tipo_calculo: tipo as DreEstruturaDto['tipo_calculo'],
      classe: meta.classe as DreEstruturaDto['classe'],
      expressao: tipo === 'E' ? (form.expressao ?? '') : null,
    });
  };

  const refsQuebradas = form?.tipo_calculo === 'E'
    ? referenciasDaExpressao(form.expressao).filter((r) => !porCodigo.has(r) || r === form.codexpandido)
    : [];

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Configurador do DRE contábil" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Cada linha soma <strong>as contas vinculadas</strong> (P), <strong>as filhas</strong> (F) ou o que a
          <strong> expressão</strong> disser (E). As colunas <em>filhas</em> e <em>contas</em> dizem se a linha
          ainda é usada — e é por isso que ela não pode ser apagada enquanto forem maiores que zero.
        </p>
        <Button label="&Nova linha" onClick={() => abrir(null)} />
      </section>

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full min-w-[900px] border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th className="p-pad-xs">Código</th><th className="p-pad-xs">Descrição</th>
              <th className="p-pad-xs">Tipo</th><th className="p-pad-xs">Expressão</th>
              <th className="p-pad-xs">Filhas</th><th className="p-pad-xs">Contas</th>
              <th className="p-pad-xs">Ativa</th><th />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.codestrutura} className="border-b border-border">
                <td className="p-pad-xs font-mono" style={{ paddingLeft: `${(Number(l.nivel) - 1) * 20 + 8}px` }}>{l.codexpandido}</td>
                <td className={`p-pad-xs ${l.classe === 'S' ? 'font-semibold' : ''}`}>{l.descricao}</td>
                <td className="p-pad-xs">{TIPOS_CALCULO_DRE.find((t) => t.value === l.tipo_calculo)?.label ?? l.tipo_calculo}</td>
                <td className="p-pad-xs font-mono text-fg-muted">{l.expressao ?? ''}</td>
                <td className="p-pad-xs">{l.filhas}</td>
                <td className="p-pad-xs">{l.contas}</td>
                <td className="p-pad-xs">{l.ativo}</td>
                <td className="p-pad-xs">
                  <span className="flex gap-gp-xs">
                    <Button variant="outline" label="Editar" onClick={() => abrir(l)} />
                    {l.tipo_calculo === 'P' && <Button variant="outline" label="Contas" onClick={() => void abrirVinculo(l)} />}
                    <Button variant="outline" label="Excluir" disabled={ocupado} onClick={() => void excluir(l)} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {vinculo && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h2 className="mb-form-gap text-title-sm">Contas da linha {vinculo.linha.codexpandido} — {vinculo.linha.descricao}</h2>
          <div className="mb-form-gap flex flex-wrap items-end gap-gp-sm">
            <div className="w-64"><Field label="Filtro (código ou descrição)" value={vinculo.filtro} onChange={(e) => setVinculo({ ...vinculo, filtro: e.target.value })} /></div>
            <Button label="Filtrar" variant="soft" onClick={() => void abrirVinculo(vinculo.linha, vinculo.filtro)} />
          </div>
          <div className="grid gap-gp-md md:grid-cols-[1fr_auto_1fr]">
            <ListaContas titulo={`Disponíveis (${vinculo.disponiveis.length})`} contas={vinculo.disponiveis} marcadas={vinculo.marcadasD}
              alternar={(id) => { const m = new Set(vinculo.marcadasD); if (m.has(id)) m.delete(id); else m.add(id); setVinculo({ ...vinculo, marcadasD: m }); }} />
            <div className="flex flex-col justify-center gap-gp-xs">
              <Button label="Vincular ›" variant="soft" onClick={() => mover(true, false)} />
              <Button label="Vincular todos »" variant="soft" onClick={() => mover(true, true)} />
              <Button label="‹ Desvincular" variant="soft" onClick={() => mover(false, false)} />
              <Button label="« Desvincular todos" variant="soft" onClick={() => mover(false, true)} />
            </div>
            <ListaContas titulo={`Vinculadas (${vinculo.vinculadas.length})`} contas={vinculo.vinculadas} marcadas={vinculo.marcadasV}
              alternar={(id) => { const m = new Set(vinculo.marcadasV); if (m.has(id)) m.delete(id); else m.add(id); setVinculo({ ...vinculo, marcadasV: m }); }} />
          </div>
          <div className="mt-form-gap flex gap-gp-sm">
            <Button label="&Gravar vínculos" disabled={ocupado} onClick={() => void gravarVinculo()} />
            <Button label="Cancelar" variant="outline" onClick={() => setVinculo(null)} />
          </div>
        </section>
      )}

      {form && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h2 className="text-title-sm">{editando == null ? 'Nova linha' : `Linha ${form.codexpandido}`}</h2>
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-40"><Field label="&Código" value={form.codexpandido} onChange={(e) => setForm({ ...form, codexpandido: e.target.value })} /></div>
            <div className="w-96"><Field label="&Descrição" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Tipo de cálculo
              <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
                value={form.tipo_calculo} onChange={(e) => trocarTipo(e.target.value)}>
                {TIPOS_CALCULO_DRE.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <div className="w-24"><Field label="&Nível" type="number" value={String(form.nivel)}
              onChange={(e) => setForm({ ...form, nivel: Number(e.target.value || 1), codpai: Number(e.target.value) === 1 ? null : form.codpai })} /></div>
            {form.nivel > 1 && (
              <label className="flex flex-col gap-gp-xs text-body-sm">
                Linha pai
                <select className="h-9 min-w-64 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
                  value={form.codpai ?? ''} onChange={(e) => setForm({ ...form, codpai: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— escolha —</option>
                  {linhas.filter((l) => Number(l.nivel) === Number(form.nivel) - 1)
                    .map((l) => <option key={l.codestrutura} value={l.codestrutura}>{l.codexpandido} · {l.descricao}</option>)}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Ativa
              <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
                value={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.value as 'S' | 'N' })}>
                <option value="S">Sim</option><option value="N">Não</option>
              </select>
            </label>
          </div>

          {form.tipo_calculo === 'E' && (
            <div>
              <div className="w-full max-w-xl">
                <Field label="&Expressão" value={form.expressao ?? ''} onChange={(e) => setForm({ ...form, expressao: e.target.value })} />
              </div>
              <p className="mt-gp-xs text-body-sm text-fg-muted">
                Referencie outras linhas pelo código entre <code>&lt;&gt;</code> — como o
                <code> &lt;01&gt;+&lt;03&gt;+&lt;04&gt;</code> do LUCRO BRUTO COMERCIAL.
              </p>
              {refsQuebradas.length > 0 && (
                <p className="mt-gp-xs text-body-sm text-fg-danger">
                  Referência inválida: <strong>{refsQuebradas.join(', ')}</strong> — o código não existe, ou a
                  linha está apontando para si mesma.
                </p>
              )}
            </div>
          )}

          <p className="text-body-sm text-fg-muted">
            Classe: <strong>{form.classe === 'A' ? 'analítica (recebe contas)' : 'sintética (agrega)'}</strong> —
            vem do tipo de cálculo, não se escolhe.
          </p>

          <div className="flex gap-gp-sm">
            <Button label="&Gravar" disabled={ocupado || refsQuebradas.length > 0 || !form.codexpandido || !form.descricao} onClick={() => void salvar()} />
            <Button variant="outline" label="&Cancelar" onClick={() => { setForm(null); setEditando(null); }} />
          </div>
        </section>
      )}
    </div>
  );
}

interface Conta { codplanocontas: number; codiexpandido: string | null; descricao: string; codireduzido: string | null; vinculada?: boolean }

/** uma das duas grades do vínculo (disponíveis / vinculadas), com marcação por linha */
function ListaContas({ titulo, contas, marcadas, alternar }: { titulo: string; contas: Conta[]; marcadas: Set<number>; alternar: (id: number) => void }) {
  return (
    <div className="flex flex-col gap-gp-xs">
      <span className="text-body-sm text-fg-muted">{titulo}</span>
      <div className="max-h-80 overflow-auto rounded-radius-sm border border-border">
        <table className="w-full border-collapse text-body-sm">
          <tbody>{contas.map((c) => (
            <tr key={c.codplanocontas} className="border-b border-border">
              <td className="p-pad-xs"><input type="checkbox" aria-label={`Marcar a conta ${c.codiexpandido ?? c.codplanocontas}`} checked={marcadas.has(c.codplanocontas)} onChange={() => alternar(c.codplanocontas)} /></td>
              <td className="p-pad-xs font-mono">{c.codiexpandido ?? ''}</td><td className="p-pad-xs">{c.codireduzido ?? ''}</td><td className="p-pad-xs">{c.descricao}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
