/**
 * SESSÃO (OPERADORES corte-3b) — singleton NÃO-React da identidade autenticada. Os fetchers (funções puras,
 * fora do React) leem o token daqui via `apiHeaders()`; o `AuthContext` (React) espelha este store para a UI.
 * Persiste em localStorage (sobrevive a reload). Substitui os headers FIXOS (x-operador-id/x-empresa-id) das
 * telas: agora a identidade é o JWT emitido pelo /auth/login; o tenant só viaja no login (seletor do banco).
 *
 * TRADEOFF (consciente): o JWT fica em localStorage — padrão em SPA, mas exposto a XSS (um script injetado leria
 * o token). Endurecimento futuro = cookie httpOnly + CSRF (fora do escopo do corte). Sync entre abas via evento
 * `storage`; sem refresh token (TTL 12h → re-login). O 401 (token expirado/segredo trocado) limpa a sessão.
 */
import type { EmpresaDisponivel } from '@apollo/shared';

/** tenant (seletor do banco) — configurável; enviado só no login, depois o JWT o carrega. */
export const TENANT = (import.meta.env.VITE_TENANT_ID as string | undefined) ?? 'pinheirao';

const KEY = 'apollo.session';

export interface Sessao {
  token: string;
  operador: { codoperador: number; nome: string | null; login: string | null };
  empresa: number;
  empresas: EmpresaDisponivel[];
}

function carregar(): Sessao | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Sessao>;
    // valida o SHAPE (corrompido / formato antigo → trata como sem sessão em vez de deixar `autenticado` truthy
    // com `operador` faltando, que derrubaria o AppLayout numa tela branca).
    if (!s || typeof s.token !== 'string' || !s.operador || typeof s.operador.codoperador !== 'number' || typeof s.empresa !== 'number') {
      return null;
    }
    return s as Sessao;
  } catch {
    return null;
  }
}

let atual: Sessao | null = carregar();
const listeners = new Set<() => void>();

// sync entre abas: logout/login numa aba reflete nas demais já abertas.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      atual = carregar();
      listeners.forEach((l) => l());
    }
  });
}

export function getSessao(): Sessao | null {
  return atual;
}
export function getToken(): string | null {
  return atual?.token ?? null;
}

/**
 * corte-3c — checa o `exp` do JWT no CLIENTE (sem verificar assinatura — só o payload) para expirar a sessão
 * PROATIVAMENTE no boot, em vez de esperar o 1º 401. Token ilegível/sem exp → tratado como expirado.
 */
export function tokenExpirado(token: string | null | undefined): boolean {
  if (!token) return true;
  try {
    const [, body] = token.split('.');
    if (!body) return true;
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}
export function setSessao(s: Sessao | null): void {
  atual = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* localStorage indisponível (modo privado/SSR) — mantém em memória */
  }
  listeners.forEach((l) => l());
}
/** assina mudanças da sessão (o AuthContext re-renderiza a partir daqui). */
export function subscribeSessao(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Headers das requisições AUTENTICADAS: `Authorization: Bearer <jwt>`. Sem token → só content-type (a rota
 * de domínio exige operador → 401; a guarda de rota já teria mandado ao /login). Substitui os headers fixos.
 */
export function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const t = getToken();
  return {
    'content-type': 'application/json',
    ...(t ? { authorization: `Bearer ${t}` } : {}),
    ...extra,
  };
}

/** Headers do LOGIN (público): o tenant vem daqui (o /auth/login ainda não tem token). */
export function loginHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', 'x-tenant-id': TENANT };
}

/**
 * Trata 401 de uma resposta de rota autenticada: sessão expirada/inválida (token de 12h venceu ou o segredo do
 * servidor mudou) → limpa a sessão. Isso dispara os listeners → o `RequireAuth` redireciona ao /login (senão a
 * app ficaria "presa" no shell errando em toda tela). Só age quando HÁ sessão (evita mexer no login público).
 */
export function handle401(res: { status: number }): void {
  if (res.status === 401 && atual) setSessao(null);
}
