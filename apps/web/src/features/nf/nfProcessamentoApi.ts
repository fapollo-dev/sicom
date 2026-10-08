/**
 * Fetcher das ações de PROCESSAMENTO da NF (F3 — movem estoque). Espelha `nfFiscalApi.ts`
 * (headers/BASE + envelope ErroResposta/ADR-015). Diferente do recalcular (puro), estas
 * ESCREVEM no servidor (movimento de estoque + flip de PROC, atômico). Erros (estoque
 * negativo, já processada, enviada à SEFAZ) sobem como envelope PT, exibido via `useMensagem`.
 */
import { isErroResposta, type ErroResposta } from '@apollo/shared';

import { apiHeaders, handle401 } from '../../shared/auth/session';
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function req<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: apiHeaders(), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as T;
}

export interface ProcessamentoResultado {
  codnf: number;
  proc: 'S' | 'N';
}

export type ModoPrecoProcessar = 'online' | 'lote' | 'nenhum';
export interface EscolhasDoProcessar { precos?: { modo?: ModoPrecoProcessar; sincronizar?: boolean; itens?: number[] }; semAlterarCusto?: number[]; liberacaoEstoqueNegativo?: { login: string; senha: string } }

/** Processa a NF: move o estoque (entrada soma / saída baixa), atualiza os produtos e o preço (na entrada) e trava a nota (proc='S'). */
export function processarNf(codnf: number, escolhas?: EscolhasDoProcessar, rapido = false): Promise<ProcessamentoResultado> {
  // `rapido`: a janela do processamento rápido (a entrada de transferência, na loja dela)
  return req<ProcessamentoResultado>(`/fiscal/nf/${codnf}/${rapido ? 'processamento-rapido/processar' : 'processar'}`, escolhas);
}

export interface ItemDoProcessar {
  codnfprod: number; nroitem: number; codproduto: number; descricao?: string | null; quantidade: unknown; vrvenda: unknown; vrvenda_loja: unknown;
  alterapreco: boolean; alteracusto: boolean;
}
export interface OpcoesDoProcessar { codnf: number; entrada: boolean; modo: ModoPrecoProcessar; sincronizar: boolean; onlineBloqueado: boolean; itens: ItemDoProcessar[] }

/** os padrões da tela de processar (TfrmEstoqueNF.FormShow) */
export async function opcoesDoProcessarNf(codnf: number, rapido = false): Promise<OpcoesDoProcessar> {
  const res = await fetch(`${BASE}/fiscal/nf/${codnf}/${rapido ? 'processamento-rapido/opcoes' : 'processar/opcoes'}`, { headers: apiHeaders() });
  handle401(res);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const envelope: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return body as OpcoesDoProcessar;
}

/** Reverte o processamento: estorna o estoque (sentido inverso) e libera a nota (proc='N'). */
export function reverterNf(codnf: number, liberacaoEstoqueNegativo?: { login: string; senha: string }): Promise<ProcessamentoResultado> {
  return req<ProcessamentoResultado>(`/fiscal/nf/${codnf}/reverter`, liberacaoEstoqueNegativo ? { liberacaoEstoqueNegativo } : undefined);
}

/** o servidor pediu a liberação do estoque negativo (PERMITE_PROC_NF_ESTOQUE_NEG = 'N'): os itens negativos */
export function pedeLiberacaoEstoqueNegativo(e: unknown): Array<{ nroitem: number; codproduto: number; saldo: number }> | null {
  const env = (e as { envelope?: { code?: string; detalhe?: { itens?: Array<{ nroitem: number; codproduto: number; saldo: number }>; exigeLiberacao?: boolean } } })?.envelope;
  return env?.code === 'NF_ESTOQUE_NEGATIVO' && env.detalhe?.exigeLiberacao ? env.detalhe.itens ?? [] : null;
}

export interface ParDeSincronizacao { de: string; para: string }

/**
 * Sincroniza CFOP, alíquota e CST dos itens por de-para (uSincronizaCFOPNotaFiscal): cada item com o valor "de" recebe o "para" uma
 * vez, e todos saem marcados como sincronizados. Grava direto (a nota tem de estar editável).
 */
export function sincronizarNf(codnf: number, pares: { mapa: ParDeSincronizacao[]; aliquotas: ParDeSincronizacao[]; csts: ParDeSincronizacao[] }): Promise<{ codnf: number; itens: number; sincronizados: number }> {
  return req(`/fiscal/nf/${codnf}/sincronizar-cfop`, pares);
}

export interface RepasseAutomaticoResultado { codnf: number; itens: number; comIndexador: number; repassados: number }

/**
 * A análise automática dos itens de entrada — [F7] todos, ou [F8] um (`codnfprod`) — UAnalisaItemNF: relê o produto, consulta o indexador
 * de novo e refaz o ST externo, a base/ICMS e o custo de cada item. Grava no servidor; a tela relê a nota depois.
 */
