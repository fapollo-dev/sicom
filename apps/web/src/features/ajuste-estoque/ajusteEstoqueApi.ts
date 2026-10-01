/**
 * Fetcher do AJUSTE DE ESTOQUE (espelha caixaApi: headers/BASE + envelope ErroResposta/ADR-015).
 * Ações: ajustar (move o saldo) / estornar; leitura: listar (histórico). Erros PT via useMensagem.
 */
import { isErroResposta, type ErroResposta, type AjustarEstoqueDto, type AjusteEstoque } from '@apollo/shared';

import { apiHeaders, handle401 } from '../../shared/auth/session';
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: (body as any)?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as T;
}

export function listarAjustes(limite = 50): Promise<AjusteEstoque[]> {
  return req(`/cadastro/ajuste-estoque?limite=${limite}`);
}

export function ajustarEstoque(dto: AjustarEstoqueDto): Promise<{ codajuste: number; qtdeanterior: number; qtdeatual: number }> {
  return req(`/cadastro/ajuste-estoque`, { method: 'POST', body: JSON.stringify(dto) });
}

export function estornarAjuste(codajuste: number): Promise<{ codajuste: number; qtde: number }> {
  return req(`/cadastro/ajuste-estoque/${codajuste}/estornar`, { method: 'POST' });
}

/** a aba Histórico do legado (QryConsulta): período (as duas datas ou nenhuma) e produto opcionais, a loja do login */
export interface FiltroConsultaAjuste { dtini?: string; dtfim?: string; idproduto?: number }
export const consultaAjusteQuery = (f: FiltroConsultaAjuste): string =>
  new URLSearchParams(Object.entries(f).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString();
export function consultarAjustes(f: FiltroConsultaAjuste): Promise<Array<Record<string, unknown>>> {
  return req(`/cadastro/ajuste-estoque/consulta?${consultaAjusteQuery(f)}`);
}
