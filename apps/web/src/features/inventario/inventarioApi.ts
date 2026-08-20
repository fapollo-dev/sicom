/**
 * Fetcher do INVENTÁRIO (contagem física). Agregado `cadastro/inventario` (livro + itens) + verticais
 * (importar-produtos / diferenças / aplicar). Headers/envelope no padrão dos demais (apiHeaders/handle401).
 */
import { isErroResposta, type ErroResposta, type InventarioDiferenca } from '@apollo/shared';
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

export interface InventarioLivro {
  codinvent: number;
  descricao: string | null;
  dtinventario: string | null;
  qtde_itens?: number;
}
export interface InventarioItem {
  sequencia?: number;
  idproduto: number;
  descricao?: string | null;
  unidade?: string | null;
  qtde: number; // CONTADO
  vrcusto?: number;
  vrvenda?: number;
}
export interface InventarioDetalhe extends InventarioLivro {
  itens: InventarioItem[];
}

/** GET cadastro/inventario — lista (view get_inventario_livro). */
export function listarInventarios(): Promise<InventarioLivro[]> {
  return req('/cadastro/inventario', { method: 'GET' });
}
/** GET cadastro/inventario/:id — livro + itens. */
export function obterInventario(id: number): Promise<InventarioDetalhe> {
  return req(`/cadastro/inventario/${id}`, { method: 'GET' });
}
/** POST cadastro/inventario — cria o livro (opcional já com itens). */
export function criarInventario(body: { descricao?: string; itens?: Array<{ idproduto: number; qtde: number }> }): Promise<InventarioDetalhe> {
  return req('/cadastro/inventario', { method: 'POST', body: JSON.stringify(body) });
}
/** PUT cadastro/inventario/:id — salva a contagem (header + itens com qtde). */
export function atualizarInventario(id: number, body: { descricao?: string; itens: Array<{ idproduto: number; qtde: number }> }): Promise<InventarioDetalhe> {
  return req(`/cadastro/inventario/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}
/** POST cadastro/inventario/:id/importar-produtos — popula a folha (contado = saldo de sistema). */
export function importarProdutosInventario(id: number, opts: { apenasAtivos?: boolean; apenasComSaldo?: boolean }): Promise<{ codinvent: number; itens: number }> {
  return req(`/cadastro/inventario/${id}/importar-produtos`, { method: 'POST', body: JSON.stringify(opts) });
}
/** GET cadastro/inventario/:id/diferencas — contado × saldo de sistema (calculada). */
export function diferencasInventario(id: number): Promise<{ codinvent: number; itens: InventarioDiferenca[] }> {
  return req(`/cadastro/inventario/${id}/diferencas`, { method: 'GET' });
}
/** POST cadastro/inventario/:id/aplicar — sobrescreve estoque = contado (senha ADM). */
export function aplicarInventario(id: number, senhaOperacao?: string): Promise<{ codinvent: number; aplicados: number }> {
  return req(`/cadastro/inventario/${id}/aplicar`, { method: 'POST', body: JSON.stringify({ senhaOperacao }) });
}

/** GET cadastro/balanco — o lookup das fotos de estoque (a view `GET_BALANCO` do legado, por empresa). */
export interface BalancoLinha { codbalanco: number; descricao: string | null; data: string; idempresa: number; itens: number }
export function listarBalancos(): Promise<{ itens: BalancoLinha[] }> {
  return req('/cadastro/balanco', { method: 'GET' });
}
/**
 * POST cadastro/inventario/:id/gerar-balanco — a contagem vira FOTO na data do livro. Com foto já lançada na
 * data o backend recusa sem `substituir` (é a pergunta do legado, default NO) e, ao substituir, só atualiza a
 * quantidade dos produtos que já estão na foto.
 */
export function gerarBalanco(id: number, body: { substituir?: boolean; descricao?: string }): Promise<{ codbalanco: number | null; modo: 'criado' | 'atualizado'; itens: number; balancos: number }> {
  return req(`/cadastro/inventario/${id}/gerar-balanco`, { method: 'POST', body: JSON.stringify(body) });
}
/**
 * POST cadastro/inventario/:id/importar-balanco — a foto entra como LISTA DE PRODUTOS e a quantidade vem do
 * ESTOQUE DE HOJE (estoque + depósito), não da foto. Apaga a folha atual (daí o `confirmar`).
 */
export function importarBalanco(id: number, body: { codbalanco: number; confirmar?: boolean }): Promise<{ codinvent: number; codbalanco: number; itens: number }> {
  return req(`/cadastro/inventario/${id}/importar-balanco`, { method: 'POST', body: JSON.stringify(body) });
}

/**
 * POST cadastro/inventario/:id/importar-balanco-sincronizar — "Importar Balanço e Atualizar Estoque": refaz a
 * folha somando o movimento do intervalo à foto. O sentido sai da comparação das datas (livro × foto) e datas
 * iguais devolvem folha vazia com `aviso` (é o que o legado faz).
 */
export function importarBalancoSincronizar(id: number, body: { codbalanco: number; confirmar?: boolean }): Promise<{ itens: number; sentido: 'frente' | 'tras' | 'nenhum'; dtini: string | null; dtfim: string | null; aviso?: string }> {
  return req(`/cadastro/inventario/${id}/importar-balanco-sincronizar`, { method: 'POST', body: JSON.stringify(body) });
}
/**
 * POST cadastro/inventario/:id/sincronizar — "Sincronizar Inventário (Entradas − Saídas)": recalcula as linhas
 * que já estão na folha (não cria linha); movimento negativo e produto sem movimento viram 0.
 */
export function sincronizarInventario(id: number, body: { dtinicial?: string }): Promise<{ atualizados: number; zerados: number; dtinicial: string; dtfinal: string; dtbalanco: string | null; aviso?: string }> {
  return req(`/cadastro/inventario/${id}/sincronizar`, { method: 'POST', body: JSON.stringify(body) });
}
