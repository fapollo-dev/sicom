/**
 * INTEGRAÇÃO CONTÁBIL (`FRMTRON`) — fetcher das três famílias de origem que os cortes 1-3 entregaram.
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

const P = '/contabil/integracao';
export interface Periodo { dataIni: string; dataFim: string; codigo?: number | null; idlote?: number | null }

/** o que cada rodada devolve; os campos variam por origem e a tela mostra o que veio. */
export interface Resultado {
  lotes?: number; cartoes?: number; baixas?: number; documentos?: number; lancamentos?: number;
  total?: number; linhas?: number;
}

export const cartaoPendentes = (p: Periodo): Promise<Array<{ idlote: number; cartoes: number; total_liquido: number }>> =>
  req(`${P}/cartao/pendentes?dataIni=${p.dataIni}&dataFim=${p.dataFim}${p.idlote ? `&idlote=${p.idlote}` : ''}`);

export const integrarCartao = (p: Periodo): Promise<Resultado> =>
  req(`${P}/cartao`, { method: 'POST', body: JSON.stringify(p) });
export const estornarCartao = (p: Periodo): Promise<Resultado> =>
  req(`${P}/cartao/estornar`, { method: 'POST', body: JSON.stringify(p) });

export const integrarBaixa = (lado: 'ap' | 'ar', p: Periodo): Promise<Resultado> =>
  req(`${P}/baixa/${lado}`, { method: 'POST', body: JSON.stringify(p) });
export const estornarBaixa = (lado: 'ap' | 'ar', p: Periodo): Promise<Resultado> =>
  req(`${P}/baixa/${lado}/estornar`, { method: 'POST', body: JSON.stringify(p) });

export type TipoDoc = 'cp' | 'cr' | 'transf' | 'adto' | 'caixa' | 'convenio';
export const integrarDocumento = (tipo: TipoDoc, p: Periodo): Promise<Resultado> =>
  req(`${P}/documento/${tipo}`, { method: 'POST', body: JSON.stringify(p) });
export const estornarDocumento = (tipo: TipoDoc, p: Periodo): Promise<Resultado> =>
  req(`${P}/documento/${tipo}/estornar`, { method: 'POST', body: JSON.stringify(p) });
