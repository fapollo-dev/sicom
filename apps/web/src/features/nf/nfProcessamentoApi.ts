/**
 * Fetcher das ações de PROCESSAMENTO da NF (F3 — movem estoque). Espelha `nfFiscalApi.ts`
 * (headers/BASE + envelope ErroResposta/ADR-015). Diferente do recalcular (puro), estas
 * ESCREVEM no servidor (movimento de estoque + flip de PROC, atômico). Erros (estoque
 * negativo, já processada, enviada à SEFAZ) sobem como envelope PT, exibido via `useMensagem`.
 */
import { isErroResposta, type ErroResposta } from '@apollo/shared';

import { apiHeaders, handle401 } from '../../shared/auth/session';
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function req<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: apiHeaders(), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
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

export interface ParDeSincronizacao { de: string; para: string }

/**
 * Sincroniza CFOP, alíquota e CST dos itens por de-para (uSincronizaCFOPNotaFiscal): cada item com o valor "de" recebe o "para" uma
 * vez, e todos saem marcados como sincronizados. Grava direto (a nota tem de estar editável).
 */
export function sincronizarNf(codnf: number, pares: { mapa: ParDeSincronizacao[]; aliquotas: ParDeSincronizacao[]; csts: ParDeSincronizacao[] }): Promise<{ codnf: number; itens: number; sincronizados: number }> {
  return req(`/fiscal/nf/${codnf}/sincronizar-cfop`, pares);
}

export interface RepasseAutomaticoResultado { codnf: number; itens: number; comIndexador: number; repassados: number }

/**
 * A análise automática dos itens de entrada — [F7] todos, ou [F8] um (`codnfprod`) — UAnalisaItemNF: relê o produto, consulta o indexador
 * de novo e refaz o ST externo, a base/ICMS e o custo de cada item. Grava no servidor; a tela relê a nota depois.
 */
export function repasseAutomaticoNf(codnf: number, codnfprod?: number): Promise<RepasseAutomaticoResultado> {
  return req<RepasseAutomaticoResultado>(`/fiscal/nf/${codnf}/repasse-automatico${codnfprod != null ? `?item=${codnfprod}` : ''}`);
}

/** relê a nota gravada (GET do agregado) — para refletir na tela o que uma ação do servidor mudou */
export async function lerNf(codnf: number): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/fiscal/nf/${codnf}`, { headers: apiHeaders() });
  handle401(res);
  if (!res.ok) throw Object.assign(new Error('ERRO'), { status: res.status });
  return (await res.json()) as Record<string, unknown>;
}
