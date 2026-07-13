/**
 * Fetcher das ações de NFe (F6 — mod.55, atrás da porta SEFAZ). Espelha `nfFaturamentoApi.ts`
 * (headers/BASE + envelope ErroResposta/ADR-015). ESCRITA/EFEITO FISCAL: transmitir autoriza a
 * NFe (gera chave/protocolo, STATUSNFE='P'); cancelar registra o evento (STATUSNFE='C', sem
 * tocar estoque/financeiro); cce registra carta de correção. No corte 1 o backend usa o
 * SIMULADOR de homologação (campo `simulado`); o provider real pluga sem mudar este contrato.
 */
import { isErroResposta, type ErroResposta, type CancelarNfDto, type CceNfDto } from '@apollo/shared';

import { apiHeaders, handle401 } from '../../shared/auth/session';
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as T;
}

export interface TransmissaoResultado {
  codnf: number;
  chave: string;
  statusnfe: 'P' | 'D';
  protocolo: string;
  cstat: number;
  ambiente: string;
  simulado: boolean;
}

export interface EventoResultado {
  codnf: number;
  protocolo: string;
  cstat: number;
  simulado: boolean;
}

/** Transmite a NFe (mod.55) à SEFAZ (via porta) e devolve chave + protocolo + status. */
export function transmitirNf(codnf: number): Promise<TransmissaoResultado> {
  return req<TransmissaoResultado>(`/fiscal/nf/${codnf}/transmitir`);
}

/** Cancela a NFe autorizada (justificativa ≥15). NÃO reverte estoque/financeiro. */
export function cancelarNf(codnf: number, body: CancelarNfDto): Promise<EventoResultado & { statusnfe: 'C' }> {
  return req<EventoResultado & { statusnfe: 'C' }>(`/fiscal/nf/${codnf}/cancelar`, { body: JSON.stringify(body) });
}

/** Envia carta de correção (texto ≥15, máx 20/nota). */
export function cceNf(codnf: number, body: CceNfDto): Promise<EventoResultado & { seq: number }> {
  return req<EventoResultado & { seq: number }>(`/fiscal/nf/${codnf}/cce`, { body: JSON.stringify(body) });
}
