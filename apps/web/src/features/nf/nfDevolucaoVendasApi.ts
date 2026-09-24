/**
 * NF DE ENTRADA DE DEVOLUÇÃO DE VENDAS (uNF.pas:5900-6140; `nf-devolucao-vendas.service.ts`): a pesquisa das devoluções
 * (`GET_DEVOLUCAO_VENDAS`), a prévia dos itens e o vínculo no gravar.
 */
import { isErroResposta, type ErroResposta, type NfItemDto, type NfReferenciaDto } from '@apollo/shared';
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
  return (await res.json()) as T;
}

export interface DevolucaoDisponivel {
  codvendas: number;
  nropedido: string;
  nrocupom: number;
  codproduto: number;
  produto: string | null;
  cliente: string | null;
  dtvenda: string | null;
  datadevolucao: string | null;
  codparceiro: number | null;
  importado: 'S' | 'N';
  nfe_enviada: 'S' | 'N';
  qtde_devolvido: number | string;
  total_item_devolvido: number | string;
  venda_nfc: 'S' | 'N';
}
export interface ItemDevolucao { codvendas: number; codproduto: number }
export interface PreviaDevolucaoVendasNf {
  tipo: 'E';
  cfop: string;
  codparceiro: number | null;
  codparceiro_end: number | null;
  semParceiro: boolean;
  reimportados: number[];
  referencias: NfReferenciaDto[];
  obs: string;
  itensSelecionados: Array<ItemDevolucao & { nrocupom: number }>;
  itens: NfItemDto[];
}
export interface CredenciaisDevolucao { login?: string; senha?: string }

export const listarDevolucoesDisponiveis = (f: { data_ini: string; data_fim: string; nrocupom?: string }) =>
  req<DevolucaoDisponivel[]>(`/fiscal/nf/devolucao-vendas/disponiveis?${new URLSearchParams({ data_ini: f.data_ini, data_fim: f.data_fim, ...(f.nrocupom ? { nrocupom: f.nrocupom } : {}) })}`);
export const previaDevolucaoVendasNf = (body: { itens: ItemDevolucao[] } & CredenciaisDevolucao) =>
  req<PreviaDevolucaoVendasNf>('/fiscal/nf/devolucao-vendas/previa', { method: 'POST', body: JSON.stringify(body) });
export const vincularDevolucaoVendasNf = (codnf: number, body: { itens: ItemDevolucao[] } & CredenciaisDevolucao) =>
  req<{ codnf: number; cupons: number[] }>(`/fiscal/nf/${codnf}/devolucao-vendas`, { method: 'POST', body: JSON.stringify(body) });
