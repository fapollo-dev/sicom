/**
 * Fetcher do CONTROLE DE PERMISSÕES (espelha os demais: apiHeaders/BASE + envelope ADR-015): a matriz de grants FORM×OPCAO por
 * operador e por perfil. O cadastro de perfil é o `<CadMaster>` de `cadastro/perfil`.
 */
import { isErroResposta, type ErroResposta } from '@apollo/shared';
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

/** matriz de grants FORM×OPCAO por perfil. */
export function catalogoPermissoes(): Promise<Array<{ form: string; opcao: string; caption?: string | null; form_caption?: string | null }>> {
  return req('/cadastro/permissoes/catalogo');
}
export function grantsDoPerfil(codperfil: number, codempresa?: number): Promise<{ codperfil: number; codempresa: number; grants: Array<{ form: string; opcao: string }> }> {
  const q = codempresa != null ? `?codempresa=${codempresa}` : '';
  return req(`/cadastro/permissoes/perfil/${codperfil}${q}`);
}
export function setGrantPerfil(codperfil: number, form: string, opcao: string, concedido: boolean, codempresa?: number): Promise<unknown> {
  return req('/cadastro/permissoes', { method: 'PUT', body: JSON.stringify({ codperfil, form, opcao, concedido, codempresa }) });
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
// O caminho mais usado pelo cliente (55.251 linhas por operador contra 2.438 por perfil); o modo da produção é AMBOS —
// operador ∪ perfis. Ver dossiê `uCtrlPermissoes.md` §2.
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
