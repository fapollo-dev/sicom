/**
 * Fetcher da CONCILIAÇÃO BANCÁRIA (OFX). Importa linhas do extrato, lista pendentes (extrato × razão interno),
 * sugere o casamento automático (data+valor) e concilia (marca os dois lados + evento CB).
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

export interface ContaBancaria { codconta: number; banco?: string | null; titular?: string | null }
export interface OfxLinha { mbo_id: number; mbo_data: string | null; mbo_valor: number; mbo_credito_debito: string; mbo_descricao?: string | null; mbo_transacao_id?: string | null }
export interface MovLinha { codmovconta: number; data: string | null; valor: number; tipomovimento?: string | null; historico?: string | null; origem?: string | null }
export interface Par { mbo_id: number; codmovconta: number; valor: number; data: string }

export function listarContas(): Promise<ContaBancaria[]> { return req('/cadastro/contas-bancarias', { method: 'GET' }); }
export function pendentes(codconta: number): Promise<{ ofx: OfxLinha[]; mov: MovLinha[] }> { return req(`/cadastro/conciliacao-bancaria/pendentes?codconta=${codconta}`, { method: 'GET' }); }
export function sugestoes(codconta: number): Promise<{ pares: Par[] }> { return req(`/cadastro/conciliacao-bancaria/sugestoes?codconta=${codconta}`, { method: 'GET' }); }
export function conciliar(codconta: number, mboIds: number[], codmovcontas: number[]): Promise<{ cb_id: number; ofx: number; mov: number; total: number }> {
  return req('/cadastro/conciliacao-bancaria/conciliar', { method: 'POST', body: JSON.stringify({ codconta, mboIds, codmovcontas }) });
}