export function repasseAutomaticoNf(codnf: number, codnfprod?: number): Promise<RepasseAutomaticoResultado> {
  return req<RepasseAutomaticoResultado>(`/fiscal/nf/${codnf}/repasse-automatico${codnfprod != null ? `?item=${codnfprod}` : ''}`);
}

/** relê a nota gravada (GET do agregado) — para refletir na tela o que uma ação do servidor mudou */
export async function lerNf(codnf: number): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/fiscal/nf/${codnf}`, { headers: apiHeaders() });
  handle401(res);
  if (!res.ok) throw Object.assign(new Error('ERRO'), { status: res.status });
  return (await res.json()) as Record<string, unknown>;
}

/** liberar a NF do uso do indexador (ou voltar a usar) — o login do próprio usuário (uNF.pas:17780) */
export function liberarIndexadorNf(codnf: number, cred: { login: string; senha: string }): Promise<{ codnf: number; libera_nf_indexador: 'S' | 'N' }> {
  return req(`/fiscal/nf/${codnf}/liberar-indexador`, cred);
}

/** o item-pai de entrada decomposta que o Editar da nota abre no diálogo "Item de decomposição nota fiscal", com os padrões dele */
export interface PaiDecomposicao {
  codnfprod: number; nroitem: number | null; codproduto: number; descricao: string | null; codbarra: string | null; unidade: string | null;
  fatorembal: number; qtdetotal: number; totalprods: number; cfop: number | null;
}
export async function pendentesDecomposicaoNf(codnf: number): Promise<PaiDecomposicao[]> {
  const res = await fetch(`${BASE}/fiscal/nf/${codnf}/decomposicao/pendentes`, { headers: apiHeaders() });
  handle401(res);
  if (!res.ok) return []; // sem a permissão de gravar a nota, não há o que decompor
  return (await res.json()) as PaiDecomposicao[];
}
/** "Confirmar decomposição": o pai sai e os produtos da decomposição entram na nota */
export function decomporItemNf(codnf: number, escolhas: { codnfprod: number; grupo?: { codprodutopai: number; nroitemDecomp: number | null }; qtdTotal: number; valorTotal: number; cfop: number }): Promise<{ codnf: number }> {
  return req(`/fiscal/nf/${codnf}/decomposicao`, escolhas);
}

/** CLONAR a nota / gerar a NOTA DE TRANSFERÊNCIA entre lojas (ClonaNF): a nota nova, não processada — a transferência nasce na loja de destino */
export function clonarNf(codnf: number, operacao: 'CLONAR' | 'TRANSFERENCIA'): Promise<{ codnf: number; idempresa: number; nronf: string; tipo: string; empresa?: string | null }> {
  return req(`/fiscal/nf/${codnf}/clonar`, { operacao });
}

/** PROCESSAMENTO RÁPIDO (TFrmProcessaNotaFiscal): a nota de transferência na loja de destino — os dados, as pendências e as ações dela */
export interface NotaDoProcessamentoRapido {
  nota: { codnf: number; nronf: string | null; serie: string | null; dtemissao: string | null; chavenfe: string | null; razao: string | null; cnpj_cpf: string | null;
    totalnf: number; idsituacao_nf: number | null; desc_situacao: string | null; cfop: number | null; proc: string; tipo: string; idempresa: number; fantasia: string | null };
  pendencias: Array<{ ordem: number; atalho: string; descricao: string; realizado: 'R' | 'P' }>;
}
async function pedir<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const envelope: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return body as T;
}
export const lerProcessamentoRapido = (codnf: number) => pedir<NotaDoProcessamentoRapido>(`/fiscal/nf/${codnf}/processamento-rapido`);
export const situacoesDoProcessamentoRapido = (codnf: number) =>
  pedir<Array<{ idsituacao_nf: number; descricao: string | null; cfops: string }>>(`/fiscal/nf/${codnf}/processamento-rapido/situacoes`);
export const vincularSituacaoRapido = (codnf: number, idsituacao_nf: number) =>
  pedir(`/fiscal/nf/${codnf}/processamento-rapido/situacao`, { method: 'PUT', body: JSON.stringify({ idsituacao_nf }) });
export interface LancamentosDoProcessamentoRapido { linhas: Array<{ codcontabilnf: number; idsituacao_nf: number; situacao: string | null; codcc: number; centro_custo: string | null; codigo_extenso: string | null; valor: number }>; total: number; totalnf: number }
export const lancamentosDoProcessamentoRapido = (codnf: number) => pedir<LancamentosDoProcessamentoRapido>(`/fiscal/nf/${codnf}/processamento-rapido/lancamentos`);
export const preencherLancamentosRapido = (codnf: number) =>
  pedir<LancamentosDoProcessamentoRapido>(`/fiscal/nf/${codnf}/processamento-rapido/lancamentos`, { method: 'POST' });

