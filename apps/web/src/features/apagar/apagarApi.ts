/**
 * Fetcher das AÇÕES de Contas a Pagar (corte-2 — BAIXA/pagamento). Gêmeo de `areceberApi.ts`.
 * ESCRITA/EFEITO: baixa quita o título (APAGAR_BX INDR='I' + QUITADA='S'); estorno é LÓGICO.
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

/** Baixa (paga) o título — juros default = fórmula legada; retorna valor pago + juros. */
export function baixarApagar(codapg: number, body: BaixarTituloDto): Promise<{ codapg: number; valorpg: number; juros: number; quitada: 'S' }> {
  return req(`/cadastro/apagar/${codapg}/baixar`, { body: JSON.stringify(body) });
}

/** Estorna o pagamento (INDR='E' lógico + reabre o título). */
export function estornarBaixaApagar(codapg: number): Promise<{ codapg: number; quitada: 'N' }> {
  return req(`/cadastro/apagar/${codapg}/estornar-baixa`);
}
