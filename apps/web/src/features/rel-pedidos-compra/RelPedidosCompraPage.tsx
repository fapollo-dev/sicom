import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirPagina } from '../../shared/print/imprimirPagina';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type FiltroData = 'PEDIDO' | 'VENCIMENTO' | 'FATURAMENTO' | 'PARCELA';
type Status = 'TODOS' | 'ABERTOS' | 'FECHADOS';
type Agrupamento = 'FORNECEDOR' | 'DATA_PEDIDO' | 'VENCIMENTO' | 'FATURAMENTO' | 'VENC_PARCELA';

interface Pedido {
  nropedido: number; codparceiro: number | null; fornecedor: string | null; data_pedido: string | null;
  data_vencimento: string | null; data_faturamento: string | null; idempresa: number; fechado: boolean;
  prazos: number[]; valor: number;
}
interface Parcela {
  idempresa: number; nropedido: number; fornecedor: string | null; data_pedido: string | null; dt_vencimento: string | null;
  dt_faturamento: string | null; dt_venc_parc: string; condpag: number; valor_parcela: number; status: string;
}
interface Resultado {
  pedidos: Pedido[];
  grupos: Array<{ chave: string | null; total: number; parcelas: Parcela[] }>;
  totais: { registros: number; valor: number; parcelas: number };
}

const FILTROS: Array<{ v: FiltroData; rotulo: string }> = [
  { v: 'PEDIDO', rotulo: 'Data do pedido' },
  { v: 'VENCIMENTO', rotulo: 'Vencimento do pedido' },
  { v: 'FATURAMENTO', rotulo: 'Data de faturamento' },
  { v: 'PARCELA', rotulo: 'Vencimento da parcela' },
];
const AGRUPAMENTOS: Array<{ v: Agrupamento; rotulo: string }> = [
  { v: 'FORNECEDOR', rotulo: 'Fornecedor' },
  { v: 'DATA_PEDIDO', rotulo: 'Data do pedido' },
  { v: 'VENCIMENTO', rotulo: 'Vencimento do pedido' },
  { v: 'FATURAMENTO', rotulo: 'Data de faturamento' },
  { v: 'VENC_PARCELA', rotulo: 'Vencimento da parcela' },
];

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

/**
 * RELATÓRIO DE PEDIDOS DE COMPRA — previsão de pagamentos (`FRMRELPEDIDOCOMPRA`, uRelPedidosCompra.pas).
 * Dossiê: `uRelPedidosCompra.md`.
 *
 * A grade mostra cada pedido POR LOJA com o valor dela; a impressão desdobra cada linha nas parcelas da condição
 * (valor ÷ nº de prazos, vencendo no faturamento + prazo) e quebra pelo agrupamento escolhido — um `.fr3` por
 * opção no legado, com o total de cada grupo e o total geral.
 */
