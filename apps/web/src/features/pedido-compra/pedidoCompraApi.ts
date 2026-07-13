/**
 * Fetcher do PEDIDO DE COMPRA (espelha caixaApi/ajusteEstoqueApi: headers/BASE + envelope
 * ErroResposta/ADR-015). CRUD do agregado mestre-detalhe (compras/pedidos) + as transições de
 * ESTADO verticais (fechar/reabrir — rascunho↔fechado). Erros em PT via useMensagem.
 */
import {
  isErroResposta,
  type ErroResposta,
  type CriarPedidoCompraDto,
  type AtualizarPedidoCompraDto,
  type PedidoCompra,
} from '@apollo/shared';

import { apiHeaders, handle401 } from '../../shared/auth/session';
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

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

/** Filtro da Pesquisa/lista enviado como query string (espelha PesquisaParams do resourceApi). */
export interface ListarPedidosParams {
  campo?: string;
  operador?: string;
  valor?: string;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  situacao?: 'ativos' | 'inativos' | 'todos';
}

/** GET compras/pedidos — lista (view get_pedidocompra: total = Σ vlrembalagem, qtde_itens, fechado…). */
export function listarPedidos(params?: ListarPedidosParams): Promise<PedidoCompra[]> {
  const qs = new URLSearchParams();
  if (params) for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return req(`/compras/pedidos${s ? `?${s}` : ''}`);
}

/** GET compras/pedidos/:id — agregado (cabeçalho + `itens`). */
export function obterPedido(id: number): Promise<PedidoCompra> {
  return req(`/compras/pedidos/${id}`);
}

/** POST compras/pedidos — cria (body = CriarPedidoCompraDto; exige ≥1 item). */
export function criarPedido(dto: CriarPedidoCompraDto): Promise<PedidoCompra> {
  return req(`/compras/pedidos`, { method: 'POST', body: JSON.stringify(dto) });
}

/** PUT compras/pedidos/:id — atualiza (cabeçalho parcial + itens substituem). */
export function atualizarPedido(id: number, dto: AtualizarPedidoCompraDto): Promise<PedidoCompra> {
  return req(`/compras/pedidos/${id}`, { method: 'PUT', body: JSON.stringify(dto) });
}

/** DELETE compras/pedidos/:id — soft-delete (bloqueado se fechado — reabra antes). */
export function removerPedido(id: number): Promise<void> {
  return req(`/compras/pedidos/${id}`, { method: 'DELETE' });
}

/** POST compras/pedidos/:id/fechar — rascunho→fechado (exige ≥1 item; o servidor reforça). */
export function fecharPedido(id: number): Promise<{ codpedcomp: number; fechado: 'S' }> {
  return req(`/compras/pedidos/${id}/fechar`, { method: 'POST' });
}

/** POST compras/pedidos/:id/reabrir — fechado→rascunho (destrava edição/exclusão). */
export function reabrirPedido(id: number): Promise<{ codpedcomp: number; fechado: 'N' }> {
  return req(`/compras/pedidos/${id}/reabrir`, { method: 'POST' });
}

/**
 * POST compras/pedidos/:id/gerar-parcelas — corte-2: gera as parcelas do pedido (ratear pela condição de
 * pagamento: prazos CD1..CD8 do pedido, senão da condição; valor rateado c/ sobra na 1ª; venc = data+CDn).
 * Substitui as parcelas existentes. Bloqueado em pedido fechado/faturado. Retorna { codpedcomp, parcelas, total }.
 */
export function gerarParcelasPedido(id: number): Promise<{ codpedcomp: number; parcelas: number; total: number }> {
  return req(`/compras/pedidos/${id}/gerar-parcelas`, { method: 'POST' });
}

/** POST :id/atualizar-precos — corte-final: PROPAGA o preço de venda dos itens ao catálogo (MULTI_PRECO). */
export function atualizarPrecosPedido(id: number): Promise<{ codpedcomp: number; atualizados: number; pulados_promocao: number; sem_diferenca: number }> {
  return req(`/compras/pedidos/${id}/atualizar-precos`, { method: 'POST' });
}

