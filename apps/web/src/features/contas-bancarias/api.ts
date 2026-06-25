import type {
  ContaBancaria,
  CriarContaBancariaDto,
  AtualizarContaBancariaDto,
} from '@apollo/shared';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const HEADERS = {
  'content-type': 'application/json',
  'x-tenant-id': 'pinheirao',
  'x-operador-id': '7',
  'x-empresa-id': '1',
};
// a view de listagem traz o nome do banco (lookup via JOIN)
export type ContaBancariaRow = ContaBancaria & { banco: string };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: HEADERS });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.code ?? res.statusText), { status: res.status, body });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const contasBancariasApi = {
  listar: () => req<ContaBancariaRow[]>('/cadastro/contas-bancarias'),
  ler: (cod: number) => req<ContaBancaria>(`/cadastro/contas-bancarias/${cod}`),
  criar: (dto: CriarContaBancariaDto) =>
    req<ContaBancaria>('/cadastro/contas-bancarias', { method: 'POST', body: JSON.stringify(dto) }),
  atualizar: (cod: number, dto: AtualizarContaBancariaDto) =>
    req<ContaBancaria>(`/cadastro/contas-bancarias/${cod}`, { method: 'PUT', body: JSON.stringify(dto) }),
  excluir: (cod: number) =>
    req<void>(`/cadastro/contas-bancarias/${cod}`, { method: 'DELETE' }),
};
