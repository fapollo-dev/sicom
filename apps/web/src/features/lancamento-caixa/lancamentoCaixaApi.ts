/**
 * LANÇAMENTO DE CAIXA (`FRMMOVCAIXA`, F06) — fetcher (`lancamento-caixa.service.ts`).
 */
import { isErroResposta, type ErroResposta, type LancamentoCaixaDto } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = '/cobranca/lancamento-caixa';

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

export interface LancamentoCaixa {
  codcx: number;
  data: string;
  valor: number | string;
  idlote: number | null;
  obs: string | null;
  idempresa: number;
  idsituacao_nf: number | null;
  situacao?: string | null;
  neutra: string | null;
  codparceiro: number | null;
  razao?: string | null;
  codplc: number | null;
  desccodplc?: string | null;
  plc?: string | null;
  codconta: number | null;
  titular?: string | null;
  nroconta?: string | null;
  origem: string | null;
  idorigem: number | null;
  contabilizado: string | null;
  operador?: string | null;
}

export const listarLancamentos = (f: { dataIni?: string; dataFim?: string; texto?: string }) =>
  req<LancamentoCaixa[]>(`${P}?${new URLSearchParams(Object.entries(f).filter(([, v]) => !!v) as Array<[string, string]>)}`);
export const criarLancamento = (b: LancamentoCaixaDto) => req<LancamentoCaixa>(P, { method: 'POST', body: JSON.stringify(b) });
export const atualizarLancamento = (codcx: number, b: LancamentoCaixaDto) => req<LancamentoCaixa>(`${P}/${codcx}`, { method: 'PUT', body: JSON.stringify(b) });
export const excluirLancamento = (codcx: number) => req<void>(`${P}/${codcx}`, { method: 'DELETE' });
