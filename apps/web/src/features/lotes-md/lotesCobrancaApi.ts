/**
 * Fetchers específicos do Lote de Cobrança que NÃO cabem no `createResourceApi`
 * genérico (cujo `listar` só repassa os campos de `PesquisaParams`). Aqui ficam:
 *  - `listAreceber` → GET /cobranca/areceber (picker de títulos; aceita
 *    `excluirDoLote` e `consiliado`, fora do contrato de Pesquisa);
 *  - o tipo `AreceberRow` (linha do picker) e `ItemLote` (item enriquecido do grid).
 *
 * O lookup de "Cobrador" usa o `useResourceOptions('cobranca/cobradores', …)` padrão
 * (recurso REST simples) — não precisa de fetcher dedicado.
 */
import { isErroResposta, type ErroResposta } from '@apollo/shared';

import { apiHeaders, handle401 } from '../../shared/auth/session';
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** Linha do picker GET_ARECEBER — título disponível para entrar no lote. */
export interface AreceberRow {
  codrcb: number;
  codparceiro: number;
  razao: string;
  duplicata: string;
  dtvenda: string;
  dtvenc: string;
  valor: number;
  txjuros: number;
  juros: number;
  total: number;
  consiliado: string;
  codempresa: number;
  endereco?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  telefone?: string;
}

/**
 * Item do lote no GRID (read enriquecido do master). Carrega o `codrcb` (único campo
 * persistido) + as colunas de exibição (joined). O mesmo shape é montado a partir da
 * `AreceberRow` quando o usuário adiciona títulos ainda não gravados.
 */
export interface ItemLote {
  codrcb: number;
  // display-only (não vão no save — o zod do schema descarta chaves desconhecidas)
  duplicata?: string;
  razao?: string;
  dtvenc?: string;
  valor?: number;
  juros?: number;
  total?: number;
  codilotcob?: number;
}

/** Mesma semântica do `req` do resourceApi (envelope ErroResposta — ADR-015). */
async function req<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: apiHeaders() });
  handle401(res);
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
 * Lista os títulos a receber disponíveis para o picker. Passe `excluirDoLote` (o
 * codlotecob corrente) só ao EDITAR um lote — assim os títulos já no lote somem da
 * lista. `consiliado='S'` espelha o filtro do legado (btnAddIten / GET_ARECEBER).
 */
export function listAreceber(opts?: {
  excluirDoLote?: number;
  consiliado?: 'S' | 'N';
}): Promise<AreceberRow[]> {
  const qs = new URLSearchParams();
  if (opts?.consiliado) qs.set('consiliado', opts.consiliado);
  if (opts?.excluirDoLote != null) qs.set('excluirDoLote', String(opts.excluirDoLote));
  const s = qs.toString();
  return req<AreceberRow[]>(`/cobranca/areceber${s ? `?${s}` : ''}`);
}
