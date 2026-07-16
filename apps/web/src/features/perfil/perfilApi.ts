/**
 * Fetcher de PERFIS & PERMISSÕES (espelha os demais: apiHeaders/BASE + envelope ADR-015). CRUD de perfil +
 * relação operador↔perfil + matriz de grants FORM×OPCAO por perfil (corte-2).
 */
import { isErroResposta, type ErroResposta, type CriarPerfilDto, type Perfil } from '@apollo/shared';
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

export function listarPerfis(): Promise<Perfil[]> {
  return req('/cadastro/perfil?orderBy=perfil&orderDir=asc');
}
export function criarPerfil(dto: CriarPerfilDto): Promise<Perfil> {
  return req('/cadastro/perfil', { method: 'POST', body: JSON.stringify(dto) });
}
export function atualizarPerfil(codperfil: number, dto: Partial<CriarPerfilDto>): Promise<Perfil> {
  return req(`/cadastro/perfil/${codperfil}`, { method: 'PUT', body: JSON.stringify(dto) });
}
export function removerPerfil(codperfil: number): Promise<void> {
  return req(`/cadastro/perfil/${codperfil}`, { method: 'DELETE' });
}

/** matriz operador→perfis. */
export function perfisDoOperador(codoperador: number): Promise<{ codoperador: number; perfis: Array<{ codperfil: number; perfil: string; atribuido: boolean }> }> {
  return req(`/cadastro/perfil-operador/${codoperador}`);
}
export function setPerfilOperador(codoperador: number, codperfil: number, atribuido: boolean): Promise<unknown> {
  return req('/cadastro/perfil-operador', { method: 'PUT', body: JSON.stringify({ codoperador, codperfil, atribuido }) });
}

/** matriz de grants FORM×OPCAO por perfil. */
export function catalogoPermissoes(): Promise<Array<{ form: string; opcao: string; caption?: string | null; form_caption?: string | null }>> {
  return req('/cadastro/permissoes/catalogo');
}
export function grantsDoPerfil(codperfil: number): Promise<{ codperfil: number; grants: Array<{ form: string; opcao: string }> }> {
  return req(`/cadastro/permissoes/perfil/${codperfil}`);
}
export function setGrantPerfil(codperfil: number, form: string, opcao: string, concedido: boolean): Promise<unknown> {
  return req('/cadastro/permissoes', { method: 'PUT', body: JSON.stringify({ codperfil, form, opcao, concedido }) });
}
