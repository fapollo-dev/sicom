/**
 * Fetcher de CARTÕES / RECEBÍVEIS. Operadoras (agregado cadastro/operadoras, master + taxa por-empresa) + recebível
 * (crud cadastro/cartao, lista a view get_cartao com líquido/vencimento computados).
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

export interface Operadora {
  codoperadoras: number;
  operadora: string;
  txadm?: number;
  diascomp?: number;
  tipo?: string | null;
  tipocartao?: number | null;
  ativo?: string | null;
}
export interface OperadoraTaxa { idempresa: number; txadm?: number; diafechamento?: number }
export interface OperadoraDetalhe extends Operadora { txadmparc?: number; codbandeira?: number | null; codadm?: number | null; codbanco?: number | null; codoperadorabase?: number | null; itens: OperadoraTaxa[] }

export interface CartaoRecebivel {
  codvendcartao: number;
  dtvenda: string | null;
  operadora?: string | null;
  codoperadora: number;
  valor: number; // bruto
  valor_com_taxa?: number; // líquido computado
  txadm_efetiva?: number;
  previsao_compensacao?: string | null;
  liberado?: string | null; // N aberto / S baixado
  nrocupom?: string | null;
  nroparcela?: number | null;
}

// ── operadoras
export function listarOperadoras(): Promise<Operadora[]> { return req('/cadastro/operadoras', { method: 'GET' }); }
export function obterOperadora(id: number): Promise<OperadoraDetalhe> { return req(`/cadastro/operadoras/${id}`, { method: 'GET' }); }
export function criarOperadora(body: Partial<OperadoraDetalhe>): Promise<OperadoraDetalhe> { return req('/cadastro/operadoras', { method: 'POST', body: JSON.stringify(body) }); }
export function atualizarOperadora(id: number, body: Partial<OperadoraDetalhe>): Promise<OperadoraDetalhe> { return req(`/cadastro/operadoras/${id}`, { method: 'PUT', body: JSON.stringify(body) }); }
export function excluirOperadora(id: number): Promise<void> { return req(`/cadastro/operadoras/${id}`, { method: 'DELETE' }); }

// ── recebíveis (cartão)
export function listarCartoes(): Promise<CartaoRecebivel[]> { return req('/cadastro/cartao', { method: 'GET' }); }
export function criarCartao(body: { valor: number; codoperadora: number; dtvenda?: string; nrocupom?: string; nroparcela?: number }): Promise<CartaoRecebivel> { return req('/cadastro/cartao', { method: 'POST', body: JSON.stringify(body) }); }
export function excluirCartao(id: number): Promise<void> { return req(`/cadastro/cartao/${id}`, { method: 'DELETE' }); }
