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
): Promise<{ codnf: number; chave: string; codparceiro: number; codpedcomp: number | null; itens: number; totalnf: number; totalXml: number; divergencia: boolean }> {
  return req(`/compras/recebimento/importar-xml`, {
    method: 'POST',
    body: JSON.stringify({ xml, ...(codpedcomp != null ? { codpedcomp } : {}) }),
  });
}
