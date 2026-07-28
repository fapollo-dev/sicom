/**
 * Fetcher READ-ONLY da Posição de Estoque do produto (UPosicaoProduto) — saldo por empresa + Ficha de
 * movimentação (Kardex). GET /cadastro/produtos/:id/posicao-estoque. Só leitura. apiHeaders/401.
 */
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface EstoqueSaldo {
  idempresa: number;
  qtde: number | string | null;
  minimo: number | string | null;
  maximo: number | string | null;
  local: string | null;
}
export interface EstoqueMovimento {
  codmov: number | string; // bigint — o pg devolve como string no JSON

  idempresa: number;
  tipo: string;
  qtde: number | string;
  saldo_anterior: number | string;
  saldo_novo: number | string;
  origem: string | null;
  codnf: number | null;
  historico: string | null;
  codoperador: number | null;
  data: string | null;
}
export interface PosicaoEstoque {
  saldos: EstoqueSaldo[];
  total: number;
  movimentos: EstoqueMovimento[];
}

export async function getPosicaoEstoque(idproduto: number): Promise<PosicaoEstoque> {
  const res = await fetch(`${BASE}/cadastro/produtos/${idproduto}/posicao-estoque`, { headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body });
  }
  return (await res.json()) as PosicaoEstoque;
}
