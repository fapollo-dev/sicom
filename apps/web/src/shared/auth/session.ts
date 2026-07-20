/**
 * SESSÃO (OPERADORES corte-3b) — singleton NÃO-React da identidade autenticada. Os fetchers (funções puras,
 * fora do React) leem o token daqui via `apiHeaders()`; o `AuthContext` (React) espelha este store para a UI.
 * Persiste em localStorage (sobrevive a reload). Substitui os headers FIXOS (x-operador-id/x-empresa-id) das
 * telas: agora a identidade é o JWT emitido pelo /auth/login; o tenant só viaja no login (seletor do banco).
 *
 * TRADEOFF (consciente): token + refresh ficam em localStorage — padrão em SPA, mas exposto a XSS (um script
 * injetado leria ambos). corte-2: o access é CURTO (1h) e renovado por um REFRESH de 7 dias (`refrescarSessao`);
 * isso AUMENTA o raio de um XSS (o refresh roubado renova por até 7 dias, vs 1h do access) — endurecimento futuro =
 * cookie httpOnly + CSRF (fora do escopo). Sync entre abas via `storage`; refresh serializado entre abas (Web Locks
 * + re-leitura) p/ não disparar a detecção de reuso do servidor. O 401 tenta renovar; refresh morto → limpa a sessão.
 */
import type { EmpresaDisponivel } from '@apollo/shared';

/** tenant (seletor do banco) — configurável; enviado só no login, depois o JWT o carrega. */
export const TENANT = (import.meta.env.VITE_TENANT_ID as string | undefined) ?? 'pinheirao';
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

const KEY = 'apollo.session';

export interface Sessao {
  token: string;
  refresh?: string; // refresh token OPACO (corte-2) — renova o access sem re-login; ausente em sessões antigas
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
/** segundos até o `exp` do access (corte-2, para o refresh PROATIVO); ≤0 se expirado; +∞ se ilegível (não força refresh). */
export function segundosAteExpirar(token: string | null | undefined): number {
  if (!token) return 0;
  try {
    const [, body] = token.split('.');
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    if (typeof payload.exp !== 'number') return Number.POSITIVE_INFINITY;
    return payload.exp - Math.floor(Date.now() / 1000);
  } catch {
    return Number.POSITIVE_INFINITY;
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
 * RENOVA o access token a partir do refresh (corte-2). SERIALIZADO (um único in-flight): dois refreshes simultâneos
 * do MESMO token disparariam a detecção de reuso no servidor (revoga a família) — por isso todos os chamadores
 * concorrentes aguardam a MESMA promise. Sucesso → atualiza a sessão (token + refresh rotacionado). Falha 401 (refresh
 * morto/revogado) → limpa a sessão (→ /login). Erro de REDE → NÃO desloga (transitório; tenta de novo depois).
 */
let refreshInflight: Promise<boolean> | null = null;

/** serializa o refresh ATÉ ENTRE ABAS (Web Locks). Fallback (sem suporte / jsdom): só o singleton per-tab. */
async function comLockRefresh(fn: () => Promise<boolean>): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? (navigator as { locks?: { request?: (n: string, f: () => Promise<boolean>) => Promise<boolean> } }).locks : undefined;
  return locks?.request ? locks.request('apollo.refresh', fn) : fn();
}

export function refrescarSessao(): Promise<boolean> {
  if (refreshInflight) return refreshInflight;
  const tokenAntes = atual?.token;
  refreshInflight = comLockRefresh(async () => {
    // fold auditoria [ALTA] (multi-aba): DENTRO do lock re-lê o localStorage (fonte compartilhada). Se OUTRA aba já
    // rotacionou (token mudou), ADOTA a sessão nova e NÃO refaz — apresentar um refresh já rotacionado dispararia a
    // detecção de reuso no servidor e mataria a família (todas as abas). O lock + a re-leitura tornam multi-aba seguro.
    const armazenada = carregar();
    if (armazenada && armazenada.token !== tokenAntes) {
      if (armazenada.token !== atual?.token) { atual = armazenada; listeners.forEach((l) => l()); }
      return true;
    }
    const s = armazenada ?? atual;
    if (!s?.refresh) return false;
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT },
        body: JSON.stringify({ refresh: s.refresh }),
      });
      if (!res.ok) {
        if (res.status === 401) setSessao(null); // refresh morto/revogado → re-login
        return false;
      }
      const r = (await res.json()) as { token?: string; refresh?: string; operador?: Sessao['operador']; empresa?: number; empresas?: EmpresaDisponivel[] };
      if (!r.token || !r.refresh || !r.operador || r.empresa == null) {
        setSessao(null);
        return false;
      }
      // fold auditoria [MÉDIA]: logout (ou 401) durante o refresh in-flight zerou a sessão → NÃO ressuscita.
      if (atual === null) return false;
      setSessao({ token: r.token, refresh: r.refresh, operador: r.operador, empresa: r.empresa, empresas: r.empresas ?? [] });
      return true;
    } catch {
      return false; // rede indisponível → mantém a sessão (não desloga por transitório)
    }
  }).finally(() => {
    refreshInflight = null;
  });
  return refreshInflight;
}

/**
 * Trata 401 de uma resposta de rota autenticada. corte-2: se HÁ refresh, tenta RENOVAR (o access curto pode ter
 * vencido) em vez de deslogar de imediato — `refrescarSessao` limpa a sessão se o refresh também estiver morto.
 * Sem refresh (sessão antiga) → limpa direto. Só age quando HÁ sessão (não mexe no login público).
 */
export function handle401(res: { status: number }): void {
  if (res.status !== 401 || !atual) return;
  if (atual.refresh) void refrescarSessao();
  else setSessao(null);
}
