/**
 * A NF DE CUPOM — importar VENDAS na NF de saída (uNF.pas:13201; `nf-vendas.service.ts`): a pesquisa `GET_VENDAS`
 * por período, a prévia (itens + referências das NFC-e + OBS dos cupons ECF) e o vínculo no gravar.
 */
import { isErroResposta, type ErroResposta, type NfItemDto, type NfReferenciaDto } from '@apollo/shared';
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
  return (await res.json()) as T;
}

export interface CupomDisponivel {
  codvendas: number;
  nropedido: string;
  nrocupom: number;
  dtvenda: string | null;
  codparceiro: number | null;
  razao: string | null;
  operador: string | null;
  total: number | string;
  importado: 'S' | 'N';
  venda_nfc: 'S' | 'N';
  statusnfe: string | null;
}

export interface PreviaVendasNf {
  tipo: 'S';
  cfop: string;
  codparceiro: number | null;
  codparceiro_end: number | null;
  cupons: number[];
  naoProcessados: number[];
  reimportados: number[];
  referencias: NfReferenciaDto[];
  obs: string;
  itens: NfItemDto[];
}

export function listarCuponsDisponiveis(f: { data_ini: string; data_fim: string; nrocupom?: string }): Promise<CupomDisponivel[]> {
  const q = new URLSearchParams({ data_ini: f.data_ini, data_fim: f.data_fim, ...(f.nrocupom ? { nrocupom: f.nrocupom } : {}) });
  return req(`/fiscal/nf/vendas/disponiveis?${q.toString()}`, { method: 'GET' });
}

export function previaVendasNf(body: { codvendas: number[]; senhaAdm?: string }): Promise<PreviaVendasNf> {
  return req('/fiscal/nf/vendas/previa', { method: 'POST', body: JSON.stringify(body) });
}

export function vincularVendasNf(codnf: number, body: { codvendas: number[]; senhaAdm?: string }): Promise<{ codnf: number; vinculados: number[] }> {
  return req(`/fiscal/nf/${codnf}/vendas`, { method: 'POST', body: JSON.stringify(body) });
}
