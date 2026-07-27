/**
 * Fetcher do DE-PARA de fornecedor (CODREFERENCIA_FOR) — espelha promocaoApi (apiHeaders/BASE + envelope ADR-015).
 * Reusa o CRUD canônico `compras/de-para` (DeParaController): a MESMA tabela vista das abas "Ref. Fornecedor" de
 * Parceiros (por codfor) e Produto (por idproduto). Sem escrita própria — o DeParaService é o único writer.
 */
import { isErroResposta, type ErroResposta, type DePara, type CriarDeParaDto } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const DP = '/compras/de-para';

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

/** lista as referências filtrando por fornecedor (codfor) OU por produto (idproduto). */
export function listarDePara(filtro: { codfor?: number; idproduto?: number }): Promise<DePara[]> {
  const qs = new URLSearchParams();
  if (filtro.codfor != null) qs.set('codfor', String(filtro.codfor));
  if (filtro.idproduto != null) qs.set('idproduto', String(filtro.idproduto));
  const s = qs.toString();
  return req(`${DP}${s ? `?${s}` : ''}`);
}

export function criarDePara(dto: CriarDeParaDto): Promise<DePara> {
  return req(DP, { method: 'POST', body: JSON.stringify(dto) });
}

export function removerDePara(id: number): Promise<void> {
  return req(`${DP}/${id}`, { method: 'DELETE' });
}
