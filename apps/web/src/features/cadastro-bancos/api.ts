import type { Banco, CriarBancoDto, AtualizarBancoDto } from '@apollo/shared';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
// Nesta fatia o tenant/operador vão por header (em prod: JWT). Fonte confiável.
const HEADERS = {
  'content-type': 'application/json',
  'x-tenant-id': 'pinheirao',
  'x-operador-id': '7',
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: HEADERS });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.code ?? res.statusText), { status: res.status, body });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const bancosApi = {
  listar: () => req<Banco[]>('/cadastro/bancos'),
  ler: (codbco: number) => req<Banco>(`/cadastro/bancos/${codbco}`),
  criar: (dto: CriarBancoDto) =>
    req<Banco>('/cadastro/bancos', { method: 'POST', body: JSON.stringify(dto) }),
  atualizar: (codbco: number, dto: AtualizarBancoDto) =>
    req<Banco>(`/cadastro/bancos/${codbco}`, { method: 'PUT', body: JSON.stringify(dto) }),
  excluir: (codbco: number) =>
    req<void>(`/cadastro/bancos/${codbco}`, { method: 'DELETE' }),
};
