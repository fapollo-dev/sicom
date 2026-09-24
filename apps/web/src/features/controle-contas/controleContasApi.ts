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
  dtemissao?: string | null;
  hora?: string | null;
  nrodocumento?: string | null;
  idlote?: number | null;
  mov_conciliado?: string | null;
  valor_com_sinal: number;
  saldo_corrente: number;
}

/** a conta da lista do legado: as do operador, com o chaveamento e as 8 permissões por conta */
export interface ContaCC {
  codconta: number; codbco: number | null; banco: string | null; titular: string | null; nroconta: string | null; gerente: string | null; dtabertura: string | null;
  fone1: string | null; dtchaveamento: string | null; operadorchaveamento: string | null; idempresa: number; caixa: boolean;
  visualizar_saldos: string; habilitar_tranfer: string; habiltiar_libe_moviment: string; habiltiar_lanca_saldo: string; habiltiar_chavear_fec_cxa: string;
  habiltiar_troca_valores: string; habiltiar_detalhar_conta: string; habiltiar_conci_ofx: string;
}
export interface PainelSaldo { codconta: number; entradas: number; saidas: number; a_prazo: number; futuro: number; saldo: number }
export function listarContasCC(): Promise<ContaCC[]> { return req('/cadastro/controle-contas/contas', { method: 'GET' }); }
export function listarDestinos(): Promise<Array<{ codconta: number; nroconta: string | null; titular: string | null; idempresa: number }>> { return req('/cadastro/controle-contas/destinos', { method: 'GET' }); }
export function listarOperacoes(): Promise<Operacao[]> { return req('/cadastro/controle-contas/operacoes', { method: 'GET' }); }
export function obterSaldo(codconta: number, ateData?: string): Promise<PainelSaldo> {
  return req(`/cadastro/controle-contas/saldo?codconta=${codconta}${ateData ? `&ateData=${ateData}` : ''}`, { method: 'GET' });
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
export function estornar(codmovconta: number): Promise<{ codmovconta: number; removidos: number; transferencia: boolean }> {
  return req(`/cadastro/controle-contas/${codmovconta}`, { method: 'DELETE' });
}
