/**
 * Fetcher de TROCA DE MERCADORIA COM FORNECEDOR. Agregado cadastro/troca (troca + itens_troca) + verticais
 * fechar/reabrir (baixa/estorno de estoque).
 */
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: (body as any)?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface TrocaHeader {
  codtroca: number;
  data: string | null;
  fornecedor?: string | null;
  qtde_itens?: number;
  valor_total?: number;
  status?: string | null; // ABERTA / FECHADA
}
export interface TrocaItem { coditenstroca?: number; idproduto: number; qtde: number; vrcusto?: number; fechado?: string | null }
export interface TrocaDetalhe extends TrocaHeader { codparceiro?: number | null; descricao?: string | null; itens: TrocaItem[] }

export function listarTrocas(): Promise<TrocaHeader[]> { return req('/cadastro/troca', { method: 'GET' }); }
export function obterTroca(id: number): Promise<TrocaDetalhe> { return req(`/cadastro/troca/${id}`, { method: 'GET' }); }
export function criarTroca(body: { codparceiro: number; descricao?: string; itens?: TrocaItem[] }): Promise<TrocaDetalhe> { return req('/cadastro/troca', { method: 'POST', body: JSON.stringify(body) }); }
export function atualizarTroca(id: number, body: { codparceiro: number; descricao?: string; itens: TrocaItem[] }): Promise<TrocaDetalhe> { return req(`/cadastro/troca/${id}`, { method: 'PUT', body: JSON.stringify(body) }); }
export function excluirTroca(id: number): Promise<void> { return req(`/cadastro/troca/${id}`, { method: 'DELETE' }); }
export function fecharTroca(id: number): Promise<{ codtroca: number; itens: number }> { return req(`/cadastro/troca/${id}/fechar`, { method: 'POST' }); }
export function reabrirTroca(id: number): Promise<{ codtroca: number; itens: number }> { return req(`/cadastro/troca/${id}/reabrir`, { method: 'POST' }); }
