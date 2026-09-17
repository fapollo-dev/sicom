/** ATUALIZAÇÃO AUTOMÁTICA DE PRODUTOS (`FRMMULTATUALIZACAO`) — fetcher. */
import { isErroResposta, type ErroResposta, type PisCofinsMultDto, type SimularMultDto } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = '/cadastro/mult-atualizacao';

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

export interface ProdutoMult {
  idproduto: number; codbarra: string | null; descricao: string | null; unidade: string | null;
  ativo: string | null; grupo: string | null; subgrupo: string | null; departamento: string | null;
  fornecedor: string | null; vrcusto: number | null; vrvenda: number | null; markup: number | null;
  [k: string]: unknown;
}

export interface LinhaSimulada {
  idproduto: number; codbarra: string | null; descricao: string | null;
  antes: string | null; depois: string | null; mudou: boolean; erro?: string;
}

export const multApi = {
  buscar: (q: Record<string, string>) => req<ProdutoMult[]>(`${P}/produtos?${new URLSearchParams(q)}`),
  simular: (b: SimularMultDto) => req<{ linhas: LinhaSimulada[]; mudam: number }>(`${P}/simular`, { method: 'POST', body: JSON.stringify(b) }),
  aplicar: (b: SimularMultDto) => req<{ produtos: number }>(`${P}/aplicar`, { method: 'POST', body: JSON.stringify(b) }),
  pisCofins: (b: PisCofinsMultDto) => req<{ produtos: number }>(`${P}/pis-cofins`, { method: 'POST', body: JSON.stringify(b) }),
};
