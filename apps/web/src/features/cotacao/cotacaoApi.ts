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
  liberada?: string | null;
  empresas?: string | null;
  dtinicio_preenchimento?: string | null;
  dtfim_preenchimento?: string | null;
  qtde_produtos?: number;
  qtde_fornecedores?: number;
}
export interface CotacaoProd {
  codcpr: number;
  idproduto: number;
  descricao: string | null;
  quantidade: number;
  fatorembalagem: number;
  /** a grade por loja (sqqCotacaoProdQtde): a quantidade, o estoque da loja e o ativo para compra */
  qtdes?: Array<{ idempresa: number; qtde: number; estoque: number | null; ativo_compra: string | null }>;
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
  /** "Ult. Custo Rep." — o VRCUSTOREP do produto na última NF de entrada do fornecedor até a data da cotação */
  ultimo_custo_rep?: number | null;
}
export interface CotacaoDetalhe extends CotacaoLista {
  produtos: CotacaoProd[];
  fornecedores: CotacaoForn[];
  precos: CotacaoPreco[];
}

export interface CabecalhoCotacao {
  descricao?: string;
  data?: string;
  dtinicio_preenchimento?: string;
  dtfim_preenchimento?: string;
  liberada?: 'S' | 'N';
}
export interface NovaCotacao extends CabecalhoCotacao {
  empresas?: number[];
  produtos: Array<{ idproduto: number; quantidade: number }>;
  fornecedores: Array<{ codparceiro: number; participa_apuracao?: 'S' | 'N' }>;
}

export const listarCotacoes = (): Promise<CotacaoLista[]> => req('/compras/cotacao', { method: 'GET' });
export const obterCotacao = (id: number): Promise<CotacaoDetalhe> => req(`/compras/cotacao/${id}`, { method: 'GET' });
/** o cabeçalho da cotação aberta (PUT parcial: produtos e fornecedores ficam como estão) */
export const atualizarCabecalhoCotacao = (id: number, body: CabecalhoCotacao): Promise<{ codctc: number }> => req(`/compras/cotacao/${id}`, { method: 'PUT', body: JSON.stringify(body) });
/** as quantidades por loja de um produto da cotação aberta (a GrdQuantidades) */
export const quantidadesCotacao = (id: number, body: { idproduto: number; qtdes: Array<{ idempresa: number; qtde: number }> }): Promise<{ codctc: number; total: number }> =>
  req(`/compras/cotacao/${id}/quantidades`, { method: 'POST', body: JSON.stringify(body) });
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
