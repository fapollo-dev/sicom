/**
 * Fetcher do CONTROLE DE CONTAS CORRENTES (FRMCONTROLECONTASBANCARIAS). Extrato+saldo de uma conta, lançamento
 * manual (operação C/D), transferência entre contas (2 pernas atômicas) e estorno. Razão = mov_contas_bancarias.
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

export interface ContaBancaria { codconta: number; banco?: string | null; titular?: string | null; codbco?: number | null }
export interface Operacao { codopconta: number; descricao: string; tipo: string }
export interface Movimento {
  codmovconta: number;
  valor: number;
  tipomovimento: string;
  codopconta?: number | null;
  historico?: string | null;
  origem?: string | null;
  idorigem?: number | null;
  data_fechamento?: string | null;
  mov_conciliado?: string | null;
  valor_com_sinal: number;
  saldo_corrente: number;
}

export function listarContas(): Promise<ContaBancaria[]> { return req('/cadastro/contas-bancarias', { method: 'GET' }); }
export function listarOperacoes(): Promise<Operacao[]> { return req('/cadastro/controle-contas/operacoes', { method: 'GET' }); }
export function obterSaldo(codconta: number): Promise<{ codconta: number; saldo: number; entradas: number; saidas: number }> {
  return req(`/cadastro/controle-contas/saldo?codconta=${codconta}`, { method: 'GET' });
}
export function obterExtrato(codconta: number): Promise<{ codconta: number; saldo: number; movimentos: Movimento[] }> {
  return req(`/cadastro/controle-contas/extrato?codconta=${codconta}`, { method: 'GET' });
}
export function lancar(body: { codconta: number; codopconta: number; valor: number; historico?: string }): Promise<{ codmovconta: number; tipomovimento: string; saldo: number }> {
  return req('/cadastro/controle-contas/lancar', { method: 'POST', body: JSON.stringify(body) });
}
export function transferir(body: { codorigem: number; coddestino: number; valor: number; historico?: string }): Promise<{ idlote: number; debito: number; credito: number }> {
  return req('/cadastro/controle-contas/transferir', { method: 'POST', body: JSON.stringify(body) });
}
export function estornar(codmovconta: number): Promise<{ codmovconta: number; removidos: number; origem: string }> {
  return req(`/cadastro/controle-contas/${codmovconta}`, { method: 'DELETE' });
}
