/**
 * Fetcher da PRODUÇÃO (FRMCADPRODUCAO — "Requisição de produção"). Agregado `cadastro/producao` (cabeçalho + itens
 * de saída/acabados) + verticais (processar/reverter). O custo/venda do acabado é snapshot server-authoritative de
 * MULTI_PRECO; a ficha técnica (receita) é explodida no processar.
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

export interface ProducaoHeader {
  codproducao: number;
  data: string | null;
  status?: string | null;
  status_label?: string | null;
  parceiro?: string | null;
  qtde_itens?: number;
  total_custo?: number;
  total_venda?: number;
  dtprocessamento?: string | null;
}
export interface ProducaoItem {
  coditenprod?: number;
  idprodutos: number;
  qtde: number;
  unidade?: string | null;
  vrcusto?: number;
  vrvenda?: number;
  observacao?: string | null;
}
export interface ProducaoDetalhe extends ProducaoHeader {
  codempresa_producao?: number | null;
  codparceiro?: number | null;
  codplc?: number | null;
  itens: ProducaoItem[];
}
export interface ProdutoLookup { idproduto: number; descricao?: string | null; codbarra?: string | null }

export function listarProducoes(): Promise<ProducaoHeader[]> {
  return req('/cadastro/producao', { method: 'GET' });
}
export function obterProducao(id: number): Promise<ProducaoDetalhe> {
  return req(`/cadastro/producao/${id}`, { method: 'GET' });
}
export function criarProducao(body: { codparceiro?: number; codplc?: number; itens?: ProducaoItem[] }): Promise<ProducaoDetalhe> {
  return req('/cadastro/producao', { method: 'POST', body: JSON.stringify(body) });
}
export function atualizarProducao(id: number, body: { codparceiro?: number; codplc?: number; itens: ProducaoItem[] }): Promise<ProducaoDetalhe> {
  return req(`/cadastro/producao/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}
export function excluirProducao(id: number): Promise<void> {
  return req(`/cadastro/producao/${id}`, { method: 'DELETE' });
}
export function processarProducao(id: number): Promise<{ codproducao: number; status: 'P'; acabados: number; ingredientes: number }> {
  return req(`/cadastro/producao/${id}/processar`, { method: 'POST' });
}
export function reverterProducao(id: number): Promise<{ codproducao: number; status: 'A'; acabados: number; ingredientes: number }> {
  return req(`/cadastro/producao/${id}/reverter`, { method: 'POST' });
}
export function listarProdutos(): Promise<ProdutoLookup[]> {
  return req('/cadastro/produtos', { method: 'GET' });
}
