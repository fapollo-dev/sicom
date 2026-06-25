import type { LoteCobranca, CriarLoteCobrancaDto } from '@apollo/shared';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const HEADERS = {
  'content-type': 'application/json',
  'x-tenant-id': 'pinheirao',
  'x-operador-id': '7',
  'x-empresa-id': '1',
};
export type LoteRow = { codlotecob: number; codparceiro: number; data: string; qtd_itens: number };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: HEADERS });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.code ?? res.statusText), { status: res.status, body });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const lotesApi = {
  listar: () => req<LoteRow[]>('/cobranca/lotes'),
  ler: (cod: number) => req<LoteCobranca>(`/cobranca/lotes/${cod}`),
  criar: (dto: CriarLoteCobrancaDto) =>
    req<LoteCobranca>('/cobranca/lotes', { method: 'POST', body: JSON.stringify(dto) }),
  atualizar: (cod: number, dto: CriarLoteCobrancaDto) =>
    req<LoteCobranca>(`/cobranca/lotes/${cod}`, { method: 'PUT', body: JSON.stringify(dto) }),
  excluir: (cod: number) => req<void>(`/cobranca/lotes/${cod}`, { method: 'DELETE' }),
};
