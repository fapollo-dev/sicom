/**
 * Fetcher da DEVOLUÇÃO DE COMPRA (espelha pedidoCompraApi: apiHeaders/BASE + envelope ADR-015). CRUD do
 * agregado (compras/devolucao-compra) + o PICKER de saldo + as transições de estado (finalizar/reabrir/
 * cancelar). corte-1 sem efeitos.
 */
import {
  isErroResposta,
  type ErroResposta,
  type CriarDevolucaoCompraDto,
  type AtualizarDevolucaoCompraDto,
  type DevolucaoCompra,
  type ItemDisponivelDevolucao,
} from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const DEV = '/compras/devolucao-compra';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: (body as any)?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface ListarDevolucoesParams {
  campo?: string;
  operador?: string;
  valor?: string;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  situacao?: 'ativos' | 'inativos' | 'todos';
}

export function listarDevolucoes(params?: ListarDevolucoesParams): Promise<DevolucaoCompra[]> {
  const qs = new URLSearchParams();
  if (params) for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return req(`${DEV}${s ? `?${s}` : ''}`);
}

export function obterDevolucao(id: number): Promise<DevolucaoCompra> {
  return req(`${DEV}/${id}`);
}

export function criarDevolucao(dto: CriarDevolucaoCompraDto): Promise<DevolucaoCompra> {
  return req(DEV, { method: 'POST', body: JSON.stringify(dto) });
}

export function atualizarDevolucao(id: number, dto: AtualizarDevolucaoCompraDto): Promise<DevolucaoCompra> {
  return req(`${DEV}/${id}`, { method: 'PUT', body: JSON.stringify(dto) });
}

export function removerDevolucao(id: number): Promise<void> {
  return req(`${DEV}/${id}`, { method: 'DELETE' });
}

/** PICKER: itens de NF de entrada do fornecedor com saldo devolvível (opcional filtrar por 1 NF). */
export function itensDisponiveis(codparceiro: number, codnf?: number): Promise<ItemDisponivelDevolucao[]> {
  const qs = new URLSearchParams({ codparceiro: String(codparceiro) });
  if (codnf != null) qs.set('codnf', String(codnf));
  return req(`${DEV}/itens-disponiveis?${qs.toString()}`);
}

export function finalizarDevolucao(id: number): Promise<{ codpeddevcompra: number; status: string }> {
  return req(`${DEV}/${id}/finalizar`, { method: 'POST' });
}
export function reabrirDevolucao(id: number): Promise<{ codpeddevcompra: number; status: string }> {
  return req(`${DEV}/${id}/reabrir`, { method: 'POST' });
}
export function cancelarDevolucao(id: number): Promise<{ codpeddevcompra: number; status: string }> {
  return req(`${DEV}/${id}/cancelar`, { method: 'POST' });
}
