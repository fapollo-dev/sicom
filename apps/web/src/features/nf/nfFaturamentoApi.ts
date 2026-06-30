/**
 * Fetcher do FATURAMENTO da NF (F4 — gera títulos financeiros). Espelha `nfProcessamentoApi.ts`
 * (headers/BASE + envelope ErroResposta/ADR-015). ESCRITA/EFEITO: gera N parcelas em
 * ARECEBER (saída) / APAGAR (entrada) por IDNF, atômico. Erros (já faturada, total zero,
 * título quitado) sobem como envelope PT, exibido via `useMensagem`.
 */
import { isErroResposta, type ErroResposta, type FaturarNfDto } from '@apollo/shared';

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

export interface FaturamentoResultado {
  codnf: number;
  tabela: 'areceber' | 'apagar';
  parcelas: number;
}

/** Fatura a NF: gera N parcelas como títulos (ARECEBER/APAGAR) por IDNF. */
export function faturarNf(codnf: number, body: FaturarNfDto): Promise<FaturamentoResultado> {
  return req<FaturamentoResultado>(`/fiscal/nf/${codnf}/faturar`, { body: JSON.stringify(body) });
}

/** Estorna o faturamento: apaga os títulos por IDNF (bloqueado se houver título quitado). */
export function estornarFaturamentoNf(codnf: number): Promise<{ codnf: number; faturada: 'N' }> {
  return req<{ codnf: number; faturada: 'N' }>(`/fiscal/nf/${codnf}/estornar-faturamento`);
}
