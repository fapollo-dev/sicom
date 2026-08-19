/**
 * Fetcher da CONSULTA DE HISTÓRICO DE VENDAS (FRMCONSHISTVENDAS): um cupom por vez — cabeçalho, itens,
 * rodapé (subtotal − cancelados) e os finalizadores lidos do caixa.
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

export interface ItemCupom {
  nroitem: number | null;
  codbarra: string | null;
  descricao: string | null;
  unidade: string | null;
  qtde: number;
  vrvenda: number;
  aliquota: string | null;
  total: number;
  total_item: number;
  total_canc: number;
  acrescimo: number;
  desconto: number;
  cancitem: string;
  canc: string;
}
export interface ConsultaCupom {
  encontrado: boolean;
  cupom_cancelado: boolean;
  cabecalho: {
    nropedido: string | null; nrocupom: number | null; idempresa: number; dtvenda: string | null;
    cliente: string | null; vendedor: string | null; operador: string | null;
    desc_acre: number | null; venda_nfc: string | null; permite_ticket: boolean;
  } | null;
  itens: ItemCupom[];
  totais: { qtd_itens: number; subtotal: number; cancelados: number; total: number };
  finalizadores: Array<{ operacao: string | null; valor: number }>;
  total_finalizadores: number;
}

export function consultarCupom(dto: Record<string, unknown>): Promise<ConsultaCupom> {
  return req('/relatorios/hist-vendas/consultar', { method: 'POST', body: JSON.stringify(dto) });
}
