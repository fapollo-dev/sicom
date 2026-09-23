/**
 * IMPORTAR SCRAP na NF de saída (uNF.pas:1880; `nf-scrap.service.ts`): a lista `GET_SCRAP`, a prévia dos itens e o
 * vínculo no gravar (PEDIDO_NF + SCRAP.IMPORTADO). Envelope ErroResposta (ADR-015), como os demais fetchers da NF.
 */
import { isErroResposta, type ErroResposta, type NfItemDto } from '@apollo/shared';
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

export interface ScrapDisponivel {
  codscrap: number;
  dt_cadastro: string | null;
  razao: string | null;
  descricao: string | null;
  obs: string | null;
  importado: 'S' | 'N';
  mov_estoque: 'S' | 'N';
  valor: number | string | null;
  itens: number;
  codnf: number | null;
  nronf: string | null;
  status_nfe: string | null;
}

export interface PreviaScrapNf {
  tipo: 'S';
  cfop: string;
  codparceiro: number;
  codparceiro_end: number;
  scraps: number[];
  reimportados: number[];
  itens: NfItemDto[];
}

export interface CredenciaisLiberacao { login?: string; senha?: string }

export function listarScrapsDisponiveis(): Promise<ScrapDisponivel[]> {
  return req('/fiscal/nf/scrap/disponiveis', { method: 'GET' });
}

export function previaScrapNf(body: { codscraps: number[] } & CredenciaisLiberacao): Promise<PreviaScrapNf> {
  return req('/fiscal/nf/scrap/previa', { method: 'POST', body: JSON.stringify(body) });
}

export function vincularScrapNf(codnf: number, body: { codscraps: number[] } & CredenciaisLiberacao): Promise<{ codnf: number; vinculados: number[] }> {
  return req(`/fiscal/nf/${codnf}/scrap`, { method: 'POST', body: JSON.stringify(body) });
}
