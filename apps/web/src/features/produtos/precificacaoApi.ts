/**
 * Fetcher do MOTOR de precificação (F2 — REUSO, não reescrita). A tela só ARMAZENA o
 * preço por empresa (MULTI_PRECO); o cálculo de venda (custo+markup+impostos) é REUSADO
 * de `POST /precificacao/produto`, que vive nos services portados do legado + Reforma
 * (apps/api/src/modules/precificacao). Mesma semântica de headers/BASE do `resourceApi`
 * (tenant ids) e mesmo envelope `ErroResposta` (ADR-015), exibido via `useMensagem`.
 */
import { isErroResposta, type ErroResposta } from '@apollo/shared';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const HEADERS = {
  'content-type': 'application/json',
  'x-tenant-id': 'pinheirao',
  'x-operador-id': '7',
  'x-empresa-id': '1',
};

/** Corpo do `POST /precificacao/produto` (espelha `precificarProdutoSchema` do shared). */
export interface PrecificarProdutoBody {
  custo: number;
  margem: number;
  aliquota: string; // código fiscal do produto (T01, T56, STB…) — regra legada
  uf: string;
  pis: number;
  cofins: number;
  regime: 'atual' | 'reforma' | 'transicao';
  dataRef?: string;
}

/** Resposta do motor (PrecificarProdutoResult do service). */
export interface PrecificarProdutoResposta {
  valorVenda: number;
  regime: 'atual' | 'reforma' | 'transicao';
  cst: number; // do legado (00/20/40/60)
  icmEfetivo: number;
  baseReduzida: boolean;
  fonte: string; // a LEI do legado e/ou a fonte da Reforma
}

/** Mesma semântica do `req` do resourceApi (envelope ErroResposta — ADR-015). */
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: HEADERS });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), {
      envelope,
      status: res.status,
      body,
    });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/**
 * Calcula o preço de venda REUSANDO o motor do back (legado + Reforma). Lança o envelope
 * PT padrão em erro (apresentado via `useMensagem`). Rede via API: não é coberto pelos
 * testes web (mesma política do `buscarCep`).
 */
export function precificarProduto(
  body: PrecificarProdutoBody,
): Promise<PrecificarProdutoResposta> {
  return req<PrecificarProdutoResposta>('/precificacao/produto', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
