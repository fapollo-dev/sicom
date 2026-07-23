/**
 * Fetcher da GESTÃO DE PROMOÇÕES (UCadPromocao) — espelha agendaPromocaoApi (apiHeaders/BASE + envelope
 * ADR-015). CRUD do agregado cadastro/promocao (header PROMOCAO + itens CLUBE_DESCONTO). corte-1: Preço Fixo.
 */
import { isErroResposta, type ErroResposta, type Promocao, type CriarPromocaoDto } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const AP = '/cadastro/promocao';

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
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface ListarPromocoesParams {
  campo?: string;
  operador?: string;
  valor?: string;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
}

export function listarPromocoes(params?: ListarPromocoesParams): Promise<Promocao[]> {
  const qs = new URLSearchParams();
  if (params) for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return req(`${AP}${s ? `?${s}` : ''}`);
}

export function obterPromocao(id: number): Promise<Promocao & { itens: any[] }> {
  return req(`${AP}/${id}`);
}

export function criarPromocao(dto: CriarPromocaoDto): Promise<Promocao & { itens: any[] }> {
  return req(AP, { method: 'POST', body: JSON.stringify(dto) });
}

export function atualizarPromocao(id: number, dto: Partial<CriarPromocaoDto>): Promise<Promocao & { itens: any[] }> {
  return req(`${AP}/${id}`, { method: 'PUT', body: JSON.stringify(dto) });
}

export function removerPromocao(id: number): Promise<void> {
  return req(`${AP}/${id}`, { method: 'DELETE' });
}
