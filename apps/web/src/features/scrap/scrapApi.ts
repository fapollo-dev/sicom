/**
 * Fetcher do SCRAP / PERDAS. Agregado `cadastro/scrap` (cabeçalho + itens) + verticais (aplicar/estornar a baixa
 * de estoque). Motivo de perda vem de `cadastro/motivos-operacao` filtrado por tipo_operacao='PERDA'.
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

export interface ScrapHeader {
  codscrap: number;
  dt_cadastro: string | null;
  parceiro?: string | null;
  qtde_itens?: number;
  valor_total?: number;
  mov_estoque?: string | null;
  importado?: string | null;
}
export interface ScrapItem {
  codscrapitem?: number;
  idproduto: number;
  qtde: number;
  vr_custo?: number;
  codmotivoop?: number | null;
  codsetor?: number | null;
  codfor?: number | null;
  idproduto_filho?: number | null;
}
export interface ScrapDetalhe extends ScrapHeader {
  codplc?: number | null;
  codparceiro?: number | null;
  idsituacao_nf?: number | null;
  obs?: string | null;
  itens: ScrapItem[];
}
export interface MotivoPerda {
  codmotivoop: number;
  descricao: string;
  tipo_operacao?: string | null;
  indr?: string | null;
}

export function listarScraps(): Promise<ScrapHeader[]> {
  return req('/cadastro/scrap', { method: 'GET' });
}
export function obterScrap(id: number): Promise<ScrapDetalhe> {
  return req(`/cadastro/scrap/${id}`, { method: 'GET' });
}
export interface ScrapGravar { codplc?: number | null; idsituacao_nf?: number | null; obs?: string; itens: ScrapItem[] }
export function criarScrap(body: ScrapGravar): Promise<ScrapDetalhe> {
  return req('/cadastro/scrap', { method: 'POST', body: JSON.stringify(body) });
}
export function atualizarScrap(id: number, body: ScrapGravar): Promise<ScrapDetalhe> {
  return req(`/cadastro/scrap/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}
export function excluirScrap(id: number): Promise<void> {
  return req(`/cadastro/scrap/${id}`, { method: 'DELETE' });
}
export function aplicarScrap(id: number): Promise<{ codscrap: number; mov_estoque: 'S'; itens: number }> {
  return req(`/cadastro/scrap/${id}/aplicar`, { method: 'POST' });
}
export function estornarScrap(id: number): Promise<{ codscrap: number; mov_estoque: null; itens: number }> {
  return req(`/cadastro/scrap/${id}/estornar`, { method: 'POST' });
}
/** motivos de PERDA (filtra o cadastro genérico por tipo_operacao='PERDA'). */
export async function listarMotivosPerda(): Promise<MotivoPerda[]> {
  const todos = await req<MotivoPerda[]>('/cadastro/motivos-operacao', { method: 'GET' });
  return (todos ?? []).filter((m) => m.tipo_operacao === 'PERDA' && m.indr !== 'E');
}

/** o apoio da tela: situações de SCRAP (E02), centros de custo de perda, setores, o parceiro da empresa e as configurações */
export interface ScrapApoio {
  situacoes: Array<{ idsituacao_nf: number; descricao: string }>;
  centros: Array<{ codplc: number; desccodplc: string | null; descricao: string; uso_setor: string; obriga_motivo: string }>;
  centrosDaSituacao: Record<string, number[]>;
  setores: Array<{ codsetor: number; nome: string }>;
  parceiro: { codparceiro: number | null; razao: string | null } | null;
  informaSituacao: boolean;
  informaMotivo: boolean;
  baixarEstoque: boolean;
}
export function apoioScrap(): Promise<ScrapApoio> {
  return req('/cadastro/scrap/apoio/dados', { method: 'GET' });
}
