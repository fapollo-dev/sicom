/**
 * Fetcher das abas da NF que olham o que se liga à nota (auditoria do uNF.dfm, 14/10/2026): as formas de pagamento (Financeiro),
 * os pedidos, as devoluções da compra, as cartas de correção, o "Ratear marcados" e a liberação do Total NF com a senha ADM.
 */
import { isErroResposta, type ErroResposta, type CriarNfDto, type NfFormaPagamentoDto, type TipoRateioNf } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function req<T>(path: string, init?: RequestInit, extra?: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...apiHeaders(), ...(extra ?? {}) } });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as T;
}

export type FormaPagamentoNf = {
  codnforpgto: number; idpgto: number | null; modalidade: string | null; destino: string | null; vrpgto: number | string | null; vrtroco: number | string | null;
  integrado: string | null; codoperadoras: number | null; operadora: string | null; numero_aut: string | null;
};
export type FormasPagamentoNf = {
  codnf: number; totalnf: number; totalPago: number; linhas: FormaPagamentoNf[];
  formas: Array<{ idpgto: number; modalidade: string; destino: string | null }>;
  operadoras: Array<{ codoperadoras: number; operadora: string }>;
};
export function formasPagamentoNf(codnf: number): Promise<FormasPagamentoNf> {
  return req(`/fiscal/nf/${codnf}/formas-pagamento`, { method: 'GET' });
}
export function adicionarFormaPagamentoNf(codnf: number, dto: NfFormaPagamentoDto): Promise<{ codnforpgto: number }> {
  return req(`/fiscal/nf/${codnf}/formas-pagamento`, { method: 'POST', body: JSON.stringify(dto) });
}
export function excluirFormaPagamentoNf(codnf: number, codnforpgto: number): Promise<{ codnforpgto: number }> {
  return req(`/fiscal/nf/${codnf}/formas-pagamento/${codnforpgto}`, { method: 'DELETE' });
}

export type PedidosNf = {
  codnf: number;
  compra: Array<{ codpedcomp: number; data: string; titular: string; obs: string | null; total_bruto: number | string; total_pedido: number | string }>;
  venda: Array<{ codpedido: number; nropedido: string | null; idempresa: number | null; total_pedido: number | string; desconto: number | string; total_bruto: number | string;
    dtvenda: string | null; vendedor: string | null; titular: string | null; obs: string | null }>;
};
export function pedidosDaNf(codnf: number): Promise<PedidosNf> {
  return req(`/fiscal/nf/${codnf}/pedidos`, { method: 'GET' });
}

export type DevolucoesCompraNf = { codnf: number; linhas: Array<{ cod_pedido_dev_compra: number; data_pedido: string; status: string; cod_nota_fiscal_emitida: number | null;
  nronf: string | null; chavenfe: string | null; dtemissao: string | null }> };
export function devolucoesCompraDaNf(codnf: number): Promise<DevolucoesCompraNf> {
  return req(`/fiscal/nf/${codnf}/devolucoes-compra`, { method: 'GET' });
}

export type CartasCorrecaoNf = { codnf: number; chavenfe: string | null; linhas: Array<{ codnfe_evento: number; seq_evento: number | null; protocolo_autorizacao: string | null;
  data_evento: string | null; data_autorizacao: string | null; mensagem_autorizacao: string | null; correcao: string | null }> };
export function cartasCorrecaoDaNf(codnf: number): Promise<CartasCorrecaoNf> {
  return req(`/fiscal/nf/${codnf}/cartas-correcao`, { method: 'GET' });
}

/** "Ratear marcados" (btnRateioSTClick): os tipos marcados sobre todos os itens, e o recálculo — puro, como o recalcular */
export function ratearNf(nf: CriarNfDto, tipos: TipoRateioNf[]): Promise<CriarNfDto> {
  return req(`/fiscal/nf/ratear`, { method: 'POST', body: JSON.stringify({ nf, tipos }) });
}

/** o botão ao lado do Total NF da importada (SpeedButton1Click): a senha ADM libera a edição */
export function liberarTotalNf(senhaAdm: string): Promise<{ liberado: boolean }> {
  return req(`/fiscal/nf/liberar-total`, { method: 'POST', body: '{}' }, { 'x-senha-administrativa': senhaAdm });
}
