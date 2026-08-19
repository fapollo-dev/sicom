/**
 * Fetcher do ADIANTAMENTO A FORNECEDOR/PARCEIRO (FRMADIANTAMENTOFORNECEDOR). O tipo vem da SITUAÇÃO do documento
 * (F19 crédito → A Pagar · F20 débito → A Receber · F21 crédito com ADCREDITO); o servidor grava o movimento na
 * conta corrente e o título na mesma transação.
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

export interface SituacaoAdiantamento { idsituacao_nf: number; descricao: string; tipo_operacao: string; tipo: string }
export interface ContaAdiantamento { codconta: number; nroconta?: string | null; titular?: string | null; codbco?: number | null; saldo: number }
export interface Adiantamento {
  codadiantamento: number;
  codparceiro: number;
  razao?: string | null;
  codcontacorrente: number;
  nroconta?: string | null;
  dtadiantamento: string;
  dtvencimento: string;
  valor: number;
  tipo: string;
  quitada: string;
  codmovconta?: number | null;
  obs?: string | null;
  idsituacao_nf?: number | null;
  contabilizado?: string | null;
  codrcb?: number | null;
  codapg?: number | null;
}
export interface AdiantamentoCriado { codadiantamento: number; tipo: string; codmovconta: number; codrcb: number | null; codapg: number | null; saldo: number }

export function listarSituacoes(): Promise<SituacaoAdiantamento[]> { return req('/cobranca/adiantamentos/situacoes', { method: 'GET' }); }
export function listarContas(): Promise<ContaAdiantamento[]> { return req('/cobranca/adiantamentos/contas', { method: 'GET' }); }
export function listarAdiantamentos(f: Record<string, unknown>): Promise<Adiantamento[]> {
  return req('/cobranca/adiantamentos/listar', { method: 'POST', body: JSON.stringify(f) });
}
export function criarAdiantamento(dto: Record<string, unknown>): Promise<AdiantamentoCriado> {
  return req('/cobranca/adiantamentos/criar', { method: 'POST', body: JSON.stringify(dto) });
}
export function editarAdiantamento(dto: Record<string, unknown>): Promise<{ codadiantamento: number; tipo: string; titulo_atualizado: boolean }> {
  return req('/cobranca/adiantamentos/editar', { method: 'POST', body: JSON.stringify(dto) });
}
export function excluirAdiantamento(codadiantamento: number): Promise<{ codadiantamento: number; movimento_removido: boolean; titulo_removido: boolean }> {
  return req('/cobranca/adiantamentos/excluir', { method: 'POST', body: JSON.stringify({ codadiantamento }) });
}
