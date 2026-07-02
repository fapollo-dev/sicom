/**
 * Fetcher das AÇÕES de Contas a Receber (corte-2 — BAIXA/recebimento). Espelha `nfFaturamentoApi.ts`
 * (headers/BASE + envelope ErroResposta/ADR-015). ESCRITA/EFEITO: baixa quita o título (ARECEBER_BX
 * INDR='I' + QUITADA='S'); estorno é LÓGICO (INDR='E' + reabre). Erros (já baixado, em lote, não
 * baixado) sobem como envelope PT, exibido via `useMensagem`.
 */
import { isErroResposta, type ErroResposta, type BaixarTituloDto } from '@apollo/shared';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const HEADERS = {
  'content-type': 'application/json',
  'x-tenant-id': 'pinheirao',
  'x-operador-id': '7',
  'x-empresa-id': '1',
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', ...init, headers: HEADERS });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as T;
}

/** Baixa (quita) o título — juros default = fórmula legada; retorna valor pago + juros. */
export function baixarTitulo(codrcb: number, body: BaixarTituloDto): Promise<{ codrcb: number; valorpg: number; juros: number; quitada: 'S' }> {
  return req(`/cadastro/areceber/${codrcb}/baixar`, { body: JSON.stringify(body) });
}

/** Estorna a baixa (INDR='E' lógico + reabre o título). */
export function estornarBaixaTitulo(codrcb: number): Promise<{ codrcb: number; quitada: 'N' }> {
  return req(`/cadastro/areceber/${codrcb}/estornar-baixa`);
}
