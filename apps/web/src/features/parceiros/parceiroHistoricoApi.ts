/**
 * Fetcher READ-ONLY do Histórico Financeiro do parceiro (aba tsSaldoParceiros). Extrato UNION de
 * CONTAS A RECEBER (+) e A PAGAR (−) servido por GET /cadastro/parceiros/:cod/historico-financeiro.
 * Sem escrita — só leitura (o legado é um grid ReadOnly). Reusa apiHeaders/handle401 (tenant + 401).
 */
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export type StatusHist = 'abertos' | 'liquidados' | 'todos';

export interface HistLinha {
  tipo: string;
  dtvenda_compra: string | null;
  dtvenc: string | null;
  nrocupom: string | null;
  valor: number;
  saldo: number;
  txjuros: number;
  valor_com_juro: number;
  saldo_com_juro: number;
  duplicata: string | null;
  datapgto: string | null;
  agrupamento: number | null;
  devolvido: string | null;
}
export interface HistResumo {
  receber: number;
  pagar: number;
  receber_com_juros: number;
  credito: number;
  restante: number;
}
export interface HistoricoFinanceiro {
  status: StatusHist;
  juros_modo: string;
  linhas: HistLinha[];
  resumo: HistResumo;
}

export async function getHistoricoFinanceiro(
  cod: number,
  status: StatusHist,
): Promise<HistoricoFinanceiro> {
  const res = await fetch(
    `${BASE}/cadastro/parceiros/${cod}/historico-financeiro?status=${status}`,
    { headers: apiHeaders() },
  );
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body });
  }
  return (await res.json()) as HistoricoFinanceiro;
}
