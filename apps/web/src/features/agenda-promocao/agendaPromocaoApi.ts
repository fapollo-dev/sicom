/**
 * Fetcher da AGENDA DE PROMOÇÃO (espelha devolucaoCompraApi: apiHeaders/BASE + envelope ADR-015). CRUD do
 * agregado (cadastro/agenda-promocao) + as transições de estado (encerrar/reabrir). corte-1 SEM efeito.
 */
import {
  isErroResposta,
  type ErroResposta,
  type AgendaPromocaoDto,
  type AgendaPromocao,
} from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const AP = '/cadastro/agenda-promocao';

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

export interface ListarAgendasParams {
  campo?: string;
  operador?: string;
  valor?: string;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
}

export function listarAgendas(params?: ListarAgendasParams): Promise<AgendaPromocao[]> {
  const qs = new URLSearchParams();
  if (params) for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return req(`${AP}${s ? `?${s}` : ''}`);
}

export function obterAgenda(id: number): Promise<AgendaPromocao> {
  return req(`${AP}/${id}`);
}

/** o rascunho da agenda clonada (miClonarAgenda): nome + " - CLONE", opções, observação e os itens — sem datas nem lojas */
export interface AgendaClone {
  nomepromo: string; opcoes: number | string | null; obs: string | null;
  itens: Array<{ idproduto: number; vrvenda: number | null; vlrpromocao: number; vrclube_fidelidade: number | null; ativo: string | null;
    tv: string | null; radio: string | null; tabloide: string | null; interno: string | null; atualizacao_grupo: string | null; opcoes: number | string | null }>;
}
export function clonarAgenda(id: number): Promise<AgendaClone> {
  return req(`${AP}/${id}/clone`);
}

export function criarAgenda(dto: AgendaPromocaoDto): Promise<AgendaPromocao> {
  return req(AP, { method: 'POST', body: JSON.stringify(dto) });
}

export function atualizarAgenda(id: number, dto: Partial<AgendaPromocaoDto>): Promise<AgendaPromocao> {
  return req(`${AP}/${id}`, { method: 'PUT', body: JSON.stringify(dto) });
}

export function removerAgenda(id: number): Promise<void> {
  return req(`${AP}/${id}`, { method: 'DELETE' });
}

export function encerrarAgenda(id: number): Promise<{ codagenda: number; situacao: string }> {
  return req(`${AP}/${id}/encerrar`, { method: 'POST' });
}
export function reabrirAgenda(id: number): Promise<{ codagenda: number; situacao: string }> {
  return req(`${AP}/${id}/reabrir`, { method: 'POST' });
}
/** corte-2: aplica o preço promocional dos itens ativos ao multi_preco (PROMOCAO='S'/VRPROMO). */
export function aplicarAgenda(id: number): Promise<{ codagenda: number; aplicados: number }> {
  return req(`${AP}/${id}/aplicar`, { method: 'POST' });
}

/** os relatórios do menu "Outros" (GeralRel / GerarRelProdInativos) — sem período, valem as datas/horas da agenda */
export type TipoRelAgenda = 'vendidos' | 'tv' | 'radio' | 'tabloide' | 'interno' | 'totais' | 'totais-itens' | 'por-loja' | 'fim-promocao' | 'inativos';
export interface RelAgendaResposta {
  agenda: { codagenda: number; nomepromo: string | null };
  tipo: TipoRelAgenda;
  dtini?: string; dtfim?: string; horaIni?: string; horaFim?: string; data?: string; empresas?: number[];
  linhas: Array<Record<string, unknown>>;
  departamentos?: Array<Record<string, unknown>>;
  porProduto?: Array<{ codproduto: number; codbarra: unknown; descricao: unknown; lojas: Record<string, { qtde: number; vrcusto: number; vrvenda: number }> }>;
}
export function relatorioAgenda(id: number, p: { tipo: TipoRelAgenda; dtini?: string; dtfim?: string; horaIni?: string; horaFim?: string }): Promise<RelAgendaResposta> {
  const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v != null && v !== '') as Array<[string, string]>);
  return req(`/relatorios/agenda-promocao/${id}?${q.toString()}`);
}
