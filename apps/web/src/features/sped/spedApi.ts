import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: (body as { message?: string })?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as T;
}

/** uma pendência do pré-validador (TFrmPendenciasSPED) */
export interface PendenciaSped {
  tipo: string;
  descricao: string;
  codigo: string;
  descricao_registro: string;
  complemento?: string | null;
  abrir: { cadastro: 'cfop' | 'produto' | 'nf' | 'operadora' | 'parceiro'; id: number; tipo_nf?: 'E' | 'S' };
}

export const analisarPendenciasSped = (tipo: 'fiscal' | 'piscofins', dtini: string, dtfim: string) =>
  req<{ pendencias: PendenciaSped[] }>('/fiscal/sped/pendencias', { method: 'POST', body: JSON.stringify({ tipo, dtini, dtfim }) });

export const ncmProdutosInvalidos = () => req<{ pendencias: PendenciaSped[] }>('/cadastro/produtos/ncm/invalidos');

export interface ArquivoSped {
  arquivo: string;
  nomeArquivo: string;
  linhas: number;
  documentos: number;
  parcial: boolean;
  aviso: string;
  validacao: { ok: boolean; erros: string[]; registros: number };
}
export interface OpcaoInventarioSped { data: string; motivo: number; correcao: boolean }
export interface OpcoesSpedFiscalTela {
  inventario?: OpcaoInventarioSped; c113c114?: boolean; finalidade?: 0 | 1; codigoProduto?: 'ean' | 'plu';
  entradas?: boolean; saidas?: boolean; somarIcmsStOutras?: boolean; somarFcpStOutras?: boolean; somarIpiOutras?: boolean;
  zerado5929C170?: boolean; zerado5929Documento?: boolean; cst49?: boolean; c170Proprias?: boolean; gerarIcmsSt?: boolean; destacarIpiStItem?: boolean;
  c140?: boolean; c140TodosModelos?: boolean; c191?: boolean;
}
export const gerarSpedFiscal = (dtini: string, dtfim: string, opcoes: OpcoesSpedFiscalTela = {}) =>
  req<ArquivoSped>('/fiscal/sped/efd-icms-ipi', { method: 'POST', body: JSON.stringify({ dtini, dtfim, ...opcoes }) });

export interface ContaPc { codplanocontas: number; codireduzido: string | null; descricao: string | null; codiexpandido: string | null }
export type ContasPc = Record<'m400' | 'm410' | 'm800' | 'm810', ContaPc | null>;
export const lerContasPc = () => req<ContasPc>('/fiscal/sped/contas-pc');
export const gravarContasPc = (dto: Partial<Record<'m400' | 'm410' | 'm800' | 'm810', number | null>>) =>
  req<ContasPc>('/fiscal/sped/contas-pc', { method: 'PUT', body: JSON.stringify(dto) });
export const gerarSpedContribuicoes = (dtini: string, dtfim: string) =>
  req<ArquivoSped>('/fiscal/sped/efd-contribuicoes', { method: 'POST', body: JSON.stringify({ dtini, dtfim, exigirApuracao: true }) });
