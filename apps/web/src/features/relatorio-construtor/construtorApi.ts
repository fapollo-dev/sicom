/** CONSTRUTOR DE RELATÓRIOS (`FRMRELATORIO`) — fetcher do catálogo, das definições salvas e do executor. */
import { isErroResposta, type ErroResposta, type DefinicaoRelatorioDto } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = '/relatorios/construtor';

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

export interface RelatorioSalvo { codrelatoriodef: number; nome: string; fonte: string; rotulo: string | null; origem: string }
export interface CampoFonte { campo: string; tipo: string; formato: string }
export interface Condicao { campo: string; operador: string; valor?: unknown }
export interface Execucao {
  titulo: string; fonte: string; paisagem: boolean;
  colunas: Array<{ chave: string; titulo: string; formato: string; largura?: number }>;
  linhas: Array<Record<string, unknown>>;
  totais: Record<string, number>;
  truncado: boolean;
}

export interface Fonte { fonte: string; rotulo: string }
export interface RelatorioDetalhe { codrelatoriodef: number; nome: string; fonte: string; definicao: DefinicaoRelatorioDto }

export const listarRelatorios = (): Promise<RelatorioSalvo[]> => req(P);
export const listarFontes = (): Promise<Fonte[]> => req(`${P}/fontes`);
export const obterRelatorio = (cod: number): Promise<RelatorioDetalhe> => req(`${P}/${cod}`);
export const salvarRelatorio = (body: { codrelatoriodef?: number | null; nome: string; fonte: string; definicao: DefinicaoRelatorioDto }): Promise<{ codrelatoriodef: number }> =>
  req(P, { method: 'POST', body: JSON.stringify(body) });
export const removerRelatorio = (cod: number): Promise<void> => req(`${P}/${cod}`, { method: 'DELETE' });
export const camposDaFonte = (fonte: string): Promise<CampoFonte[]> => req(`${P}/campos/lista?fonte=${encodeURIComponent(fonte)}`);
export const executar = (body: { codrelatoriodef?: number; definicao?: DefinicaoRelatorioDto; fonte?: string; filtros?: Condicao[] }): Promise<Execucao> =>
  req(`${P}/executar`, { method: 'POST', body: JSON.stringify(body) });

/** o CSV vem como texto; o download é feito no browser. */
export async function baixarCsv(body: { codrelatoriodef?: number; filtros?: Condicao[] }, nomeSugerido: string): Promise<void> {
  const res = await fetch(`${BASE}${P}/csv`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
  handle401(res);
  if (!res.ok) throw Object.assign(new Error('CSV'), { envelope: await res.json().catch(() => ({})) });
  const texto = await res.text();
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${nomeSugerido}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
