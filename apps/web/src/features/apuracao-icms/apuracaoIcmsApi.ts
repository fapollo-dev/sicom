/**
 * Fetcher da APURAÇÃO DE ICMS (FRMRELREGISTROS_ES): processa o período (as três pernas — notas de saída, cupons e
 * notas de entrada), devolve o cabeçalho do E110, o resumo por CFOP e a contagem do detalhe.
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

export interface CabecalhoE110 {
  codapuracaoicms: number;
  dataini: string; datafin: string;
  saldoant: number; creditoentrada: number; creditoentrada_sn: number;
  outroscreditos: number; estornodebitos: number;
  debitosaida: number; outrosdebitos: number; estornocreditos: number;
  saldocredorseguinte: number; saldodevedor: number; deducoes: number; arecolher: number;
}
export interface LinhaCfop {
  tipo: string; cfop: number;
  vrcontabil: number; basecalculo: number; imposto: number; isentas: number; outras: number;
}
export interface Apuracao {
  cabecalho: CabecalhoE110;
  cfops: LinhaCfop[];
  contagem: { linhas: number; cupons: number; notas_saida: number; notas_entrada: number };
  detalhe: Array<Record<string, unknown>>;
  reprocessada?: boolean;
  aviso_contingencia?: number;
}

export function processarApuracao(dto: Record<string, unknown>): Promise<Apuracao> {
  return req('/fiscal/apuracao-icms/processar', { method: 'POST', body: JSON.stringify(dto) });
}
export function obterApuracao(dto: Record<string, unknown>): Promise<Apuracao> {
  return req('/fiscal/apuracao-icms/obter', { method: 'POST', body: JSON.stringify(dto) });
}
