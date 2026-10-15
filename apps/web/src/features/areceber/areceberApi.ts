/**
 * Fetcher das AÇÕES de Contas a Receber (corte-2 — BAIXA/recebimento). Espelha `nfFaturamentoApi.ts`
 * (headers/BASE + envelope ErroResposta/ADR-015). ESCRITA/EFEITO: baixa quita o título (ARECEBER_BX
 * INDR='I' + QUITADA='S'); estorno é LÓGICO (INDR='E' + reabre). Erros (já baixado, em lote, não
 * baixado) sobem como envelope PT, exibido via `useMensagem`.
 */
import { isErroResposta, type ErroResposta, type BaixarTituloDto } from '@apollo/shared';

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

/** Baixa (quita) o título — juros default = fórmula legada; retorna valor pago + juros. */
export function baixarTitulo(codrcb: number, body: BaixarTituloDto): Promise<{ codrcb: number; valorpg: number; juros: number; quitada: 'S' }> {
  return req(`/cadastro/areceber/${codrcb}/baixar`, { body: JSON.stringify(body) });
}

/** Estorna a baixa (INDR='E' lógico + reabre o título). */
export function estornarBaixaTitulo(codrcb: number): Promise<{ codrcb: number; quitada: 'N' }> {
  return req(`/cadastro/areceber/${codrcb}/estornar-baixa`);
}

// ── a auditoria do uCadAReceber.dfm (14/10/2026) ───────────────────────────────────────────────────────────────
import type { RegerarParcelasAreceberDto } from '@apollo/shared';
export interface ParcelaAreceber { codrcb: number; [k: string]: unknown }
export interface NfDaConta { codnf: number; nronf?: string | number | null; codparceiro?: number | null; razao?: string | null }
async function reqAr<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as T;
}
/** a grade `dbgParcelas`: o documento inteiro (o grupo) com os totais */
export const parcelasAreceber = (codrcb: number) =>
  reqAr<{ codgrupo: number | null; parcelas: ParcelaAreceber[]; totais: { nrodup: number; total_parcelas: number; total_documento: number } }>(`/cadastro/areceber/${codrcb}/parcelas`);
/** o "&Parcelas" sobre o documento gravado */
export const regerarParcelasAreceber = (codrcb: number, body: RegerarParcelasAreceberDto) =>
  reqAr<{ codrcbs: number[]; parcelas: number; titulo: Record<string, unknown> }>(`/cadastro/areceber/${codrcb}/gerar-parcelas`, { method: 'POST', body: JSON.stringify(body) });
/** "Nota fiscal (nº)": as NFs do número (edtNumeNotaExit) */
export const nfsDaConta = (nronf: string, codparceiro?: number) =>
  reqAr<NfDaConta[]>(`/cadastro/areceber/apoio/nf?nronf=${encodeURIComponent(nronf)}${codparceiro ? `&codparceiro=${codparceiro}` : ''}`);
