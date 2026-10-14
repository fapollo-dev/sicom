import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function req<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: res.status, code: 'ERRO', message: (b as any)?.message ?? res.statusText };
    throw Object.assign(new Error(env.code ?? res.statusText), { envelope: env, status: res.status, body: b });
  }
  return (await res.json()) as T;
}
const brl = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const q3 = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
const pct = (n: unknown) => (n == null ? '—' : `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

type Origem = 'V' | 'P' | 'T';
interface Posicao {
  empresas: number[]; origem: Origem; janela: { mesIni: string; mesFim: string; hoje: string };
  produto: Record<string, unknown>;
  lojas: Array<{ idempresa: number; vrcusto: number; vrvenda: number }>;
  estoques: Array<{ idempresa: number; qtde: number; qtde_dep: number | null }>;
  mensal: Array<{ data: string; qtde: number }>; total_mensal: number;
  entradas: Array<{ data: string; qtde: number }>; total_entradas: number;
  semanas: Array<{ semana: string; qtde: number }>; dias: Array<{ data: string; qtde: number }>; anual: Array<{ ano: number; qtde: number }>;
  compras: Array<{ data: string; qtde: number }>; pendentes: Array<{ nropedido: unknown; dtpedido: unknown; qtde: number; codfor: unknown; razao: unknown }>;
}
const TITULOS: Record<Origem, { mensal: string; semanas: string; dias: string; anual: string }> = {
  V: { mensal: 'Resumo mensal de saídas', semanas: 'Venda últimas semanas', dias: 'Venda últimos dias', anual: 'Venda média anual' },
  P: { mensal: 'Resumo mensal de pedidos', semanas: 'Pedido últimas semanas', dias: 'Pedido últimos dias', anual: 'Pedido média anual' },
  T: { mensal: 'Resumo mensal de saídas', semanas: 'Venda últimas semanas', dias: 'Venda últimos dias', anual: 'Venda média anual' },
};

/**
 * POSIÇÃO DO PRODUTO — o "[F7] - Análise geral do produto" do cadastro (`TfrmPosicaoProduto`, UPosicaoProduto.pas): os dados do produto e
 * do preço (custo e venda, as colunas do MULTI_PRECO), custo/venda e estoques por loja, e os resumos de movimento (mensal de saídas e de
 * entradas, últimas semanas, últimos dias, média anual, compras e pedidos pendentes), nas lojas escolhidas (o Ctrl+E do legado) e pela
 * origem das saídas (Vendas / Pedidos / Todos). Os botões Notas, Vendas e Kardex do legado abrem pesquisas do produto — aqui levam ao
 * Histórico das Movimentações do cadastro; com a opção Todos o legado os desabilita.
 */
export function PosicaoProdutoPage() {
  const mensagem = useMensagem();
  const navigate = useNavigate();
  const idproduto = Number(new URLSearchParams(window.location.search).get('idproduto'));
  const [empresas, setEmpresas] = useState('');
  const [origem, setOrigem] = useState<Origem>('V');
  const [pos, setPos] = useState<Posicao | null>(null);
  const [busy, setBusy] = useState(false);

  const listaEmpresas = () => empresas.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
  const carregar = async (o: Origem = origem) => {
    if (!idproduto) return;
    setBusy(true);
    try {
      const e = listaEmpresas();
      setPos(await req<Posicao>(`/cadastro/produtos/${idproduto}/posicao?origem=${o}${e.length ? `&empresas=${e.join(',')}` : ''}`));
    } catch (err) { mensagem.erro(err); } finally { setBusy(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); }, []);
  const mudarOrigem = (o: Origem) => { setOrigem(o); void carregar(o); };

  const p = pos?.produto ?? {};
  const t = TITULOS[origem];
  const g = (k: string) => p[k];
  const Tabela = ({ titulo, cab, linhas, rodape }: { titulo: string; cab: string[]; linhas: unknown[][]; rodape?: string }) => (
    <section className="rounded-radius-md border border-border bg-bg-surface">
      <div className="border-b border-border p-pad-xs text-body-sm font-semibold text-fg-muted">{titulo}</div>
      <table className="w-full text-body-sm">
        <thead><tr className="text-left text-fg-muted">{cab.map((c) => <th key={c} className="p-pad-xs">{c}</th>)}</tr></thead>
        <tbody>
          {linhas.map((l, i) => <tr key={i} className="border-t border-border">{l.map((v, j) => <td key={j} className={`p-pad-xs tabular-nums ${j === l.length - 1 ? 'text-right' : ''}`}>{String(v)}</td>)}</tr>)}
          {!linhas.length && <tr><td colSpan={cab.length} className="p-pad-xs text-fg-muted">—</td></tr>}
        </tbody>
        {rodape && <tfoot><tr className="border-t border-border font-semibold"><td colSpan={cab.length} className="p-pad-xs text-right tabular-nums">Total {rodape}</td></tr></tfoot>}
      </table>
    </section>
  );
  const campo = (rot: string, v: unknown, fmt: (x: unknown) => string = brl) => (
    <div><div className="text-body-xs text-fg-muted">{rot}</div><div className="tabular-nums">{fmt(v)}</div></div>
  );

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Posição do Produto" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="text-body-sm font-semibold">Análise geral do produto</div>
        <div className="w-44"><Field label="&Empresas (1,2)" value={empresas} onChange={(e) => setEmpresas(e.target.value)} placeholder="esta loja" /></div>
        <Button label="&Analisar" variant="soft" disabled={busy || !idproduto} onClick={() => void carregar()} />
        <div role="radiogroup" aria-label="Origem" className="flex items-center gap-gp-sm text-body-sm">
          {([['V', 'Vendas'], ['P', 'Pedidos'], ['T', 'Todos']] as const).map(([v, rot]) => (
            <label key={v} className="flex items-center gap-gp-xs"><input type="radio" name="origem" checked={origem === v} onChange={() => mudarOrigem(v)} /> {rot}</label>
          ))}
        </div>
        <Button label="&Notas" variant="ghost" disabled={origem === 'T' || !idproduto} onClick={() => navigate(`/cadastro/produtos?codigo=${idproduto}`)} />
        <Button label="&Vendas" variant="ghost" disabled={origem === 'T' || !idproduto} onClick={() => navigate(`/cadastro/produtos?codigo=${idproduto}`)} />
        <Button label="&Kardex" variant="ghost" disabled={origem === 'T' || !idproduto} onClick={() => navigate(`/cadastro/produtos?codigo=${idproduto}`)} />
        <Button label="&Sair" variant="ghost" onClick={() => navigate(-1)} />
        {pos && <small className="w-full text-fg-muted">Empresa(s) analisada(s): {pos.empresas.join(', ')} · período mensal {dia(pos.janela.mesIni)} a {dia(pos.janela.mesFim)}</small>}
      </div>

      {pos && (
        <>
          <section className="grid grid-cols-2 gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md md:grid-cols-5">
            <div className="col-span-2 md:col-span-5 text-body-sm font-semibold text-fg-muted">Dados do Produto</div>
            {campo('Código', g('codbarra'), String)}{campo('Descrição', g('descricao'), String)}{campo('Fornecedor', g('fornecedor') ?? '—', String)}
            {campo('Família', g('familia') ?? '—', String)}{campo('UN', g('unidade') ?? '—', String)}
          </section>
          <div className="grid grid-cols-1 gap-gp-md md:grid-cols-2">
            <section className="grid grid-cols-2 gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md md:grid-cols-4">
              <div className="col-span-2 md:col-span-4 text-body-sm font-semibold text-fg-muted">Dados preço custo</div>
              {campo('Frete', g('frete'))}{campo('IPI', g('ipi'))}{campo('Icm ST', g('icmst'))}{campo('Acessórias', g('despacessorio'))}
              {campo('Seguro', g('seguro'))}{campo('Icm', g('icm_efetivo'), pct)}{campo('Crédito ICMS', g('creditoicm'))}{campo('PIS/COFINS', g('creditopiscofins'))}
            </section>
            <section className="grid grid-cols-2 gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md md:grid-cols-5">
              <div className="col-span-2 md:col-span-5 text-body-sm font-semibold text-fg-muted">Dados preço venda</div>
              {campo('Débito ICMS', g('debitoicm'))}{campo('Déb PIS/COF', g('debitopiscofins'))}{campo('Venda líquida', g('vendaliq'))}{campo('Lucro bruto', g('lucrobrutov'))}
              {campo('Desp.Ope', g('despopv'))}{campo('Lucro líquido', g('lucroliqv'))}{campo('Imp. Renda', g('imprend'))}{campo('Cont. Social', g('contsocial'))}
              {campo('Lucro final %', g('margeml2'), pct)}{campo('Lucro final $', g('margeml2v'))}
            </section>
          </div>
          <div className="grid grid-cols-1 gap-gp-md md:grid-cols-2 lg:grid-cols-4">
            <Tabela titulo="Custos / Vendas" cab={['Loja', 'Custo', 'Venda']} linhas={pos.lojas.map((l) => [l.idempresa, brl(l.vrcusto), brl(l.vrvenda)])} />
            <Tabela titulo="Estoques" cab={['Emp', 'Est. loja', 'Est. dep.']} linhas={pos.estoques.map((e) => [e.idempresa, q3(e.qtde), e.qtde_dep == null ? '—' : q3(e.qtde_dep)])} />
            <Tabela titulo={t.mensal} cab={['Período', 'Qtde']} linhas={pos.mensal.map((x) => [x.data, q3(x.qtde)])} rodape={q3(pos.total_mensal)} />
            <Tabela titulo="Resumo mensal de entradas" cab={['Período', 'Qtde']} linhas={pos.entradas.map((x) => [x.data, q3(x.qtde)])} rodape={q3(pos.total_entradas)} />
            <Tabela titulo={t.semanas} cab={['Semana', 'Qtde']} linhas={pos.semanas.map((x) => [x.semana, q3(x.qtde)])} />
            <Tabela titulo={t.dias} cab={['Data', 'Qtde']} linhas={pos.dias.map((x) => [dia(x.data), q3(x.qtde)])} />
            <Tabela titulo={t.anual} cab={['Ano', 'Qtde']} linhas={pos.anual.map((x) => [x.ano, q3(x.qtde)])} />
            <Tabela titulo="Compras" cab={['Período', 'Qtde']} linhas={pos.compras.map((x) => [x.data, q3(x.qtde)])} />
          </div>
          <Tabela titulo="Pedidos de compra pendentes" cab={['Pedido', 'Data', 'Fornecedor', 'Qtde']}
            linhas={pos.pendentes.map((x) => [String(x.nropedido ?? ''), dia(x.dtpedido), `${String(x.codfor ?? '')} ${String(x.razao ?? '')}`.trim(), q3(x.qtde)])} />
        </>
      )}
    </div>
  );
}
