/** Cliente CRUD genérico por recurso (substitui os api.ts duplicados por feature). */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const HEADERS = {
  'content-type': 'application/json',
  'x-tenant-id': 'pinheirao',
  'x-operador-id': '7',
  'x-empresa-id': '1',
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: HEADERS });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.code ?? res.statusText), { status: res.status, body });
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
