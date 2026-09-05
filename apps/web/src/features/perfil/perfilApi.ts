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

/** trilha de auditoria (AUDIT_PERMISSOES) — mudanças de grant de um perfil (corte-2). */
export interface AuditoriaPermissao {
  codaudit: number;
  codoperador?: number | null;
  form: string;
  opcao: string;
  codperfil: number | null;
  perfil_nome: string | null;
  data: string;
  tipo: string; // 'INSERT' | 'DELETE'
  codoperador_acao: number | null;
  ator_nome: string | null;
}
export function auditoriaPermissoes(codperfil: number): Promise<AuditoriaPermissao[]> {
  return req(`/cadastro/permissoes/auditoria?codperfil=${codperfil}`);
}
/** trilha de um OPERADOR (a tela de controle por usuário mostra o histórico dele, não o de um perfil). */
export function auditoriaDoOperador(codoperador: number): Promise<AuditoriaPermissao[]> {
  return req(`/cadastro/permissoes/auditoria?codoperador=${codoperador}`);
}

// ── CONTROLE DE PERMISSÕES por OPERADOR (FRMCTRLPERMISSOES, corte-3) ─────────────────────────────────────────
// É o modo que o cliente usa: `CONTROLE_PERMISSOES='Usuario'` (55.251 linhas por operador contra 2.438 por
// perfil, que nesse modo o legado nem consulta). Ver dossiê `uCtrlPermissoes.md`.
export function grantsDoOperador(codoperador: number, codempresa?: number): Promise<{ codoperador: number; codempresa: number; grants: Array<{ form: string; opcao: string }> }> {
  const q = codempresa != null ? `?codempresa=${codempresa}` : '';
  return req(`/cadastro/permissoes/operador/${codoperador}${q}`);
}
export function setGrantOperador(body: { codoperador: number; form: string; opcao: string; concedido: boolean; codempresa?: number }): Promise<unknown> {
  return req('/cadastro/permissoes/operador', { method: 'PUT', body: JSON.stringify(body) });
}
/** marcar/desmarcar em lote: `form` presente = as opções daquele formulário; ausente = o catálogo inteiro. */
export function setLotePermissoes(body: { codoperador?: number; codperfil?: number; form?: string; concedido: boolean; codempresa?: number }): Promise<{ alterados: number; ignorados_industria: number }> {
  return req('/cadastro/permissoes/lote', { method: 'PUT', body: JSON.stringify(body) });
}
/** ⚠️ DESTRUTIVO: o legado apaga as permissões do destino antes de copiar (SP_REPLICA_PERMISSAO). */
export function clonarPermissoes(body: { tipo: 'USUARIO' | 'PERFIL'; de: number; de_empresa: number; para: number; para_empresa: number }): Promise<{ copiados: number; apagados: number }> {
  return req('/cadastro/permissoes/clonar', { method: 'POST', body: JSON.stringify(body) });
}
