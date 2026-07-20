/** Fetcher do LIVRO RAZÃO contábil (leitura do DIÁRIO por conta/período). Envia os headers de tenant. */
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface MovimentoRazao {
  coddiario: number;
  datalan: string;
  historico: string;
  documento: number | null;
  contrapartida: number;
  debito: number;
  credito: number;
  saldo: number;
}
export interface ContaRazao {
  codplanocontas: number;
  codiexpandido: string | null;
  descricao: string | null;
  classe: string | null;
  saldoAnterior: number;
  movimentos: MovimentoRazao[];
  totalDebito: number;
  totalCredito: number;
  saldoFinal: number;
}

export async function gerarRazao(
  dataInicio?: string,
  dataFim?: string,
  codconta?: string,
  semMovimento = false,
): Promise<{ dataInicio: string; dataFim: string; contas: ContaRazao[] }> {
  const qs = new URLSearchParams();
  if (dataInicio) qs.set('dataInicio', dataInicio);
  if (dataFim) qs.set('dataFim', dataFim);
  if (codconta) qs.set('codconta', codconta);
  if (semMovimento) qs.set('semMovimento', 'true');
  const res = await fetch(`${BASE}/cadastro/razao${qs.toString() ? `?${qs}` : ''}`, { headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as { dataInicio: string; dataFim: string; contas: ContaRazao[] };
}
