import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * JWT HS256 artesanal (zero dependência — decisão do corte OPERADORES corte-3). ~1 função de assinar + 1 de
 * verificar sobre `node:crypto`. Payload da sessão do Apollo: { tenant, sub (=codoperador), emp (=idempresa) }
 * + iat/exp. Substitui a `EmpresaAtual`/`Sessao` global do legado por um token assinado que alimenta o
 * `TenantCtx` no middleware.
 */
export interface ApolloJwtPayload {
  tenant: string;
  sub: number; // codoperador
  emp: number; // idempresa (empresa selecionada no login)
  chg?: boolean; // troca de senha obrigatória (fold M2) — token restrito a /auth/trocar-senha
  iat: number;
  exp: number;
}

const ALG = { alg: 'HS256', typ: 'JWT' };
const DEFAULT_TTL_SEG = 12 * 60 * 60; // 12h (uma jornada de trabalho)
const DEV_SECRET_FALLBACK = 'apollo-dev-secret-troque-em-producao';

/** true quando o processo roda em produção (NODE_ENV ou APP_ENV). */
export function isProducao(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
}

/** Segredo de assinatura. Env `AUTH_JWT_SECRET`; fallback de DEV explícito (proibido em produção, ver assert). */
export function authSecret(): string {
  return process.env.AUTH_JWT_SECRET ?? DEV_SECRET_FALLBACK;
}

/**
 * Fail-closed de bootstrap (fold A1): em PRODUÇÃO, aborta o start se `AUTH_JWT_SECRET` estiver ausente ou for
 * o fallback de DEV — senão a chave de assinatura seria uma constante pública do código (forja de token total).
 * Chamado no main.ts antes de subir a app. Em dev/test/smoke não faz nada (usa o fallback conscientemente).
 */
export function assertAuthConfigProducao(): void {
  if (!isProducao()) return;
  const s = process.env.AUTH_JWT_SECRET;
  if (!s || s === DEV_SECRET_FALLBACK) {
    throw new Error('AUTH_JWT_SECRET ausente ou igual ao default de DEV — defina um segredo forte em produção (fold A1).');
  }
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj: unknown): string {
  return b64url(JSON.stringify(obj));
}
function assinar(dados: string): string {
  return b64url(createHmac('sha256', authSecret()).update(dados).digest());
}

/** Emite o token. `nowSeg` é injetável (o runtime do workflow/testes não tem Date.now determinístico). */
export function signJwt(
  claims: { tenant: string; sub: number; emp: number; chg?: boolean },
  nowSeg: number,
  ttlSeg: number = DEFAULT_TTL_SEG,
): string {
  const payload: ApolloJwtPayload = { ...claims, iat: nowSeg, exp: nowSeg + ttlSeg };
  const head = b64urlJson(ALG);
  const body = b64urlJson(payload);
  return `${head}.${body}.${assinar(`${head}.${body}`)}`;
}

/** Verifica assinatura + expiração. Retorna o payload ou `null` (nunca lança). */
export function verifyJwt(token: string | undefined | null, nowSeg: number): ApolloJwtPayload | null {
  if (!token) return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [head, body, sig] = partes;
  const esperada = assinar(`${head}.${body}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: ApolloJwtPayload;
  try {
    payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload?.exp !== 'number' || payload.exp <= nowSeg) return null;
  if (typeof payload.tenant !== 'string' || typeof payload.sub !== 'number' || typeof payload.emp !== 'number') return null;
  return payload;
}