export function RelPedidosCompraPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: diaUm(), dataFim: hoje(), filtroData: 'PEDIDO' as FiltroData, status: 'TODOS' as Status,
    agrupamento: 'FORNECEDOR' as Agrupamento, codparceiro: '', razao: '', empresas: '',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v !== '') q.set(k, String(v)); });
      const r = await fetch(`${BASE}/relatorios/pedidos-compra?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const imprimir = () => {
    if (!res) return;
    const win = window.open('', '_blank', 'width=1024,height=768');
    if (!win) { mensagem.erro('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
    const raiz = document.getElementById('rel-pedidos-impressao');
    if (!raiz) { win.close(); return; }
    const periodo = `${FILTROS.find((x) => x.v === f.filtroData)?.rotulo} de ${dataBr(f.dataIni)} até ${dataBr(f.dataFim)}`;
    imprimirPagina(win, raiz, `Pedidos de compra — previsão de pagamentos · ${periodo}`, undefined, true);
  };

  const cols = useMemo<DataTableColumnDef<Pedido>[]>(() => [
    { field: 'nropedido', headerName: 'Pedido', type: 'number', width: 90, isPrimary: true },
    { field: 'idempresa', headerName: 'Loja', type: 'number', width: 70 },
    { field: 'codparceiro', headerName: 'Cód. forn.', type: 'number', width: 95 },
    { field: 'fornecedor', headerName: 'Fornecedor', type: 'text' },
    { field: 'data_pedido', headerName: 'Data', type: 'text', width: 105, valueGetter: (p) => dataBr(p.data_pedido) },
    { field: 'data_vencimento', headerName: 'Venc. pedido', type: 'text', width: 115, valueGetter: (p) => dataBr(p.data_vencimento) },
    { field: 'data_faturamento', headerName: 'Faturamento', type: 'text', width: 115, valueGetter: (p) => dataBr(p.data_faturamento) },
    { field: 'prazos', headerName: 'Prazos', type: 'text', width: 110, valueGetter: (p) => p.prazos.join('-') },
    { field: 'fechado', headerName: 'Status', type: 'text', width: 90, valueGetter: (p) => (p.fechado ? 'Fechado' : 'Aberto') },
    { field: 'valor', headerName: 'Valor', type: 'text', width: 130, valueGetter: (p) => moeda(p.valor) },
  ], []);

  const sel = 'rounded border border-border px-1 py-1';
  const rotuloGrupo = AGRUPAMENTOS.find((a) => a.v === f.agrupamento)?.rotulo ?? '';

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Relatório de pedidos de compra" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Filtro de datas
            <select className={sel} value={f.filtroData} onChange={(e) => setF({ ...f, filtroData: e.target.value as FiltroData })}>
              {FILTROS.map((x) => <option key={x.v} value={x.v}>{x.rotulo}</option>)}
            </select>
          </label>
          <div className="w-40"><Field label="&Período" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Status do pedido
            <select className={sel} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Status })}>
              <option value="TODOS">Todos</option><option value="ABERTOS">Abertos</option><option value="FECHADOS">Fechados</option>
            </select>
          </label>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Agrupamento
            <select className={sel} value={f.agrupamento} onChange={(e) => setF({ ...f, agrupamento: e.target.value as Agrupamento })}>
              {AGRUPAMENTOS.map((x) => <option key={x.v} value={x.v}>{x.rotulo}</option>)}
            </select>
          </label>
          <Button label="&Consultar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={!res || !res.grupos.length} onClick={imprimir} />
        </div>
        <div className="mt-form-gap flex flex-wrap items-end gap-gp-sm">
          <div className="w-32"><Field label="&Fornecedor" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value })} /></div>
          <div className="w-56"><Field label="Busca pela &razão" value={f.razao} onChange={(e) => setF({ ...f, razao: e.target.value })} /></div>
          <div className="w-40"><Field label="&Lojas (vírgula)" value={f.empresas} onChange={(e) => setF({ ...f, empresas: e.target.value })} /></div>
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Registros</div><div className="text-body-lg tabular-nums">{res.totais.registros}</div></div>
              <div><div className="text-body-sm text-fg-muted">Valor dos pedidos</div><div className="text-body-lg tabular-nums">{moeda(res.totais.valor)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Em parcelas</div><div className="text-body-lg tabular-nums">{moeda(res.totais.parcelas)}</div></div>
            </div>
            {res.totais.parcelas < res.totais.valor && (
              <p className="mt-form-gap text-body-sm text-fg-muted">
                Pedido sem prazo de pagamento, ou sem data de faturamento, não gera parcela: fica na grade e não entra na impressão.
              </p>
            )}
          </section>
          <DataTable rows={res.pedidos} columns={cols} getRowId={(p: Pedido) => `${p.nropedido}-${p.idempresa}`} />

          {/* a impressão: as parcelas quebradas pelo agrupamento, com o total de cada grupo e o geral */}
          <div id="rel-pedidos-impressao" className="hidden">
            <p>Status dos pedidos: {f.status === 'TODOS' ? 'abertos e fechados' : f.status === 'ABERTOS' ? 'abertos' : 'fechados'} · Agrupamento: {rotuloGrupo}</p>
            {res.grupos.map((g, i) => (
              <div key={i}>
                <h3>{rotuloGrupo}: {f.agrupamento === 'FORNECEDOR' ? (g.chave ?? '(sem fornecedor)') : dataBr(g.chave)}</h3>
                <table>
                  <thead><tr>
                    <th>Pedido</th><th>Data</th><th className="text-right">Valor da parc.</th><th>Venc. parc.</th>
                    <th>Venc. pedido</th><th className="text-right">Cond. pagto</th><th>Status</th><th>Loja</th><th>Faturamento</th>
                    {f.agrupamento !== 'FORNECEDOR' && <th>Fornecedor</th>}
                  </tr></thead>
                  <tbody>{g.parcelas.map((v, j) => (
                    <tr key={j}>
                      <td>{v.nropedido}</td><td>{dataBr(v.data_pedido)}</td><td className="text-right tabular-nums">{moeda(v.valor_parcela)}</td>
                      <td>{dataBr(v.dt_venc_parc)}</td><td>{dataBr(v.dt_vencimento)}</td><td className="text-right">{v.condpag}</td>
                      <td>{v.status}</td><td>{v.idempresa}</td><td>{dataBr(v.dt_faturamento)}</td>
                      {f.agrupamento !== 'FORNECEDOR' && <td>{v.fornecedor}</td>}
                    </tr>))}</tbody>
                </table>
                <p><strong>Total do grupo: {moeda(g.total)}</strong></p>
              </div>
            ))}
            <p><strong>Total geral: {moeda(res.totais.parcelas)}</strong></p>
          </div>
        </>
      )}
    </div>
  );
}
