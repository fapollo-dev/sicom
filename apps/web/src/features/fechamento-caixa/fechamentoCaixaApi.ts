/**
 * FECHAMENTO DE CAIXA (`FRMFECHAMENTOCAIXA`) — fetcher: turnos do dia, conferência do turno, documentos e rascunho
 * (corte 1), efetivar (corte 2), reabrir (corte 3) e editar/inserir/excluir documento (corte 4). Espelha os demais (apiHeaders/BASE + envelope ADR-015).
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
  /** OBRIGA_FECHAR_CAIXA_PDV e o turno ainda aberto no PDV: consulta a conferência, mas não efetiva */
  pdvNaoFechado?: boolean;
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
  /** o que o diálogo deixa editar (corte 4): tudo, só a operadora do cartão (turno fechado no PDV) ou nada */
  edicao?: 'completa' | 'operadora' | null;
  /** inserir (A Receber, cartão) e excluir (e ticket); a exclusão pede o login de um liberador quando há liberadores */
  insercao?: boolean;
  exclusao?: boolean;
  liberacaoExclusao?: boolean;
  /** sangria/suprimento: inserir pede sempre o login de quem libera; a sangria em dinheiro escolhe a forma */
  liberacaoInsercao?: boolean;
  formasSangria?: Array<{ idpgto: number; modalidade: string }>;
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
export interface CamposDocumento {
  valor?: number; codoperadora?: number; nsu?: string; nsuhost?: string; autorizacao?: string; codrede?: number; nroparcela?: number;
  obs?: string; dtvenc?: string; codparceiro?: number; nrocupom?: string; nropedido?: string; idpgto?: number; descricao?: string;
}
export const editarDocumento = (t: TurnoRef, operacao: string, codigo: number, campos: CamposDocumento) =>
  req<{ tipo: 'CARTAO' | 'RCB'; codigo: number; alterados: string[]; soOperadora: boolean }>(`${P}/turno/documentos`, {
    method: 'PUT', body: JSON.stringify({ ...t, operacao, codigo, campos }),
  });
export const inserirDocumento = (t: TurnoRef, operacao: string, campos: CamposDocumento, liberacao?: { login: string; senha: string }) =>
  req<{ tipo: 'CARTAO' | 'RCB' | 'SANGRIA'; codigo: number }>(`${P}/turno/documentos`, { method: 'POST', body: JSON.stringify({ ...t, operacao, campos, ...liberacao }) });
export const excluirDocumento = (t: TurnoRef, operacao: string, codigo: number, liberacao?: { login: string; senha: string }) =>
  req<{ codigo: number; excluido: boolean }>(`${P}/turno/documentos/excluir`, { method: 'POST', body: JSON.stringify({ ...t, operacao, codigo, ...liberacao }) });
export interface ComprovanteQuebra {
  data: string;
  quebras: Array<{ idsaldoop: number; nome: string; codpdv: number; dia: string; saldo: number; valor: number; texto: string }>;
}
export interface LinhaHistorico { codhist: number; data: string; historico: string; usuario: string }
export const comprovanteQuebra = (t: TurnoRef) => req<ComprovanteQuebra>(`${P}/turno/quebra?${qs(t)}`);
export const historicoTurno = (t: TurnoRef) => req<LinhaHistorico[]>(`${P}/turno/historico?${qs(t)}`);
export interface CancelamentosTurno {
  cupons: Array<{ nrocupom: string | null; pdv: string; nropedido: string; motivo: string | null; qtde: number; total: number; responsavel: string | null }>;
  itens: Array<{ nrocupom: string | null; nroitem: number; vrvenda: number; qtde: number; codproduto: number; codbarra: string | null; descricao: string | null; total: number; motivo: string | null; responsavel: string | null }>;
}
export interface DescontoTurno { nrocupom: string | null; codbarra: string | null; descricao: string | null; codproduto: number; desconto: number; responsavel: string | null; motivo: string | null }
export const cancelamentosTurno = (t: TurnoRef) => req<CancelamentosTurno>(`${P}/turno/cancelamentos?${qs(t)}`);
export const descontosTurno = (t: TurnoRef) => req<DescontoTurno[]>(`${P}/turno/descontos?${qs(t)}`);
export interface LinhaLancProv { codcxvendas: number; operacao: string; valor: number; sangrias: number; suprimentos: number; nropedido: string | null; provisorio: boolean; codfiscalcaixa: number | null }
export interface LancamentoProvisorio {
  cabecalho: { codfiscalcaixa: number | null; fiscal: string | null; gtinicial: number | null; gtfinal: number | null; vendab: number | null; vendal: number | null; cancelamentos: number | null; descontos: number | null } | null;
  linhas: LinhaLancProv[];
  total: number;
  formas: string[];
  confere: boolean;
}
export const lancamentoProvisorio = (t: TurnoRef) => req<LancamentoProvisorio>(`${P}/turno/lancamento-provisorio?${qs(t)}`);
export const gravarCabecalhoLancProv = (t: TurnoRef, cab: { codfiscalcaixa?: number; gtinicial?: number; gtfinal?: number; cancelamentos?: number; descontos?: number }) =>
  req<{ linhas: LinhaLancProv[]; total: number }>(`${P}/turno/lancamento-provisorio`, { method: 'PUT', body: JSON.stringify({ ...t, ...cab }) });
export const inserirLinhaLancProv = (t: TurnoRef, linha: { operacao: string; valor: number; codfiscalcaixa: number }) =>
  req<{ linhas: LinhaLancProv[]; total: number }>(`${P}/turno/lancamento-provisorio/linhas`, { method: 'POST', body: JSON.stringify({ ...t, ...linha }) });
export const excluirLinhaLancProv = (t: TurnoRef, codcxvendas: number) =>
  req<{ linhas: LinhaLancProv[]; total: number }>(`${P}/turno/lancamento-provisorio/linhas/excluir`, { method: 'POST', body: JSON.stringify({ ...t, codcxvendas }) });
