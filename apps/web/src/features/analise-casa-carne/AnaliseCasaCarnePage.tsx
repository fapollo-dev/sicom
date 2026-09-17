import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';

/**
 * ANÁLISE COMPRA × VENDA — CASA DE CARNE (`FRMANALISECOMPRAVENDACASACARNE`).
 * Dossiê: `uAnaliseCompraVendaCasaCarne.md`.
 *
 * A casa de carne compra a **peça** e vende os **cortes**. A tela casa os dois lados: o custo da peça desce
 * para cada corte pelo percentual da decomposição, e aí se vê se o rendimento do corte paga a peça.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const pct = (v: unknown) => `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

interface Linha {
  codproduto: number; descricao: string | null; codbarra: string | null; unidade: string | null;
  decomposicao: string | null; peca_descricao: string | null; peca: number | null;
  qtde_compra: number; custo_compra: number; qtde_venda: number; valor_venda: number;
  margem: number; margem_perc: number;
}
interface Resultado {
  linhas: Linha[];
  totais: { qtdeCompra: number; custoCompra: number; qtdeVenda: number; valorVenda: number; margem: number };
}

export function AnaliseCasaCarnePage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: diaUm(), dataFim: hoje(), produto: '', coddpto: '', codgrupo: '', somenteDecomposicao: 'N',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim, somenteDecomposicao: f.somenteDecomposicao });
      if (f.produto) q.set('produto', f.produto);
      if (f.coddpto) q.set('coddpto', f.coddpto);
      if (f.codgrupo) q.set('codgrupo', f.codgrupo);
      const r = await fetch(`${BASE}/relatorios/analise-casa-carne?${q}`, { headers: apiHeaders() });
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
      <PageHeader title="Análise de compra e venda — casa de carne" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Compra-se a <strong>peça</strong> e vende-se o <strong>corte</strong>. O custo da peça desce para
          cada corte pelo percentual da decomposição — é o que diz se o rendimento paga o que se pagou.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-56"><Field label="&Produto" value={f.produto} onChange={(e) => setF({ ...f, produto: e.target.value })} /></div>
          <div className="w-32"><Field label="&Departamento" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-32"><Field label="&Grupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
          <label className="flex items-center gap-gp-xs text-body-sm">
            <input type="checkbox" checked={f.somenteDecomposicao === 'S'}
              onChange={(e) => setF({ ...f, somenteDecomposicao: e.target.checked ? 'S' : 'N' })} />
            Só peças e cortes
          </label>
          <Button label="&Consultar" disabled={ocupado} onClick={() => void buscar()} />
          {res && (
            <Button variant="outline" label="&Exportar" onClick={() => exportarGradeCsv(
              res.linhas,
              [
                { titulo: 'Peça', valor: (l: Linha) => l.peca_descricao ?? '' },
                { titulo: 'Produto', valor: (l: Linha) => l.descricao },
                { titulo: 'Un', valor: (l: Linha) => l.unidade },
                { titulo: 'Qtde comprada', valor: (l: Linha) => nfmt(l.qtde_compra) },
                { titulo: 'Custo', valor: (l: Linha) => moeda(l.custo_compra) },
                { titulo: 'Qtde vendida', valor: (l: Linha) => nfmt(l.qtde_venda) },
                { titulo: 'Venda', valor: (l: Linha) => moeda(l.valor_venda) },
                { titulo: 'Margem', valor: (l: Linha) => moeda(l.margem) },
                { titulo: 'Margem %', valor: (l: Linha) => pct(l.margem_perc) },
              ],
              'analise-casa-carne',
            )} />
          )}
        </div>
      </section>

      {res && (
        <section className="flex flex-wrap gap-gp-lg rounded-radius-md border border-border bg-bg-surface p-pad-md">
          {[['Qtde comprada', nfmt(res.totais.qtdeCompra)], ['Custo', moeda(res.totais.custoCompra)],
            ['Qtde vendida', nfmt(res.totais.qtdeVenda)], ['Venda', moeda(res.totais.valorVenda)],
            ['Margem', moeda(res.totais.margem)]].map(([r, v]) => (
            <div key={String(r)}>
              <div className="text-body-sm text-fg-muted">{r}</div>
              <div className={`text-title-sm tabular-nums ${r === 'Margem' && res.totais.margem < 0 ? 'text-fg-danger' : ''}`}>{v}</div>
            </div>
          ))}
        </section>
      )}

      {res && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full min-w-[960px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Peça</th><th className="p-pad-xs">Produto</th>
                <th className="p-pad-xs">Un</th><th className="p-pad-xs">Qtde comprada</th>
                <th className="p-pad-xs">Custo</th><th className="p-pad-xs">Qtde vendida</th>
                <th className="p-pad-xs">Venda</th><th className="p-pad-xs">Margem</th>
                <th className="p-pad-xs">Margem %</th>
              </tr>
            </thead>
            <tbody>
              {res.linhas.map((l) => (
                <tr key={l.codproduto} className="border-b border-border">
                  <td className="p-pad-xs text-fg-muted">{l.peca_descricao ?? (l.decomposicao === 'S' ? '(peça)' : '')}</td>
                  <td className={`p-pad-xs ${l.decomposicao === 'S' ? 'font-semibold' : ''}`}>{l.descricao}</td>
                  <td className="p-pad-xs">{l.unidade}</td>
                  <td className="p-pad-xs tabular-nums">{nfmt(l.qtde_compra)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.custo_compra)}</td>
                  <td className="p-pad-xs tabular-nums">{nfmt(l.qtde_venda)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.valor_venda)}</td>
                  <td className={`p-pad-xs tabular-nums ${Number(l.margem) < 0 ? 'text-fg-danger' : ''}`}>{moeda(l.margem)}</td>
                  <td className="p-pad-xs tabular-nums">{pct(l.margem_perc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
