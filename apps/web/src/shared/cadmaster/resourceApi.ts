/** Cliente CRUD genérico por recurso (substitui os api.ts duplicados por feature). */
import { isErroResposta, type ErroResposta } from '@apollo/shared';

import { apiHeaders, handle401 } from '../auth/session';
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** Error lançado por `req` no !ok, carregando o envelope padrão (ADR-015). */
export interface ErroRequisicao extends Error {
  /** envelope padrão da API (sempre preenchido — sintetizado se o body não casar) */
  envelope: ErroResposta;
  /** HTTP status (retrocompat) */
  status: number;
  /** body cru parseado (retrocompat) */
  body: any;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // envelope: usa o body se já for o contrato padrão; senão sintetiza um (ADR-015)
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), {
      envelope, // novo: envelope padrão p/ a camada de mensagem
      status: res.status, // retrocompat
      body, // retrocompat
    });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** Filtro da Pesquisa enviado como query string. */
export interface PesquisaParams {
  campo?: string;
  operador?: string;
  valor?: string;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  /** rdgAtivo (F6): ativos | inativos | todos */
  situacao?: 'ativos' | 'inativos' | 'todos';
  incluirExcluidos?: boolean;
}

export interface ResourceApi<T = any> {
  listar(params?: PesquisaParams): Promise<T[]>;
  ler(id: number): Promise<T>;
  criar(dto: any): Promise<T>;
  atualizar(id: number, dto: any): Promise<T>;
  excluir(id: number): Promise<void>;
}

/** Ex.: createResourceApi('cadastro/marcas') → { listar, ler, criar, atualizar, excluir }. */
export function createResourceApi<T = any>(path: string): ResourceApi<T> {
  return {
    listar: (params?: PesquisaParams) => {
      const qs = new URLSearchParams();
      if (params) for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, String(v));
      const s = qs.toString();
      return req<T[]>(`/${path}${s ? `?${s}` : ''}`);
    },
    ler: (id) => req<T>(`/${path}/${id}`),
    criar: (dto) => req<T>(`/${path}`, { method: 'POST', body: JSON.stringify(dto) }),
    atualizar: (id, dto) => req<T>(`/${path}/${id}`, { method: 'PUT', body: JSON.stringify(dto) }),
    excluir: (id) => req<void>(`/${path}/${id}`, { method: 'DELETE' }),
  };
}
