/**
 * FECHAMENTO DE CAIXA (`FRMFECHAMENTOCAIXA`) — fetcher: turnos do dia, conferência do turno, documentos e rascunho
 * (corte 1), efetivar (corte 2) e reabrir (corte 3). Espelha os demais (apiHeaders/BASE + envelope ADR-015).
 */
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = '/cobranca/fechamento-caixa';

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

export interface TurnoResumo {
  nropdv: number;
  nome: string | null;
  codoperadora: number;
  chave: string | null;
  horaentrada: string | null;
  horaDaChave: boolean;
  horasaida: string | null;
  situacao: 1 | 2 | 3;
  fechadoNoPdv: boolean;
}
export interface TurnoRef { data: string; chave: string | null; nropdv: number; codoperadora: number; situacao?: number }

export type TipoConferencia = 'CARTAO' | 'RCB' | 'CHQ' | 'TICKET' | 'DEV' | 'DINHEIRO' | null;
export interface LinhaFechamento {
  operacao: string;
  valorb: number;
  troco: number;
  venda_balcao: number;
  valor: number;
  real: number | null;
  saldo: number;
  destino: string | null;
  tipo: TipoConferencia;
  linhaDinheiro: boolean;
  documentos: number[];
}
export type Fixa = 'SANGRIA EM DINHEIRO' | 'SANGRIA EM CHEQUE' | 'OUTRAS SANGRIAS' | 'SUPRIMENTO';
export interface DetalheTurno {
  turno: { data: string; chave: string | null; nropdv: number; codoperadora: number; nome: string | null; situacao: number };
  modo: 'fechamento' | 'consulta';
  linhas: LinhaFechamento[];
  fixas: Record<Fixa, number>;
  dinheiroContado: number;
  contadoHabilitado: boolean;
  limiteSaldo: number;
  adicionais: { recarga: number; correspondente: number; voucher: number; trocoSolidario: number };
  cancelamentos: number;
  descontos: number;
  totais: { valor: number; real: number; saldo: number; fechamento: number; devolucaoDinheiro: number; diferenca: number };
  completadas?: number;
  sangriasInseridas?: number;
  ticketsCriados?: number;
  efetivado?: {
    codgrupo: number; caixa: number; mcb: number; idsaldoop: number | null; codrcb: number | null; marcas: number; diferenca: number; gerarSaldo: boolean;
    /** a contabilização (corte 3) — nula sem integração automática; os avisos são o que ficou pendente para o TRON */
    contabil: { lancamentos: number; avisos: Array<{ documento: string; codigo: string; mensagem: string }> } | null;
  };
  reaberto?: { codgrupo: number; estorno: number; titulos: number; quebras: number; caixa: number; mcb: number; modo: 'E' | 'D' };
}
export interface DocumentoConferencia { codigo: number; valor: number; sel: boolean; [k: string]: unknown }
export interface Documentos {
  operacao: string;
  tipo: TipoConferencia | 'SANGRIA';
  modo: 'fechamento' | 'consulta';
  marcacaoLivre: boolean;
  documentos: DocumentoConferencia[];
  conferido: number;
}

const qs = (t: TurnoRef, extra: Record<string, string> = {}) =>
  new URLSearchParams({
    data: t.data, chave: t.chave ?? '', nropdv: String(t.nropdv), codoperadora: String(t.codoperadora),
    ...(t.situacao ? { situacao: String(t.situacao) } : {}), ...extra,
  }).toString();

export const listarTurnos = (data: string) => req<TurnoResumo[]>(`${P}/turnos?data=${data}`);
export const detalheTurno = (t: TurnoRef) => req<DetalheTurno>(`${P}/turno?${qs(t)}`);
export const abrirTurno = (t: TurnoRef) => req<DetalheTurno>(`${P}/turno/abrir`, { method: 'POST', body: JSON.stringify(t) });
export const documentosTurno = (t: TurnoRef, operacao: string) => req<Documentos>(`${P}/turno/documentos?${qs(t, { operacao })}`);
export const salvarRascunho = (t: TurnoRef, body: { dinheiroContado: number; documentos: Array<{ operacao: string; codigos: number[] }> }) =>
  req<DetalheTurno>(`${P}/turno/rascunho`, { method: 'PUT', body: JSON.stringify({ ...t, ...body }) });
export const reabrirTurno = (t: TurnoRef) => req<DetalheTurno>(`${P}/turno/reabrir`, { method: 'POST', body: JSON.stringify(t) });
export const efetivarTurno = (t: TurnoRef, body: { dinheiroContado: number; documentos: Array<{ operacao: string; codigos: number[] }>; gerarSaldo?: boolean; confirmarDocumentosNaoSelecionados?: boolean }) =>
  req<DetalheTurno>(`${P}/turno/efetivar`, { method: 'POST', body: JSON.stringify({ ...t, ...body }) });
