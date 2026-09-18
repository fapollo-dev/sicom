import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * CONSULTA DE PRODUTOS (`FRMCONSPROD`) + ANÁLISE GERAL DO PRODUTO (`FRMPOSICAOPRODUTO`).
 * Dossiê: `uConsProd.md`.
 *
 * A consulta é a porta: descrição, código de barras ou código no mesmo campo, e a linha já traz os preços.
 * Clicando no produto abre a análise geral — a escada de custo→lucro (lida da precificação), o estoque e o
 * preço de cada loja lado a lado, e o movimento em quatro janelas, tirado da **venda**, não de cache.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qt = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));

interface Linha { idproduto: number; codbarra: string; descricao: string; unidade: string;
  vrcusto: number; vrcustoreal: number; vrpromo: number; vrvenda: number; promocao: string; fornecedor: string | null }

interface Posicao {
  produto: Record<string, unknown>;
  custo: Record<string, number>;
  venda: Record<string, number>;
  lojas: Array<Record<string, number>>;
  mensal: Array<Record<string, unknown>>;
  diario: Array<Record<string, unknown>>;
  semanal: Array<Record<string, unknown>>;
  anual: Array<Record<string, unknown>>;
  entradas: Array<Record<string, unknown>>;
  compras: Array<Record<string, unknown>>;
  pendentes: Array<Record<string, unknown>>;
  totais: Record<string, number>;
}

const ORIGENS = [
  { k: 'V', rotulo: 'Vendas' },
  { k: 'P', rotulo: 'Pedidos' },
  { k: 'T', rotulo: 'Todos' },
] as const;

/** a escada: cada degrau com o seu rótulo, na ordem em que o legado a desenha. */
const DEGRAUS_CUSTO: Array<[string, string]> = [
  ['vrcusto', 'Custo'], ['frete', 'Frete'], ['ipi', 'IPI'], ['icmst', 'ICMS ST'],
  ['despacessorio', 'Desp. acessórias'], ['seguro', 'Seguro'], ['icmEfetivo', 'ICMS efetivo'],
  ['creditoicm', 'Crédito ICMS'], ['creditopiscofins', 'Crédito PIS/COFINS'], ['vrcustoreal', 'Custo real'],
];
const DEGRAUS_VENDA: Array<[string, string]> = [
  ['vrvenda', 'Venda'], ['debitoicm', 'Débito ICMS'], ['debitopiscofins', 'Débito PIS/COFINS'],
  ['vendaliq', 'Venda líquida'], ['lucrobrutov', 'Lucro bruto'], ['despopv', 'Desp. operacional'],
  ['lucroliqv', 'Lucro líquido'], ['imprend', 'Imposto de renda'], ['contsocial', 'Contribuição social'],
];

