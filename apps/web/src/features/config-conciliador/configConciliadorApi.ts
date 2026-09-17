/**
 * CONFIGURADOR DE CONCILIAÇÃO DE CARTÕES (`FRMCADCONFIGCONCILIADOR`) — fetcher.
 */
import { isErroResposta, type ConfigConciliadorDto, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = '/cadastro/config-conciliador';

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

export interface LayoutResumo {
  cic_id: number; cic_descricao: string; cic_tipo_importacao: string;
  cic_linha_inicio_importacao: number; cic_tipo_separacao_campos: string;
  buscadataempvlr: string; buscadatavlrcartao: string; buscansu: string; buscaautorizacao: string;
  itens: number; dtultimalteracao: string | null;
}

export interface ItemLayout {
  cici_id?: number;
  cici_campo_tabela: string; cici_tipo_campo: string;
  cici_formato_campo: string | null; cici_posicao: string | null;
  cici_tamanho: number | null; cici_casas_decimais: number | null; cici_valor_fixo: string | null;
}

export type LayoutDetalhe = Omit<LayoutResumo, 'itens'> & { itens: ItemLayout[] };

export const configConciliadorApi = {
  listar: () => req<LayoutResumo[]>(P),
  obter: (id: number) => req<LayoutDetalhe>(`${P}/${id}`),
  criar: (dto: ConfigConciliadorDto) => req<{ cic_id: number }>(P, { method: 'POST', body: JSON.stringify(dto) }),
  atualizar: (id: number, dto: ConfigConciliadorDto) =>
    req<{ cic_id: number }>(`${P}/${id}`, { method: 'PUT', body: JSON.stringify(dto) }),
  excluir: (id: number) => req<{ cic_id: number }>(`${P}/${id}`, { method: 'DELETE' }),
};
