/**
 * BAIXA DE CONTAS A PAGAR (`FRMBAIXAAPAGAR`; `uBaixaApagar-spec.md`) — o lote do legado: iniciar (aloca o lote), a pesquisa
 * de títulos, as contas do operador, os padrões da empresa, gravar e a carga da manutenção de um lote.
 */
import { isErroResposta, type BaixaApagarGravarDto, type ErroResposta } from '@apollo/shared';
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

export interface TituloBaixa {
  codapg: number; nr_documento: string | null; nrparcela?: string | null; fornecedor: string | null; codparceiro: number | null; codempresa: number;
  valor: number; vendor: number; desconto: number; txjuros: number; base: number; acre_desc: number;
  emissao: string | null; vencimento: string | null; tipodoc?: string | null; bloqueio?: string; fornecedor_possui_debito?: string; calcula_juro?: boolean;
}
export interface ContaBaixa { codconta: number; nroconta: string | null; titular: string | null; codbco: number | null; idempresa: number; caixa: boolean; cbo_baixa_cp: string }
export interface TipoRecurso { tipo: number; rotulo: string; liberado: 'S' | 'N'; contaCaixa: boolean }
export interface PadroesBaixa { ccJuros: number | null; ccAcrescimo: number | null; ccDesconto: number | null; diasFutura: number; permiteRetroativa: boolean; recursos: TipoRecurso[]; empresas: number[] }
export interface FiltroTitulos { busca?: string; codparceiro?: string; vencDe?: string; vencAte?: string; empresas?: number[] }

export const iniciarBaixa = () => req<{ idlote: number }>('/cobranca/baixa-apagar/iniciar', { method: 'POST' });
export const padroesBaixa = () => req<PadroesBaixa>('/cobranca/baixa-apagar/padroes');
export const contasBaixa = () => req<ContaBaixa[]>('/cobranca/baixa-apagar/contas');
export const titulosBaixa = (f: FiltroTitulos) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
  return req<TituloBaixa[]>(`/cobranca/baixa-apagar/titulos?${qs}`);
};
export const manutencaoBaixa = (lote: number) => req<{ loteAntigo: number; dtpgto: string; documentos: TituloBaixa[] }>(`/cobranca/baixa-apagar/manutencao/${lote}`);
export const gravarBaixa = (body: BaixaApagarGravarDto) =>
  req<{ idlote: number; documentos: number; valorPago: number; parcial: boolean; codapgSaldo: number | null; contabilizado: boolean }>(
    '/cobranca/baixa-apagar/gravar', { method: 'POST', body: JSON.stringify(body) });
