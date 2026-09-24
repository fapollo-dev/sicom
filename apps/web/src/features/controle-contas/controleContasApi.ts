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
  a_prazo?: boolean;
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
export function listarModalidades(): Promise<Array<{ idpgto: number; modalidade: string }>> { return req('/cadastro/controle-contas/modalidades', { method: 'GET' }); }
export function obterSaldo(codconta: number, ateData?: string): Promise<PainelSaldo> {
  return req(`/cadastro/controle-contas/saldo?codconta=${codconta}${ateData ? `&ateData=${ateData}` : ''}`, { method: 'GET' });
}
export function obterExtrato(codconta: number): Promise<{ codconta: number; saldo: number; movimentos: Movimento[] }> {
  return req(`/cadastro/controle-contas/extrato?codconta=${codconta}`, { method: 'GET' });
}
export function lancarSaldo(body: { codconta: number; valor: number; idpgto: number; historico?: string; data?: string; senhaAdm: string }): Promise<{ codmovconta: number; tipomovimento: string; saldo: number }> {
  return req('/cadastro/controle-contas/lancar-saldo', { method: 'POST', body: JSON.stringify(body) });
}
export function transferir(body: { codorigem: number; coddestino: number; valor: number; historico?: string }): Promise<{ idlote: number; debito: number; credito: number }> {
  return req('/cadastro/controle-contas/transferir', { method: 'POST', body: JSON.stringify(body) });
}
export function estornar(codmovconta: number): Promise<{ codmovconta: number; removidos: number; transferencia: boolean }> {
  return req(`/cadastro/controle-contas/${codmovconta}`, { method: 'DELETE' });
}
export interface MovALiberar { codmovconta: number; dtemissao: string | null; dtvenc: string | null; nrodocumento: string | null; valor: number; historico: string | null; idlote: number | null; modalidade: string | null }
export function listarALiberar(codconta: number): Promise<MovALiberar[]> { return req(`/cadastro/controle-contas/a-liberar?codconta=${codconta}`, { method: 'GET' }); }
export function liberarMovimentos(body: { codconta: number; codmovcontas: number[]; data: string }): Promise<{ liberados: number; ignorados: number }> {
  return req('/cadastro/controle-contas/liberar', { method: 'POST', body: JSON.stringify(body) });
}
export function mudarDataLiberacao(codmovconta: number, data: string): Promise<{ codmovconta: number; dtliberacao: string }> {
  return req(`/cadastro/controle-contas/${codmovconta}/data-liberacao`, { method: 'POST', body: JSON.stringify({ data }) });
}
export interface DetMov {
  codmovconta: number; idlote: number | null; nrodocumento: string | null; valor: number; dtemissao: string | null; dtvenc: string | null; dtliberacao: string | null;
  liberado: string; tipomovimento: string; historico: string | null; codoperador: number | null; operador: string | null; modalidade: string | null; operacao: string | null;
  contabilizado: string | null; idlote_reversao: number | null; revertido: string | null; mov_conciliado: string | null; origem: string | null;
}
export interface Detalhamento { codconta: number; dtini: string; dtfim: string; movimentos: DetMov[]; totais: { anterior: number; entradas: number; saidas: number; periodo: number; a_prazo: number; futuro: number; atual: number } }
export interface FiltroDet { dtini: string; dtfim: string; dataDe: 'emissao' | 'vencimento' | 'liberacao'; liberado: 'TODOS' | 'LIBERADOS' | 'NAO'; documento: string }
export function obterDetalhamento(codconta: number, f: FiltroDet): Promise<Detalhamento> {
  const q = new URLSearchParams({ codconta: String(codconta), dtini: f.dtini, dtfim: f.dtfim, dataDe: f.dataDe, liberado: f.liberado });
  if (f.documento.trim()) q.set('documento', f.documento.trim());
  return req(`/cadastro/controle-contas/detalhamento?${q}`, { method: 'GET' });
}
export function titulosDoMovimento(codmovconta: number): Promise<{ lote: number; tipo: 'AR' | 'AP' | 'CARTAO'; revertido: boolean }> {
  return req(`/cadastro/controle-contas/${codmovconta}/titulos`, { method: 'GET' });
}
