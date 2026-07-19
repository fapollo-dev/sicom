/**
 * Fetcher da COTAÇÃO DE COMPRA (RFQ, uCadCotacao). Serviço vertical `compras/cotacao`: CRUD (árvore
 * produtos×fornecedores) + lançar preços (matriz) + apuração/gerar-pedido + fechar/reabrir. Headers/envelope
 * no padrão dos demais (apiHeaders/handle401).
 */
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

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

export interface CotacaoLista {
  codctc: number;
  descricao: string | null;
  situacao: string; // 'A' aberta / 'F' fechada
  data: string | null;
  pedidos: string | null;
  qtde_produtos?: number;
  qtde_fornecedores?: number;
}
export interface CotacaoProd {
  codcpr: number;
  idproduto: number;
  descricao: string | null;
  quantidade: number;
  fatorembalagem: number;
}
export interface CotacaoForn {
  codctcforn: number;
  codparceiro: number;
  participa_apuracao: string | null;
  obs: string | null;
}
export interface CotacaoPreco {
  codctcforn: number;
  codcpr: number;
  valor: number;
  icms: number;
  ganhador: string; // 'A' vencedor / 'I' indefinido
  definido: string; // 'S' escolha manual
}
export interface CotacaoDetalhe extends CotacaoLista {
  produtos: CotacaoProd[];
  fornecedores: CotacaoForn[];
  precos: CotacaoPreco[];
}

export interface NovaCotacao {
  descricao?: string;
  produtos: Array<{ idproduto: number; quantidade: number }>;
  fornecedores: Array<{ codparceiro: number; participa_apuracao?: 'S' | 'N' }>;
}

export const listarCotacoes = (): Promise<CotacaoLista[]> => req('/compras/cotacao', { method: 'GET' });
export const obterCotacao = (id: number): Promise<CotacaoDetalhe> => req(`/compras/cotacao/${id}`, { method: 'GET' });
export const criarCotacao = (body: NovaCotacao): Promise<{ codctc: number }> => req('/compras/cotacao', { method: 'POST', body: JSON.stringify(body) });
export const excluirCotacao = (id: number): Promise<{ codctc: number }> => req(`/compras/cotacao/${id}`, { method: 'DELETE' });

/** upsert dos preços de UM fornecedor (matriz fornecedor×produto). */
export const lancarPrecosCotacao = (id: number, body: { codparceiro: number; itens: Array<{ idproduto: number; valor: number; icms?: number }> }): Promise<{ codctc: number; codparceiro: number; itens: number }> =>
  req(`/compras/cotacao/${id}/lancar-precos`, { method: 'POST', body: JSON.stringify(body) });

/** apura o vencedor por produto (menor preço líq-ICMS entre os que participam). */
export const apurarCotacao = (id: number): Promise<{ codctc: number; produtos: number; vencedores: number }> => req(`/compras/cotacao/${id}/apurar`, { method: 'POST' });
/** define manualmente o vencedor de um produto (F5). */
export const definirGanhadorCotacao = (id: number, body: { idproduto: number; codparceiro: number }): Promise<unknown> => req(`/compras/cotacao/${id}/definir-ganhador`, { method: 'POST', body: JSON.stringify(body) });
/** gera os pedidos de compra da apuração (1 por fornecedor vencedor) + fecha. */
export const gerarPedidoCotacao = (id: number): Promise<{ codctc: number; pedidos: number[] }> => req(`/compras/cotacao/${id}/gerar-pedido`, { method: 'POST' });

export const fecharCotacao = (id: number): Promise<{ codctc: number; situacao: 'F' }> => req(`/compras/cotacao/${id}/fechar`, { method: 'POST' });
export const reabrirCotacao = (id: number): Promise<{ codctc: number; situacao: 'A' }> => req(`/compras/cotacao/${id}/reabrir`, { method: 'POST' });
