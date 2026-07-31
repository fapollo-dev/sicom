/**
 * Fetcher das ETIQUETAS DE PREÇO (FRMETIQUETA). Fila do coletor (pendentes da empresa) + busca por codbarra +
 * imprimir (grava log web + marca IMPRESSA='S' + devolve as etiquetas p/ o layout imprimível). O preço/promo é
 * computado no servidor (MULTI_PRECO × fator; server-authoritative).
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

export interface Etiqueta {
  idetiqueta?: number;
  idproduto: number;
  codbarra: string | null;
  descricao: string;
  unidade: string | null;
  fator: number;
  qtde: number;
  valor_venda: number;
  valor_promocao: number;
  valor_venda_promocao: number; // preço IMPRESSO
  promocao: string;
}

export function listarFila(): Promise<Etiqueta[]> {
  return req('/cadastro/etiqueta/fila', { method: 'GET' });
}
export function buscarProduto(codbarra: string): Promise<Etiqueta> {
  return req(`/cadastro/etiqueta/produto?codbarra=${encodeURIComponent(codbarra)}`, { method: 'GET' });
}
export function adicionar(body: { idproduto?: number; codbarra?: string }): Promise<{ idetiqueta: number; etiqueta: Etiqueta }> {
  return req('/cadastro/etiqueta/adicionar', { method: 'POST', body: JSON.stringify(body) });
}
export function remover(idetiqueta: number): Promise<{ idetiqueta: number; removido: boolean }> {
  return req(`/cadastro/etiqueta/${idetiqueta}`, { method: 'DELETE' });
}
export function imprimir(itens: Array<{ idetiqueta?: number; idproduto: number; qtde: number; descricao?: string; modelo?: string }>): Promise<{ etiquetas: Etiqueta[]; total_etiquetas: number }> {
  return req('/cadastro/etiqueta/imprimir', { method: 'POST', body: JSON.stringify({ itens }) });
}
