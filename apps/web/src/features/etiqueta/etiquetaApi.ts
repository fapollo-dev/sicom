/**
 * Fetcher das ETIQUETAS DE PREÇO (FRMETIQUETA). As linhas vêm do servidor com o registro do legado (cdsImpressao) e a
 * origem (produto, lote do Ajuste de Preços, agenda); na impressão o servidor refaz o registro pela origem, grava o log e
 * devolve os trabalhos + o .fr3 de cada modelo, que o navegador desenha (`fr3/render.ts`).
 */
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import type { PedidoDeItens } from '../../shared/etiquetas/listaParaEtiquetas';

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

export type OrigemEtiqueta =
  | { tipo: 'produto'; caminho: 'codbarra' | 'pesquisa' | 'coletor' | 'importacao' | 'cadastro'; fatorEmbalagem?: number }
  | { tipo: 'lote'; codlotepreco: number }
  | { tipo: 'agenda'; codagenda: number; preco: 'status' | 'venda' | 'promocional' }
  | { tipo: 'preco'; fonte: 'precificacao' | 'precos-alterados'; valor: number }
  | { tipo: 'nf'; codnfprod: number };

export type Registro = Record<string, string | number | boolean | null>;

export interface Etiqueta {
  idetiqueta?: number;
  idproduto: number;
  codbarra: string | null;
  descricao: string;
  unidade: string | null;
  fator: number;
  qtde: number;
  valor_venda: number;
  valor_promocao: number;
  valor_venda_promocao: number;
  promocao: string;
  origem: OrigemEtiqueta;
  registro: Registro;
}

export interface ItemImpressao {
  idetiqueta?: number;
  idproduto: number;
  qtde: number;
  modelo: string;
  descricao?: string;
  observacao1?: string;
  observacao2?: string;
  origem: OrigemEtiqueta;
}

export interface RespostaImpressao {
  total_etiquetas: number;
  trabalhos: Array<{ modelo: string; zebra: boolean; registros: Registro[] }>;
  modelos: Record<string, string>;
}

const qAtivos = (ativos: boolean) => (ativos ? '' : 'ativos=N');

export function listarFila(ativos = true): Promise<Etiqueta[]> {
  return req(`/cadastro/etiqueta/fila?${qAtivos(ativos)}`, { method: 'GET' });
}
export function buscarProduto(codbarra: string, ativos = true): Promise<Etiqueta> {
  return req(`/cadastro/etiqueta/produto?codbarra=${encodeURIComponent(codbarra)}${ativos ? '' : '&ativos=N'}`, { method: 'GET' });
}
export function listarModelos(): Promise<Array<{ nome: string; tipo: string }>> {
  return req('/cadastro/etiqueta/modelos', { method: 'GET' });
}
export function remover(idetiqueta: number): Promise<{ idetiqueta: number; removido: boolean }> {
  return req(`/cadastro/etiqueta/${idetiqueta}`, { method: 'DELETE' });
}
export function imprimir(pedido: { itens: ItemImpressao[]; descricaoPor: 'produto' | 'grupo'; observacao1: string; observacao2: string; coletor: boolean; listados: number[] }): Promise<RespostaImpressao> {
  return req('/cadastro/etiqueta/imprimir', { method: 'POST', body: JSON.stringify(pedido) });
}
export function importarCodigos(codigos: string[]): Promise<{ etiquetas: Etiqueta[]; naoEncontrados: string[] }> {
  return req('/cadastro/etiqueta/importar', { method: 'POST', body: JSON.stringify({ codigos }) });
}


/** as etiquetas da agenda de promoção (o botão Etiquetas da agenda) */
export function etiquetasDaAgenda(codagenda: number, preco: string): Promise<Etiqueta[]> {
  return req('/cadastro/etiqueta/da-agenda', { method: 'POST', body: JSON.stringify({ codagenda, preco }) });
}
/** as etiquetas dos lotes do Ajuste de Preços (expandidas pelo grupo de preço, com o preço do lote) */
export function etiquetasDosLotes(codlotes: number[], semPromocao: boolean): Promise<Etiqueta[]> {
  return req('/cadastro/etiqueta/dos-lotes', { method: 'POST', body: JSON.stringify({ codlotes, semPromocao }) });
}

export { abrirEtiquetasCom, lerPedidoDeItens, type FonteEtiquetas, type PedidoDeItens } from '../../shared/etiquetas/listaParaEtiquetas';
/** as telas que abrem as etiquetas com a lista pronta (cadastro de produto, Precificação NF, preços alterados, NF, a Pesquisa) */
export function etiquetasDeItens(pedido: PedidoDeItens): Promise<Etiqueta[]> {
  const { marcar: _marcar, ...corpo } = pedido;
  return req('/cadastro/etiqueta/de-itens', { method: 'POST', body: JSON.stringify(corpo) });
}

/** as linhas "CODBARRA/QTDE/VALOR" do arquivo: o código é o que vem antes da 1ª barra (btnImportClick :1004) */
export function codigosDoArquivo(conteudo: string): string[] {
  return conteudo.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => (l.includes('/') ? l.slice(0, l.indexOf('/')) : ''));
}

/** o preço que o modelo da loja imprime: IIF(VRPROMO > 0, VRPROMO, VRVENDA1) (GONDULA PINHEIRAO, 99,8% das impressões) */
export function precoNaEtiqueta(e: Etiqueta): number {
  const vp = Number(e.registro?.VRPROMO ?? 0);
  return vp > 0 ? vp : Number(e.registro?.VRVENDA1 ?? e.valor_venda_promocao ?? 0);
}
