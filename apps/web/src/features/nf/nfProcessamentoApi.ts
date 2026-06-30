/**
 * Fetcher das ações de PROCESSAMENTO da NF (F3 — movem estoque). Espelha `nfFiscalApi.ts`
 * (headers/BASE + envelope ErroResposta/ADR-015). Diferente do recalcular (puro), estas
 * ESCREVEM no servidor (movimento de estoque + flip de PROC, atômico). Erros (estoque
 * negativo, já processada, enviada à SEFAZ) sobem como envelope PT, exibido via `useMensagem`.
 */
import { isErroResposta, type ErroResposta } from '@apollo/shared';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const HEADERS = {
  'content-type': 'application/json',
  'x-tenant-id': 'pinheirao',
  'x-operador-id': '7',
  'x-empresa-id': '1',
};

async function req<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: HEADERS });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as T;
}

export interface ProcessamentoResultado {
  codnf: number;
  proc: 'S' | 'N';
}

/** Processa a NF: move o estoque (entrada soma / saída baixa) e trava a nota (proc='S'). */
export function processarNf(codnf: number): Promise<ProcessamentoResultado> {
  return req<ProcessamentoResultado>(`/fiscal/nf/${codnf}/processar`);
}

/** Reverte o processamento: estorna o estoque (sentido inverso) e libera a nota (proc='N'). */
export function reverterNf(codnf: number): Promise<ProcessamentoResultado> {
  return req<ProcessamentoResultado>(`/fiscal/nf/${codnf}/reverter`);
}
