import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';

/**
 * ANÁLISE DE VENDAS DE PRODUTOS (`FRMRELATORIOVENDASDINAMICO`).
 * Dossiê: `uRelatorioVendasDinamico.md`.
 *
 * O giro do período ao lado do cadastro — e, principalmente, **quando foi a última compra e por quanto**,
 * que é o que diz a que custo o item se repõe hoje.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

interface Linha {
  codproduto: number; codbarra: string | null; descricao: string | null; unidade: string | null;
  nomefor: string; fornecedor_ativo: string; nomedpto: string | null; nomegrupo: string | null;
  nomesubgrupo: string | null; qtde: number; dtultimavenda: string | null;
  venda_acumulada: number; custo_acumulado: number; vrcusto: number | null;
  dtultimacompra: string | null; ultimocusto: number | null;
  qtde_estoque: number; vrcusto_estoque: number;
}
interface Resultado {
  linhas: Linha[];
  totais: { produtos: number; qtde: number; venda: number; custo: number; margem: number; estoque: number };
}

export function RelVendasDinamicoPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: diaUm(), dataFim: hoje(), horaIni: '00:00', horaFim: '23:59',
    produto: '', codfor: '', coddpto: '', codgrupo: '', somenteAtivoCompra: 'S',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({
        dataIni: f.dataIni, dataFim: f.dataFim, horaIni: f.horaIni, horaFim: f.horaFim,
        somenteAtivoCompra: f.somenteAtivoCompra,
      });
      for (const k of ['produto', 'codfor', 'coddpto', 'codgrupo'] as const) if (f[k]) q.set(k, f[k]);
      const r = await fetch(`${BASE}/relatorios/vendas-dinamico?${q}`, { headers: apiHeaders() });
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
      <PageHeader title="Análise de vendas de produtos" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          O giro do período ao lado do cadastro, com a <strong>última compra e o custo dela</strong> — o que
          diz a que preço o item se repõe. Produto <em>sem fornecedor ou com fornecedor inativo</em> aparece,
          rotulado, em vez de sumir.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-28"><Field label="&Hora" type="time" value={f.horaIni} onChange={(e) => setF({ ...f, horaIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-28"><Field label="H&ora" type="time" value={f.horaFim} onChange={(e) => setF({ ...f, horaFim: e.target.value })} /></div>
          <div className="w-52"><Field label="&Produto" value={f.produto} onChange={(e) => setF({ ...f, produto: e.target.value })} /></div>
          <div className="w-32"><Field label="&Fornecedor" value={f.codfor} onChange={(e) => setF({ ...f, codfor: e.target.value })} /></div>
          <div className="w-32"><Field label="&Departamento" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-32"><Field label="&Grupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
          <label className="flex items-center gap-gp-xs text-body-sm">
            <input type="checkbox" checked={f.somenteAtivoCompra === 'S'}
              onChange={(e) => setF({ ...f, somenteAtivoCompra: e.target.checked ? 'S' : 'N' })} />
            Só ativos para compra
          </label>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void buscar()} />
          {res && (
            <Button variant="outline" label="&Exportar" onClick={() => exportarGradeCsv(
              res.linhas,
              [
                { titulo: 'EAN', valor: (l: Linha) => l.codbarra },
                { titulo: 'Produto', valor: (l: Linha) => l.descricao },
                { titulo: 'Fornecedor', valor: (l: Linha) => l.nomefor },
                { titulo: 'Departamento', valor: (l: Linha) => l.nomedpto },
                { titulo: 'Grupo', valor: (l: Linha) => l.nomegrupo },
                { titulo: 'Qtde vendida', valor: (l: Linha) => nfmt(l.qtde) },
                { titulo: 'Venda', valor: (l: Linha) => moeda(l.venda_acumulada) },
                { titulo: 'Custo', valor: (l: Linha) => moeda(l.custo_acumulado) },
                { titulo: 'Última venda', valor: (l: Linha) => dataBr(l.dtultimavenda) },
                { titulo: 'Última compra', valor: (l: Linha) => dataBr(l.dtultimacompra) },
                { titulo: 'Último custo', valor: (l: Linha) => moeda(l.ultimocusto) },
                { titulo: 'Estoque', valor: (l: Linha) => nfmt(l.qtde_estoque) },
              ],
              'analise-vendas-produtos',
            )} />
          )}
        </div>
      </section>

      {res && (
        <section className="flex flex-wrap gap-gp-lg rounded-radius-md border border-border bg-bg-surface p-pad-md">
          {[['Produtos', String(res.totais.produtos)], ['Qtde vendida', nfmt(res.totais.qtde)],
            ['Venda', moeda(res.totais.venda)], ['Custo', moeda(res.totais.custo)],
            ['Margem', moeda(res.totais.margem)], ['Estoque (custo)', moeda(res.totais.estoque)]].map(([r, v]) => (
            <div key={String(r)}>
              <div className="text-body-sm text-fg-muted">{r}</div>
              <div className="text-title-sm tabular-nums">{v}</div>
            </div>
          ))}
        </section>
      )}

      {res && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full min-w-[1200px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">EAN</th><th className="p-pad-xs">Produto</th>
                <th className="p-pad-xs">Fornecedor</th><th className="p-pad-xs">Grupo</th>
                <th className="p-pad-xs">Qtde</th><th className="p-pad-xs">Venda</th>
                <th className="p-pad-xs">Custo</th><th className="p-pad-xs">Últ. venda</th>
                <th className="p-pad-xs">Últ. compra</th><th className="p-pad-xs">Últ. custo</th>
                <th className="p-pad-xs">Estoque</th>
              </tr>
            </thead>
            <tbody>
              {res.linhas.map((l) => (
                <tr key={l.codproduto} className="border-b border-border">
                  <td className="p-pad-xs font-mono">{l.codbarra}</td>
                  <td className="p-pad-xs">{l.descricao}</td>
                  <td className={`p-pad-xs ${l.fornecedor_ativo === 'N' ? 'text-fg-muted' : ''}`}>
                    {l.nomefor}{l.fornecedor_ativo === 'N' ? ' (inativo)' : ''}
                  </td>
                  <td className="p-pad-xs">{l.nomegrupo}</td>
                  <td className="p-pad-xs tabular-nums">{nfmt(l.qtde)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.venda_acumulada)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.custo_acumulado)}</td>
                  <td className="p-pad-xs">{dataBr(l.dtultimavenda)}</td>
                  <td className="p-pad-xs">{dataBr(l.dtultimacompra)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.ultimocusto)}</td>
                  <td className="p-pad-xs tabular-nums">{nfmt(l.qtde_estoque)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
