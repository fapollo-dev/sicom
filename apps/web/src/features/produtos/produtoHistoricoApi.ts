/**
 * HISTÓRICO DAS MOVIMENTAÇÕES do produto (aba do UCadProduto): GET /cadastro/produtos/:id/historico/:aba com o período e as lojas.
 * A impressão de cada aba e a da composição vão pelo `imprimirRelatorio` (o .fr3 do cliente).
 */
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export type AbaHistorico = 'vendas' | 'pedidos' | 'pedido-compra' | 'entradas' | 'saidas' | 'estoque' | 'fornecedores' | 'promocao' | 'inventario-rotativo';
export interface FiltroHistorico { dtini: string; dtfim: string; empresas: string }
export interface RespostaHistorico { linhas: Array<Record<string, unknown>>; totais: Record<string, number>; empresas: number[] }

export const consultaHistorico = (f: FiltroHistorico): string =>
  new URLSearchParams(Object.entries({ dtini: f.dtini, dtfim: f.dtfim, empresas: f.empresas.replace(/\s/g, '') }).filter(([, v]) => v !== '')).toString();

export async function getHistorico(idproduto: number, aba: AbaHistorico, f: FiltroHistorico): Promise<RespostaHistorico> {
  const res = await fetch(`${BASE}/cadastro/produtos/${idproduto}/historico/${aba}?${consultaHistorico(f)}`, { headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error((body as { message?: string })?.message ?? `HTTP ${res.status}`), { status: res.status, body, envelope: body });
  }
  return (await res.json()) as RespostaHistorico;
}

/** o destino do "Detalhar" de uma linha do kardex (o `ProcessaHistorico` do legado, no servidor) */
export type DetalheKardex =
  | { destino: 'venda'; nropedido: string; idempresa: number }
  | { destino: 'pedido'; nropedido: string }
  | { destino: 'nf'; codnf: number; tipo: 'E' | 'S' }
  | { destino: 'ajuste'; data: string; idproduto: number };

export async function getDetalheKardex(idproduto: number, codmov: number): Promise<DetalheKardex> {
  const res = await fetch(`${BASE}/cadastro/produtos/${idproduto}/historico/estoque/${codmov}/detalhe`, { headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error((body as { message?: string })?.message ?? `HTTP ${res.status}`), { status: res.status, body, envelope: body });
  }
  return (await res.json()) as DetalheKardex;
}

/** a tela que o "Detalhar" abre (numa aba nova: o cadastro do produto continua aberto, como o modal do legado) */
export function rotaDoDetalhe(d: DetalheKardex): string {
  switch (d.destino) {
    case 'venda': return `/vendas/historico?nropedido=${encodeURIComponent(d.nropedido)}&empresa=${d.idempresa}`;
    case 'pedido': return `/vendas/historico?balcao=1&nropedido=${encodeURIComponent(d.nropedido)}`;
    case 'nf': return `/fiscal/notas/${d.tipo === 'E' ? 'entrada' : 'saida'}?codigo=${d.codnf}`;
    case 'ajuste': return `/estoque/ajuste?idproduto=${d.idproduto}&data=${d.data}`;
  }
}
