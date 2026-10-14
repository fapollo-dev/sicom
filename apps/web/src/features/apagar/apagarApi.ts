/**
 * Fetcher das AÇÕES de Contas a Pagar (corte-2 — BAIXA/pagamento). Gêmeo de `areceberApi.ts`.
 * ESCRITA/EFEITO: baixa quita o título (APAGAR_BX INDR='I' + QUITADA='S'); estorno é LÓGICO.
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

/** Baixa (paga) o título — juros default = fórmula legada; retorna valor pago + juros. */
export function baixarApagar(codapg: number, body: BaixarTituloDto): Promise<{ codapg: number; valorpg: number; juros: number; quitada: 'S' }> {
  return req(`/cadastro/apagar/${codapg}/baixar`, { body: JSON.stringify(body) });
}

/** Estorna o pagamento (INDR='E' lógico + reabre o título). */
export function estornarBaixaApagar(codapg: number): Promise<{ codapg: number; quitada: 'N' }> {
  return req(`/cadastro/apagar/${codapg}/estornar-baixa`);
}

// ── as abas e os grupos da tela (auditoria do uAPagar.dfm, 14/10/2026) ──────────────────────────────────────────
import type { GerarParcelasApagarDto, RateioApagarDto } from '@apollo/shared';

export interface ParcelaApagar { codapg: number; [k: string]: unknown }
export interface TotaisParcelasApagar { nrodup: number; total_parcelas: number; total_documento: number; total_pago: number }
export interface LinhaRateioApagar { codcxapagar?: number; codapg?: number; codcc: number; valor: number | string; tipo?: string; idsituacao_nf?: number | null; desccodplc?: string | null; descricao?: string | null; descsituacaonfcc?: string | null }
export interface PendenciaApagar { codapg: number; duplicata?: string | null; idnf?: number | null; dtvenc?: string | null; obs?: string | null; valor?: number | string | null; nrparcela?: string | null; status?: string | null; status_pendencia?: string | null }

/** a aba PARCELAS: o documento inteiro (o grupo) com os totais (sqqAPagarGrupo + RetornaTotalPago) */
export const parcelasApagar = (codapg: number) =>
  req<{ codgrupo: number | null; parcelas: ParcelaApagar[]; totais: TotaisParcelasApagar }>(`/cadastro/apagar/${codapg}/parcelas`, { method: 'GET' });
/** o PROCESSAR sobre o documento gravado (btnGeraParcelasClick) */
export const gerarParcelasApagar = (codapg: number, body: GerarParcelasApagarDto) =>
  req<{ codapgs: number[]; parcelas: number; titulo: Record<string, unknown> }>(`/cadastro/apagar/${codapg}/gerar-parcelas`, { body: JSON.stringify(body) });
/** a aba ULTIMOS LANÇAMENTOS do fornecedor (FDqUltimosLanc) */
export const ultimosLancamentosApagar = (codapg: number) => req<Record<string, unknown>[]>(`/cadastro/apagar/${codapg}/ultimos-lancamentos`, { method: 'GET' });
/** a aba PENDÊNCIAS (sqqPendencias + edtLocalizar) */
export const pendenciasApagar = (localizar?: string) =>
  req<PendenciaApagar[]>(`/cadastro/apagar/pendencias${localizar ? `?localizar=${encodeURIComponent(localizar)}` : ''}`, { method: 'GET' });
/** "Pendência Resolvida" (ResolverPendencias) */
export const resolverPendenciaApagar = (codapg: number) => req<{ codapg: number; status_pendencia: 'A' }>(`/cadastro/apagar/${codapg}/resolver-pendencia`);
/** o grupo "Lançamento centro custo" (sqqCentroCusto) */
export const rateioApagar = (codapg: number) => req<LinhaRateioApagar[]>(`/cadastro/apagar/${codapg}/rateio`, { method: 'GET' });
export const gravarRateioApagar = (codapg: number, body: RateioApagarDto) => req<LinhaRateioApagar[]>(`/cadastro/apagar/${codapg}/rateio`, { method: 'PUT', body: JSON.stringify(body) });
