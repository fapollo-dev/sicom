/**
 * Fetcher do CAIXA (corte-1 — sessão + movimento manual). Espelha `areceberApi.ts` (headers/BASE +
 * envelope ErroResposta/ADR-015). Ações: abrir/movimentar/estornar/fechar; leitura `atual` (sessão
 * aberta do operador + movimentos). Erros (caixa já aberto, saldo insuficiente, etc.) sobem como
 * envelope PT, exibido via `useMensagem`.
 */
import {
  isErroResposta, type ErroResposta,
  type AbrirCaixaDto, type MovimentoCaixaDto, type CaixaSessao, type CaixaMov,
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
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: (body as any)?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as T;
}

export interface CaixaAtual {
  sessao: CaixaSessao;
  movimentos: CaixaMov[];
}

/** Sessão aberta do operador logado (+ movimentos), ou null se não houver caixa aberto. */
export function caixaAtual(): Promise<CaixaAtual | null> {
  return req(`/cobranca/caixa/atual`);
}

/** Abre o caixa do operador (fundo de caixa opcional). */
export function abrirCaixa(body: AbrirCaixaDto): Promise<{ codcaixa: number; saldoInicial: number; status: 'A' }> {
  return req(`/cobranca/caixa/abrir`, { method: 'POST', body: JSON.stringify(body) });
}

/** Lança um movimento manual na sessão aberta. */
export function movimentarCaixa(body: MovimentoCaixaDto): Promise<{ codmov: number; codcaixa: number; tipo: 'E' | 'S'; especie: string; valor: number; saldoCorrente: number }> {
  return req(`/cobranca/caixa/movimentar`, { method: 'POST', body: JSON.stringify(body) });
}

/** Estorno lógico de um movimento (indr='E'). */
export function estornarMovimentoCaixa(codmov: number): Promise<{ codmov: number; indr: 'E' }> {
  return req(`/cobranca/caixa/mov/${codmov}/estornar`, { method: 'POST' });
}

/** Fecha o caixa (só o dono). Com `valorContado` faz conferência (quebra/sobra + título de quebra). */
export function fecharCaixa(
  codcaixa: number,
  body?: { valorContado?: number; gerarTituloQuebra?: boolean; obs?: string },
): Promise<{ codcaixa: number; status: 'F'; saldoFinal: number; valorContado: number | null; diferenca: number | null; classificacao: 'OK' | 'QUEBRA' | 'SOBRA' | null; codrcbQuebra: number | null }> {
  return req(`/cobranca/caixa/${codcaixa}/fechar`, { method: 'POST', body: JSON.stringify(body ?? {}) });
}
