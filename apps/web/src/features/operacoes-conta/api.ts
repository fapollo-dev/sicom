import type {
  OperacaoConta,
  CriarOperacaoContaDto,
  AtualizarOperacaoContaDto,
} from '@apollo/shared';

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

export const operacoesContaApi = {
  listar: () => req<OperacaoConta[]>('/cadastro/operacoes-conta'),
  ler: (cod: number) => req<OperacaoConta>(`/cadastro/operacoes-conta/${cod}`),
  criar: (dto: CriarOperacaoContaDto) =>
    req<OperacaoConta>('/cadastro/operacoes-conta', { method: 'POST', body: JSON.stringify(dto) }),
  atualizar: (cod: number, dto: AtualizarOperacaoContaDto) =>
    req<OperacaoConta>(`/cadastro/operacoes-conta/${cod}`, { method: 'PUT', body: JSON.stringify(dto) }),
  excluir: (cod: number) =>
    req<void>(`/cadastro/operacoes-conta/${cod}`, { method: 'DELETE' }),
};
