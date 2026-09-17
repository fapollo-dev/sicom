import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, ORIGENS_PRECO_ALTERADO, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';

/**
 * RELATÓRIO DE PREÇOS ALTERADOS (`FRMRELPRECOSALTERADOS`).
 * Dossiê: `uRelPrecosAlterados.md`.
 *
 * Que preços mudaram no período, de quanto para quanto e por quem.
 *
 * ⚠️ a alteração **sem histórico** aparece aqui (só sem o preço anterior) — no legado ela sumia, e isso
 * escondia mais da metade das alterações.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

interface Linha {
  codproduto: number; codbarra: string | null; descricao: string | null; dpto: string | null;
  data: string | null; valor: number; promocao: string; vrpromo: number | null;
  usuario: string | null; valor_anterior: number | null; variacao_perc: number | null;
  diferenca: number | null; origem: string | null;
}
interface Resultado {
  linhas: Linha[];
  totais: { itens: number; subiram: number; caíram: number; semAnterior: number; variacaoMedia: number };
}

export function RelPrecosAlteradosPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: diaUm(), dataFim: hoje(), origem: 'PRECO', promocao: 'TODOS',
    coddpto: '', produto: '', semGrupoPreco: 'N',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({
        dataIni: f.dataIni, dataFim: f.dataFim, origem: f.origem,
        promocao: f.promocao, semGrupoPreco: f.semGrupoPreco,
      });
      if (f.coddpto) q.set('coddpto', f.coddpto);
      if (f.produto) q.set('produto', f.produto);
      const r = await fetch(`${BASE}/relatorios/precos-alterados?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Relatório de preços alterados" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Que preços mudaram no período, <strong>de quanto para quanto</strong> e por quem. A alteração sem
          registro de histórico aparece igual — só sem o preço anterior.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Origem
            <select className="h-9 min-w-64 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
              value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value })}>
              {ORIGENS_PRECO_ALTERADO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Promoção
            <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
              value={f.promocao} onChange={(e) => setF({ ...f, promocao: e.target.value })}>
              <option value="TODOS">Todos</option><option value="PROMOCAO">Só promoção</option><option value="NORMAL">Só preço normal</option>
            </select>
          </label>
          <div className="w-52"><Field label="&Produto" value={f.produto} onChange={(e) => setF({ ...f, produto: e.target.value })} /></div>
          <div className="w-32"><Field label="&Departamento" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <label className="flex items-center gap-gp-xs text-body-sm">
            <input type="checkbox" checked={f.semGrupoPreco === 'S'}
              onChange={(e) => setF({ ...f, semGrupoPreco: e.target.checked ? 'S' : 'N' })} />
            Retirar itens de grupo de preço
          </label>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void buscar()} />
          {res && (
            <Button variant="outline" label="&Exportar" onClick={() => exportarGradeCsv(
              res.linhas,
              [
                { titulo: 'EAN', valor: (l: Linha) => l.codbarra },
                { titulo: 'Produto', valor: (l: Linha) => l.descricao },
                { titulo: 'Departamento', valor: (l: Linha) => l.dpto },
                { titulo: 'Data', valor: (l: Linha) => dataBr(l.data) },
                { titulo: 'Preço anterior', valor: (l: Linha) => moeda(l.valor_anterior) },
                { titulo: 'Preço atual', valor: (l: Linha) => moeda(l.valor) },
                { titulo: 'Diferença', valor: (l: Linha) => moeda(l.diferenca) },
                { titulo: 'Variação %', valor: (l: Linha) => (l.variacao_perc == null ? '' : `${l.variacao_perc}%`) },
                { titulo: 'Promoção', valor: (l: Linha) => l.promocao },
                { titulo: 'Usuário', valor: (l: Linha) => l.usuario },
              ],
              'precos-alterados',
            )} />
          )}
        </div>
      </section>

      {res && (
        <section className="flex flex-wrap gap-gp-lg rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div><div className="text-body-sm text-fg-muted">Alterações</div><div className="text-title-sm tabular-nums">{res.totais.itens}</div></div>
          <div><div className="text-body-sm text-fg-muted">Subiram</div><div className="text-title-sm tabular-nums">{res.totais.subiram}</div></div>
          <div><div className="text-body-sm text-fg-muted">Caíram</div><div className="text-title-sm tabular-nums">{res.totais.caíram}</div></div>
          <div><div className="text-body-sm text-fg-muted">Sem preço anterior</div><div className="text-title-sm tabular-nums">{res.totais.semAnterior}</div></div>
          <div><div className="text-body-sm text-fg-muted">Variação média</div><div className="text-title-sm tabular-nums">{res.totais.variacaoMedia}%</div></div>
        </section>
      )}

      {res && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full min-w-[1000px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">EAN</th><th className="p-pad-xs">Produto</th>
                <th className="p-pad-xs">Departamento</th><th className="p-pad-xs">Data</th>
                <th className="p-pad-xs">Anterior</th><th className="p-pad-xs">Atual</th>
                <th className="p-pad-xs">Diferença</th><th className="p-pad-xs">Variação</th>
                <th className="p-pad-xs">Promo</th><th className="p-pad-xs">Usuário</th>
              </tr>
            </thead>
            <tbody>
              {res.linhas.map((l, i) => (
                <tr key={`${l.codproduto}-${i}`} className="border-b border-border">
                  <td className="p-pad-xs font-mono">{l.codbarra}</td>
                  <td className="p-pad-xs">{l.descricao}</td>
                  <td className="p-pad-xs">{l.dpto}</td>
                  <td className="p-pad-xs">{dataBr(l.data)}</td>
                  <td className="p-pad-xs tabular-nums text-fg-muted">{moeda(l.valor_anterior)}</td>
                  <td className="p-pad-xs tabular-nums font-semibold">{moeda(l.valor)}</td>
                  <td className={`p-pad-xs tabular-nums ${Number(l.diferenca) < 0 ? 'text-fg-danger' : ''}`}>{moeda(l.diferenca)}</td>
                  <td className="p-pad-xs tabular-nums">{l.variacao_perc == null ? '—' : `${l.variacao_perc}%`}</td>
                  <td className="p-pad-xs">{l.promocao}</td>
                  <td className="p-pad-xs">{l.usuario}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
