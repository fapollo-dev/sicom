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
