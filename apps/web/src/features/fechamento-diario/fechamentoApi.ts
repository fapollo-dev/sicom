/**
 * FECHAMENTO DIÁRIO (`FRMFECHAMENTODIARIO`) — fetcher. Espelha os demais (apiHeaders/BASE + envelope ADR-015).
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

export interface DiaFechamento {
  data: string;
  status: string | null;
  fechado: boolean;
  codfechamento: number | null;
  nfs_pendentes: number;
}
export interface MesFechamento { ano: number; mes: number; dias: DiaFechamento[] }
/** o que o `VerificaNFs` fez: quantas notas mudaram de data contábil, para onde, e quantas ficaram sem destino. */
export interface ResultadoFechar { data: string; fechado: boolean; movidas: number; para: string | null; sem_destino: number }

const BASE_PATH = '/cadastro/fechamento-diario';

export const listarMes = (ano: number, mes: number): Promise<MesFechamento> =>
  req(`${BASE_PATH}?ano=${ano}&mes=${mes}`);

export const fecharDia = (data: string): Promise<ResultadoFechar> =>
  req(`${BASE_PATH}/fechar-dia`, { method: 'POST', body: JSON.stringify({ data }) });

export const abrirDia = (data: string): Promise<{ data: string; fechado: boolean }> =>
  req(`${BASE_PATH}/abrir-dia`, { method: 'POST', body: JSON.stringify({ data }) });

export const mesInteiro = (ano: number, mes: number, fechar: boolean): Promise<{ ano: number; mes: number; dias: number }> =>
  req(`${BASE_PATH}/mes`, { method: 'POST', body: JSON.stringify({ ano, mes, fechar }) });
