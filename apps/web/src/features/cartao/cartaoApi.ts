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
  idlote?: number | null;
  nrocupom?: string | null;
  nroparcela?: number | null;
}
export interface ContaBancaria { codconta: number; banco?: string | null; titular?: string | null }

// ── operadoras
export function listarOperadoras(): Promise<Operadora[]> { return req('/cadastro/operadoras', { method: 'GET' }); }
export function obterOperadora(id: number): Promise<OperadoraDetalhe> { return req(`/cadastro/operadoras/${id}`, { method: 'GET' }); }
export function criarOperadora(body: Partial<OperadoraDetalhe>): Promise<OperadoraDetalhe> { return req('/cadastro/operadoras', { method: 'POST', body: JSON.stringify(body) }); }
export function atualizarOperadora(id: number, body: Partial<OperadoraDetalhe>): Promise<OperadoraDetalhe> { return req(`/cadastro/operadoras/${id}`, { method: 'PUT', body: JSON.stringify(body) }); }
export function excluirOperadora(id: number): Promise<void> { return req(`/cadastro/operadoras/${id}`, { method: 'DELETE' }); }

// ── recebíveis (cartão)
/**
 * a consulta dos recebíveis (baixados / todos): os mais recentes, filtrados e ordenados NO SERVIDOR (a lista do CRUD tem teto de 500 —
 * antes vinham 200 quaisquer, sem ordem, filtrados no navegador). Os ABERTOS a baixar vêm da Pesquisa da GET_CARTAO (o lote da baixa)
 */
export function listarCartoes(situacao: 'S' | '' = ''): Promise<CartaoRecebivel[]> {
  const qs = new URLSearchParams({ orderBy: 'dtvenda', orderDir: 'desc', limite: '500', ...(situacao ? { campo: 'liberado', operador: 'igual', valor: situacao } : {}) });
  return req(`/cadastro/cartao?${qs.toString()}`, { method: 'GET' });
}
export const TETO_CONSULTA_CARTOES = 500;
/** a linha da Pesquisa da GET_CARTAO (rel_get_cartao) no formato da grade: CODIGO = CODVENDCARTAO, DATA = a data da venda */
export function recebivelDaPesquisa(l: Record<string, any>): CartaoRecebivel {
  return {
    codvendcartao: Number(l.codigo ?? l.codvendcartao), dtvenda: l.data ?? l.dtvenda ?? null, operadora: l.operadora ?? null, codoperadora: Number(l.codoperadora ?? 0),
    valor: Number(l.valor ?? 0), valor_com_taxa: l.valor_com_taxa != null ? Number(l.valor_com_taxa) : undefined, previsao_compensacao: l.previsao_compensacao ?? null,
    liberado: 'N', idlote: null, nrocupom: l.nrocupom ?? null, nroparcela: l.nroparcela ?? null,
  };
}
export function criarCartao(body: { valor: number; codoperadora: number; dtvenda?: string; nrocupom?: string; nroparcela?: number }): Promise<CartaoRecebivel> { return req('/cadastro/cartao', { method: 'POST', body: JSON.stringify(body) }); }
/** exclui; o cartão CONCILIADO exige a senha administrativa (btnExcluirClick, UcadCartao.pas:293) */
export function excluirCartao(id: number, senhaAdmin?: string): Promise<void> {
  return req(`/cadastro/cartao/${id}${senhaAdmin ? `?senhaAdmin=${encodeURIComponent(senhaAdmin)}` : ''}`, { method: 'DELETE' });
}
// baixa (corte-2)
export function listarContas(): Promise<ContaBancaria[]> { return req('/cadastro/contas-bancarias', { method: 'GET' }); }
export type DestinoBaixaCartao = 'BANCARIA' | 'ANTECIPACAO' | 'TESOURARIA';
export interface BaixarCartoesDto { codconta: number; codvendcartaos: number[]; dataBaixa?: string; destino?: DestinoBaixaCartao; historico?: string; outrasDespesas?: number }
export function baixarCartoes(dto: BaixarCartoesDto): Promise<{ idlote: number; itens: number; total_liquido: number; total_taxa: number; outras_despesas?: number; debitos: number; contabilizado: boolean }> {
  return req('/cadastro/cartao/baixar', { method: 'POST', body: JSON.stringify(dto) });
}
/** as contas do operador (`CONTAS_BANCARIAS_OP`) — a F3 da conta na baixa (`edtCodContaExit`) */
export interface ContaDoOperador { codconta: number; nroconta?: string | null; titular?: string | null; codbco: number | null; caixa: boolean }
export function contasDoOperador(): Promise<ContaDoOperador[]> { return req('/cadastro/cartao/baixa/contas', { method: 'GET' }); }
export function estornarLoteCartao(idlote: number): Promise<{ idlote: number; itens: number; contraMovimentos: number }> {
  return req(`/cadastro/cartao/estornar-lote/${idlote}`, { method: 'POST' });
}
