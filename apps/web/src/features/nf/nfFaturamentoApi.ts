/**
 * Fetcher do FINANCEIRO da NF: as parcelas (FATURAMENTO) da aba de cobrança, o botão "Faturamento" (que abre a tela do
 * Faturamento, onde a parcela vira título) e o estorno. Erros sobem como envelope PT, exibido via `useMensagem`.
 */
import { isErroResposta, type ErroResposta, type GerarParcelasNfDto } from '@apollo/shared';

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

/** o botão "Faturamento" da nota: os gates do legado (enviada, com parcela pendente) e o filtro com que o Faturamento abre */
export function faturamentoDaNota(codnf: number): Promise<{ codnf: number; tipo: string; nronf: string | null; dataIni: string; dataFim: string; pendentes: number[] }> {
  return req(`/fiscal/nf/${codnf}/faturamento`, { method: 'GET' });
}

/** "Excluir documentos financeiros" (ExcluirDocumentosFinanceiros): títulos, rateio, CAIXA e parcelas da nota saem (bloqueado com baixa) */
export function excluirFinanceiroNf(codnf: number): Promise<{ codnf: number }> {
  return req<{ codnf: number }>(`/fiscal/nf/${codnf}/excluir-financeiro`);
}

// ── as PARCELAS da nota (FATURAMENTO) — a aba de cobrança ─────────────────────────────────────────────────────────────

export interface ConfiguracaoParcelas {
  codnf: number;
  habilitado: boolean;
  habilitadoFinanceiro: boolean;
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

/** o GRAVAR do "Processar financeiro" da nota já processada: as parcelas da grade (Σ = base) */
export function processarFinanceiroNf(codnf: number, faturamento: unknown[]): Promise<{ codnf: number; parcelas: number }> {
  return req(`/fiscal/nf/${codnf}/processar-financeiro`, { body: JSON.stringify({ faturamento }) });
}