export function ConsultaProdutoPage() {
  const mensagem = useMensagem();
  const [termo, setTermo] = useState('');
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [sel, setSel] = useState<Linha | null>(null);
  const [origem, setOrigem] = useState<string>('V');
  const [pos, setPos] = useState<Posicao | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const pedir = async <T,>(url: string): Promise<T> => {
    const r = await fetch(url, { headers: apiHeaders() });
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
      setPos(null); setSel(null);
      setLinhas(await pedir<Linha[]>(`${BASE}/relatorios/consulta-produto?termo=${encodeURIComponent(termo)}`));
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const analisar = async (l: Linha, org = origem) => {
    setOcupado(true);
    try {
      setSel(l); setOrigem(org);
      setPos(await pedir<Posicao>(`${BASE}/relatorios/consulta-produto/posicao/${l.idproduto}?origem=${org}`));
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Consulta de produtos" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Descrição, código de barras ou código — os três no mesmo campo. A linha já traz o preço da sua loja;
          clicando nela abre a <strong>análise geral</strong> do produto.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-96">
            <Field label="&Produto" value={termo} onChange={(e) => setTermo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }} />
          </div>
          <Button label="&Consultar" disabled={ocupado || termo.trim() === ''} onClick={() => void buscar()} />
        </div>
      </section>

      {linhas && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full min-w-[880px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Código</th><th className="p-pad-xs">Código de barras</th>
                <th className="p-pad-xs">Descrição</th><th className="p-pad-xs">Un</th>
                <th className="p-pad-xs text-right">Custo</th><th className="p-pad-xs text-right">Custo real</th>
                <th className="p-pad-xs text-right">Promoção</th><th className="p-pad-xs text-right">Venda</th>
                <th className="p-pad-xs">Fornecedor</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.idproduto} onClick={() => void analisar(l)}
                  className={`cursor-pointer border-b border-border hover:bg-bg-subtle ${sel?.idproduto === l.idproduto ? 'bg-bg-subtle font-semibold' : ''}`}>
                  <td className="p-pad-xs tabular-nums">{l.idproduto}</td>
                  <td className="p-pad-xs tabular-nums">{l.codbarra}</td>
                  <td className="p-pad-xs">{l.descricao}</td>
                  <td className="p-pad-xs">{l.unidade}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.vrcusto)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.vrcustoreal)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{l.promocao === 'S' ? moeda(l.vrpromo) : ''}</td>
                  <td className="p-pad-xs text-right tabular-nums font-semibold">{moeda(l.vrvenda)}</td>
                  <td className="p-pad-xs">{l.fornecedor ?? ''}</td>
                </tr>
              ))}
              {linhas.length === 0 && (
                <tr><td colSpan={9} className="p-pad-md text-center text-fg-muted">Nenhum produto encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {pos && sel && (
        <>
          <PageHeader title={`Análise geral — ${String(pos.produto.descricao ?? '')}`} />

          <div className="grid gap-gp-md md:grid-cols-2">
            <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
              <h3 className="mb-form-gap text-body-sm font-semibold">Composição do custo</h3>
              <table className="w-full border-collapse text-body-sm">
                <tbody>
                  {DEGRAUS_CUSTO.map(([k, rotulo]) => (
                    <tr key={k} className="border-b border-border">
                      <td className="p-pad-xs text-fg-muted">{rotulo}</td>
                      <td className="p-pad-xs text-right tabular-nums">{moeda(pos.custo[k])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
              <h3 className="mb-form-gap text-body-sm font-semibold">Da venda ao lucro líquido</h3>
              <table className="w-full border-collapse text-body-sm">
                <tbody>
                  {DEGRAUS_VENDA.map(([k, rotulo]) => (
                    <tr key={k} className="border-b border-border">
                      <td className="p-pad-xs text-fg-muted">{rotulo}</td>
                      <td className={`p-pad-xs text-right tabular-nums ${k === 'lucroliqv' && Number(pos.venda[k]) < 0 ? 'font-semibold text-fg-danger' : ''}`}>
                        {moeda(pos.venda[k])}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-b border-border">
                    <td className="p-pad-xs text-fg-muted">Margem líquida</td>
                    <td className="p-pad-xs text-right tabular-nums">{Number(pos.venda.margeml2 ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} %</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>

          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <h3 className="mb-form-gap text-body-sm font-semibold">Estoque e preço por loja</h3>
            <table className="w-full border-collapse text-body-sm">
              <thead>
                <tr className="border-b border-border text-left text-fg-muted">
                  <th className="p-pad-xs">Loja</th><th className="p-pad-xs text-right">Estoque</th>
                  <th className="p-pad-xs text-right">Depósito</th><th className="p-pad-xs text-right">Custo</th>
                  <th className="p-pad-xs text-right">Venda</th>
                </tr>
              </thead>
              <tbody>
                {pos.lojas.map((l) => (
                  <tr key={String(l.idempresa)} className="border-b border-border">
                    <td className="p-pad-xs tabular-nums">{String(l.idempresa)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{qt(l.qtde)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{qt(l.qtdeDeposito)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{moeda(l.vrcusto)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{moeda(l.vrvenda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="flex flex-wrap items-center gap-gp-xs">
            <span className="text-body-sm text-fg-muted">Movimento por:</span>
            {ORIGENS.map((o) => (
              <button key={o.k} type="button" disabled={ocupado} onClick={() => void analisar(sel, o.k)}
                className={`rounded-radius-sm border px-pad-sm py-pad-xs text-body-sm ${o.k === origem ? 'border-border bg-bg-subtle font-semibold' : 'border-transparent text-fg-muted hover:bg-bg-subtle'}`}>
                {o.rotulo}
              </button>
            ))}
            <span className="ml-gp-sm text-body-sm text-fg-muted">
              média anual <strong className="tabular-nums">{qt(pos.totais.mediaAnual)}</strong>
            </span>
          </div>

          <div className="grid gap-gp-md md:grid-cols-2 xl:grid-cols-4">
            <QuadroSerie titulo="Resumo mensal" linhas={pos.mensal.map((r) => [String(r.periodo), qt(r.qtde)])} />
            <QuadroSerie titulo="Últimas semanas" linhas={pos.semanal.map((r) => [`${dataBr(r.ini)} a ${dataBr(r.fim)}`, qt(r.qtde)])} />
            <QuadroSerie titulo="Últimos dias" linhas={pos.diario.map((r) => [dataBr(r.data), qt(r.qtde)])} />
            <QuadroSerie titulo="Por ano" linhas={pos.anual.map((r) => [String(r.ano), qt(r.qtde)])} />
          </div>

          <div className="grid gap-gp-md md:grid-cols-3">
            <QuadroSerie titulo="Entradas por mês" linhas={pos.entradas.map((r) => [String(r.periodo), qt(r.qtde)])} />
            <QuadroSerie titulo="Compras por mês" linhas={pos.compras.map((r) => [String(r.periodo), qt(r.qtde)])} />
            <QuadroSerie titulo="Pedidos pendentes"
              linhas={pos.pendentes.map((r) => [`${String(r.nropedido)} · ${dataBr(r.dtpedido)} · ${String(r.razao ?? '')}`, qt(r.qtde)])} />
          </div>
        </>
      )}
    </div>
  );
}

function QuadroSerie({ titulo, linhas }: { titulo: string; linhas: Array<[string, string]> }) {
  return (
    <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
      <h3 className="mb-form-gap text-body-sm font-semibold">{titulo}</h3>
      {linhas.length === 0 ? (
        <p className="text-body-sm text-fg-muted">Sem movimento.</p>
      ) : (
        <table className="w-full border-collapse text-body-sm">
          <tbody>
            {linhas.map(([rotulo, valor], i) => (
              <tr key={i} className="border-b border-border">
                <td className="p-pad-xs text-fg-muted">{rotulo}</td>
                <td className="p-pad-xs text-right tabular-nums">{valor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
