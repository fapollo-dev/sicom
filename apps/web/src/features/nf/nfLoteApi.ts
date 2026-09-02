/**
 * Fetcher dos LOTES/VALIDADE do item da NF (`uNFLoteValidade`): `fiscal/nf/:codnf/itens/:codnfprod/lotes`.
 * Segunda porta de NF_PROD_LOTE (a primeira é a importação de XML). Envelope/headers no padrão dos demais.
 */
import { isErroResposta, type ErroResposta, type NfLoteDto } from '@apollo/shared';
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

export interface NfLoteRow {
  codnfprodlote: number; codnfprod: number; idempresa: number; idproduto: number;
  lote: string | null; dtvalidade: string | null; dtfabricacao: string | null;
}
export type NfLoteInput = { lote: string; dtvalidade: string; dtfabricacao?: string | null };
export type { NfLoteDto };

const base = (codnf: number, codnfprod: number) => `/fiscal/nf/${codnf}/itens/${codnfprod}/lotes`;

export function listarLotesItem(codnf: number, codnfprod: number): Promise<{ itens: NfLoteRow[] }> {
  return req(base(codnf, codnfprod), { method: 'GET' });
}
export function criarLoteItem(codnf: number, codnfprod: number, body: NfLoteInput): Promise<NfLoteRow> {
  return req(base(codnf, codnfprod), { method: 'POST', body: JSON.stringify(body) });
}
export function alterarLoteItem(codnf: number, codnfprod: number, codnfprodlote: number, body: NfLoteInput): Promise<NfLoteRow> {
  return req(`${base(codnf, codnfprod)}/${codnfprodlote}`, { method: 'PUT', body: JSON.stringify(body) });
}
export function excluirLoteItem(codnf: number, codnfprod: number, codnfprodlote: number): Promise<void> {
  return req(`${base(codnf, codnfprod)}/${codnfprodlote}`, { method: 'DELETE' });
}
