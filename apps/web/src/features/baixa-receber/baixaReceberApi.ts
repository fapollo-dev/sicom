/**
 * BAIXA DE CONTAS A RECEBER (`FRMBAIXAARECEBER`; `uBaixaAreceber-spec.md`) — iniciar (lote), pesquisa de títulos, contas e
 * formas de cartão do operador, padrões, gravar e a carga da manutenção.
 */
import { isErroResposta, type BaixaReceberGravarDto, type ErroResposta } from '@apollo/shared';
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

export interface TituloReceber {
  codrcb: number; duplicata: string | null; cliente: string | null; codparceiro: number | null; codempresa: number; valor: number; txjuros: number;
  emissao: string | null; vencimento: string | null; nroped?: string | null; desconto_cliente: number; vencido?: boolean; acre_desc?: number; calcula_juro?: boolean;
}
export interface ContaReceber { codconta: number; nroconta: string | null; titular: string | null; codbco: number | null; caixa: boolean; cbo_baixa_cr: string; conta_propria: string }
export interface FormaCartao { idpgto: number; modalidade: string; destino: string }
export interface TipoRecursoReceber { tipo: number; rotulo: string; liberado: 'S' | 'N'; caixa: boolean; banco: boolean }
export interface PadroesReceber { ccJuros: number | null; ccAcrescimo: number | null; ccDesconto: number | null; diasFutura: number; mostrarTroco: boolean; recursos: TipoRecursoReceber[]; empresas: number[] }
export interface FiltroReceber { busca?: string; codparceiro?: string; vencDe?: string; vencAte?: string; empresas?: number[]; dtpgto?: string }

export const iniciarBaixaReceber = () => req<{ idlote: number }>('/cobranca/baixa-receber/iniciar', { method: 'POST' });
export const padroesBaixaReceber = () => req<PadroesReceber>('/cobranca/baixa-receber/padroes');
export const contasBaixaReceber = () => req<{ contas: ContaReceber[]; formasCartao: FormaCartao[] }>('/cobranca/baixa-receber/contas');
export const titulosBaixaReceber = (f: FiltroReceber) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
  return req<TituloReceber[]>(`/cobranca/baixa-receber/titulos?${qs}`);
};
export const manutencaoBaixaReceber = (lote: number) => req<{ loteAntigo: number; dtpgto: string; documentos: TituloReceber[] }>(`/cobranca/baixa-receber/manutencao/${lote}`);
export const gravarBaixaReceber = (body: BaixaReceberGravarDto) =>
  req<{ idlote: number; documentos: number; valorPago: number; parcial: boolean; codrcbSaldo: number | null; contabilizado: boolean }>(
    '/cobranca/baixa-receber/gravar', { method: 'POST', body: JSON.stringify(body) });