/** POST :id/duplicar — corte-final: duplica o pedido (novo rascunho com itens; datas de hoje; sem parcelas). */
export function duplicarPedido(id: number): Promise<{ codpedcomp: number; origem: number; bonificacao: 'S' | 'N' }> {
  return req(`/compras/pedidos/${id}/duplicar`, { method: 'POST' });
}

/** POST :id/gerar-bonificado — corte-final: gera o pedido-ESPELHO de bonificação (itens 100% bonificados). */
export function gerarBonificadoPedido(id: number): Promise<{ codpedcomp: number; origem: number; bonificacao: 'S' | 'N' }> {
  return req(`/compras/pedidos/${id}/gerar-bonificado`, { method: 'POST' });
}

/** POST :id/liberar-limite — corte-final: libera o limite de compra excedido (grant LIBERAVALORMAX). */
export function liberarLimitePedido(id: number): Promise<{ codpedcomp: number; operador: number }> {
  return req(`/compras/pedidos/${id}/liberar-limite`, { method: 'POST' });
}

/** POST :id/importar-itens — corte-final: importa itens em massa do fornecedor (associados / já comprados). */
export function importarItensPedido(
  id: number,
  origem: 'associados' | 'comprados',
): Promise<{ codpedcomp: number; importados: number; ja_no_pedido: number; inativos: number }> {
  return req(`/compras/pedidos/${id}/importar-itens`, { method: 'POST', body: JSON.stringify({ origem }) });
}

/**
 * POST compras/pedidos/:id/gerar-nf — RECEBIMENTO: gera a NF de entrada (rascunho) a partir do pedido
 * (exige pedido FECHADO e ainda não recebido). Opções (modelo/série/CFOP) têm defaults no servidor. O
 * FATO (estoque/A Pagar) é o F3/F4 que o operador roda na tela da NF. Retorna o código da NF gerada.
 */
export function gerarNfDoPedido(
  id: number,
  opts?: { modelo?: number; serie?: string; cfop?: string },
): Promise<{ codnf: number; codpedcomp: number }> {
  return req(`/compras/pedidos/${id}/gerar-nf`, { method: 'POST', body: JSON.stringify(opts ?? {}) });
}

/**
 * POST compras/recebimento/importar-xml — RECEBIMENTO corte-2: importa o XML da NFe do fornecedor e cria a
 * NF de entrada VALORADA (valores fiscais reais do XML). `codpedcomp` opcional vincula ao pedido. Retorna o
 * código da NF + a reconciliação (totalnf vs vNF do XML). Itens sem produto casado → 422 (lista de pendências).
 */
export function importarXmlNfe(
  xml: string,
  codpedcomp?: number,
): Promise<{ codnf: number; chave: string; codparceiro: number; codpedcomp: number | null; itens: number; totalnf: number; totalXml: number; divergencia: boolean; titulosApagar: number }> {
  return req(`/compras/recebimento/importar-xml`, {
    method: 'POST',
    body: JSON.stringify({ xml, ...(codpedcomp != null ? { codpedcomp } : {}) }),
  });
}

/** um vínculo de-para: liga o código do fornecedor (cEAN/cProd) ao nosso produto. */
export interface VinculoProduto {
  idproduto: number;
  cEAN?: string;
  cProd?: string;
  fator?: number;
}

/**
 * POST compras/recebimento/vincular-produto — DE-PARA (corte-3): grava o vínculo código-do-fornecedor→produto
 * (por `codfor`), resolvendo as pendências do import. Depois basta reimportar o mesmo XML: o match casa sozinho.
 */
export function vincularProdutos(codfor: number, vinculos: VinculoProduto[]): Promise<{ codfor: number; gravados: number }> {
  return req(`/compras/recebimento/vincular-produto`, { method: 'POST', body: JSON.stringify({ codfor, vinculos }) });
}
