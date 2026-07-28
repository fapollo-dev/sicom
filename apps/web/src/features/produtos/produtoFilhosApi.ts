/**
 * Fetcher READ-ONLY dos Produtos Filhos (aba TsFilhos) — variações filhas de um produto
 * (GET /cadastro/produtos/:id/filhos). Só leitura (o grid do legado é ReadOnly). apiHeaders/401.
 */
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface ProdutoFilho {
  idproduto: number;
  codbarra: string | null;
  descricao: string | null;
  unidade: string | null;
  fator_filho: number | string | null;
  ativo: string | null;
}

export async function getProdutosFilhos(idproduto: number): Promise<ProdutoFilho[]> {
  const res = await fetch(`${BASE}/cadastro/produtos/${idproduto}/filhos`, { headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body });
  }
  return (await res.json()) as ProdutoFilho[];
}
