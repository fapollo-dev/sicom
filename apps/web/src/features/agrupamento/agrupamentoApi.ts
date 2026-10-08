/**
 * AGRUPAMENTO de contas a receber e a pagar (`uAgrupaContasAReceber`/`uAgrupaContasAPagar`; dossiê uAgrupaContas.md) — a busca
 * dos títulos para agrupar, o agrupar (com o convênio do mesmo CNPJ no A Receber), os membros, reverter, adicionar e remover.
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
  return (await res.json()) as T;
}

export type Lado = 'areceber' | 'apagar';
export interface TituloAgrupar { [k: string]: unknown; valor: number; codparceiro: number; razao?: string | null; dtvenc?: string | null; dtvenda?: string | null; duplicata?: string | null; juro?: number | null; idpgto?: number | null }
/** os títulos marcados na Pesquisa do agrupamento (de qualquer loja do operador), em lotes de 300 códigos na URL */
export const titulosParaAgrupar = async (lado: Lado, codigos: number[]): Promise<TituloAgrupar[]> => {
  const out: TituloAgrupar[] = [];
  for (let i = 0; i < codigos.length; i += 300) {
    const qs = new URLSearchParams({ paraAgrupar: 'S', orderBy: 'dtvenc', codigos: codigos.slice(i, i + 300).join(',') });
    out.push(...(await req<TituloAgrupar[]>(`/cadastro/${lado}?${qs}`)));
  }
  return out;
};
export interface ConvenioSugestao { codplc: number | null; idpgto: number | null; data: string; obs: string }
export const agruparReceber = (body: {
  codrcbs: number[]; codparceiro?: number; idpgto?: number; dtvenda?: string; dtvenc?: string; obs?: string; desconto?: number; jurosDe?: number[];
  cobrarTaxaAdm?: boolean; convenio?: { codplc?: number; idpgto?: number; data?: string; obs?: string };
}) => req<{ codgrupo: number; consolidado: number | null; membros: number; total: number; convenio?: { codapg: number; codcx: number } }>(
  '/cadastro/areceber/agrupar', { method: 'POST', body: JSON.stringify(body) });
export const agruparPagar = (body: { codapgs: number[]; codparceiro?: number; dtvenc?: string; obs?: string; codplc?: number; parcelas?: Array<{ valor: number; dtvenc: string }> }) =>
  req<{ codgrupo: number; consolidado: number; parcelas?: number[]; membros: number; total: number }>('/cadastro/apagar/agrupar', { method: 'POST', body: JSON.stringify(body) });
export const membrosAgrupamento = (lado: Lado, id: number) => req<Array<Record<string, unknown>>>(`/cadastro/${lado}/${id}/membros-agrupamento`);
export const reverterAgrupamento = (lado: Lado, id: number) => req<{ revertido: true; membros: number }>(`/cadastro/${lado}/${id}/reverter-agrupamento`, { method: 'POST' });
export const adicionarAoAgrupamento = (id: number, codrcbs: number[]) =>
  req<Record<string, unknown>>(`/cadastro/areceber/${id}/adicionar-ao-agrupamento`, { method: 'POST', body: JSON.stringify({ codrcbs }) });
export const removerDoAgrupamento = (id: number, membro: number) => req<Record<string, unknown>>(`/cadastro/areceber/${id}/remover-do-agrupamento/${membro}`, { method: 'POST' });
