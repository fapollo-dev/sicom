/** Fetcher do relatório DRE (leitura/agregação). Envia os headers de tenant; devolve as linhas calculadas. */
import { isErroResposta, type ErroResposta } from '@apollo/shared';

import { apiHeaders, handle401 } from '../../shared/auth/session';
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface LinhaDre {
  codestrutura: number;
  codexpandido: string;
  descricao: string;
  tipo_calculo: string; // P/F/E
  classe: string; // A/S
  nivel: number;
  codpai: number | null;
  valor: number;
}

export async function calcularDre(dataInicio?: string, dataFim?: string): Promise<{ dataInicio: string; dataFim: string; linhas: LinhaDre[] }> {
  const qs = new URLSearchParams();
  if (dataInicio) qs.set('dataInicio', dataInicio);
  if (dataFim) qs.set('dataFim', dataFim);
  const res = await fetch(`${BASE}/cadastro/dre${qs.toString() ? `?${qs}` : ''}`, { headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as { dataInicio: string; dataFim: string; linhas: LinhaDre[] };
}
