/**
 * Fetcher do FATURAMENTO da NF (F4 — gera títulos financeiros). Espelha `nfProcessamentoApi.ts`
 * (headers/BASE + envelope ErroResposta/ADR-015). ESCRITA/EFEITO: gera N parcelas em
 * ARECEBER (saída) / APAGAR (entrada) por IDNF, atômico. Erros (já faturada, total zero,
 * título quitado) sobem como envelope PT, exibido via `useMensagem`.
 */
import { isErroResposta, type ErroResposta, type FaturarNfDto, type GerarParcelasNfDto } from '@apollo/shared';

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

// ── as PARCELAS da nota (FATURAMENTO) — a aba de cobrança ─────────────────────────────────────────────────────────────

export interface ConfiguracaoParcelas {
  codnf: number;
  habilitado: boolean;
  motivo: string | null;
  legenda: string;
  exigeSenha: boolean;
  modeloDuplicata: number;
  nroDupHabilitado: boolean;
  numParcelas: number;
  diaVenc: number;
  intervalo: number;
  tipoCalc: 'D' | 'I';
  vencimento: string;
  base: number;
  valorAFaturar: number;
}

export interface ParcelaGerada {
  nrofatura: number;
  totalparcelasfatura: number;
  data: string;
  valor: number;
  liberado: 'N';
  duplicata: string | null;
  modalidade: string;
  nronf: string | null;
}

/** os padrões da aba de cobrança e se o "Gerar financeiro" está liberado (SetConfiguracoesFaturamento) */
export function configuracaoParcelas(codnf: number): Promise<ConfiguracaoParcelas> {
  return req<ConfiguracaoParcelas>(`/fiscal/nf/${codnf}/parcelas/configuracao`, { method: 'GET' });
}

/** calcula as parcelas (não grava: vão para a grade e são gravadas com a nota) — ou devolve a pergunta do "próximo mês" */
export function gerarParcelas(
  codnf: number,
  body: GerarParcelasNfDto,
): Promise<{ parcelas: ParcelaGerada[]; valorAFaturar: number } | { perguntarProximoMes: true; vencimento: string }> {
  return req(`/fiscal/nf/${codnf}/gerar-parcelas`, { body: JSON.stringify(body) });
}

/** "Gerar sequência de duplicatas" → o próximo nº do gerador NRODUP */
export function sequenciaDuplicata(): Promise<{ nroDup: number }> {
  return req<{ nroDup: number }>(`/fiscal/nf/parcelas/sequencia-duplicata`);
}
