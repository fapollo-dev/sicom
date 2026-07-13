/**
 * Fetcher de AUTH (OPERADORES corte-3b). /auth/login é público (headers de login = content-type + x-tenant-id);
 * /auth/trocar-senha, /me e /logout usam o Bearer da sessão (ou um token explícito no fluxo de troca-obrigatória,
 * cujo token `chg` ainda não está na sessão). Erros no envelope padrão (ADR-015), como os demais fetchers.
 */
import {
  isErroResposta,
  type ErroResposta,
  type LoginDto,
  type LoginResposta,
  type TrocarSenhaDto,
} from '@apollo/shared';
import { apiHeaders, loginHeaders } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function req<T>(path: string, init: RequestInit, headers: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: (body as any)?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** POST /auth/login — pode retornar { token } OU { needsEmpresa, empresas } (multi-empresa). */
export function apiLogin(dto: LoginDto): Promise<LoginResposta> {
  return req('/auth/login', { method: 'POST', body: JSON.stringify(dto) }, loginHeaders());
}

/**
 * POST /auth/trocar-senha. No fluxo de TROCA OBRIGATÓRIA o token `chg` ainda não está na sessão → passa-se
 * explícito em `token`; nos demais casos usa o Bearer da sessão.
 */
export function apiTrocarSenha(dto: TrocarSenhaDto, token?: string): Promise<{ ok: true }> {
  const headers = token ? { 'content-type': 'application/json', authorization: `Bearer ${token}` } : apiHeaders();
  return req('/auth/trocar-senha', { method: 'POST', body: JSON.stringify(dto) }, headers);
}

/** GET /auth/me — identidade corrente + empresas (revalida a sessão do Bearer). */
export function apiMe(): Promise<LoginResposta> {
  return req('/auth/me', {}, apiHeaders());
}

/** POST /auth/logout — auditoria LOGOFF (o token é stateless; o cliente descarta a sessão). */
export function apiLogout(): Promise<void> {
  return req('/auth/logout', { method: 'POST' }, apiHeaders());
}
