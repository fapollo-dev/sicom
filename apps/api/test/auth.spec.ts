import { describe, it, expect } from 'vitest';
import { hashSenha, verificarSenha, decodeSenhaLegado, encodeSenhaLegado } from '../src/shared/auth/crypto';
import { signJwt, verifyJwt, assertAuthConfigProducao, isProducao } from '../src/shared/auth/jwt';
import { TenantMiddleware } from '../src/shared/tenant/tenant.middleware';
import { tenantStore } from '../src/shared/tenant/tenant-context';

/** OPERADORES corte-3a — utils de auth (zero-dep) + modo-duplo do middleware. */

describe('crypto (scrypt)', () => {
  it('hash verifica a senha correta e rejeita a errada; hashes diferem (salt aleatório)', () => {
    const h = hashSenha('smoke123');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(verificarSenha('smoke123', h)).toBe(true);
    expect(verificarSenha('errada', h)).toBe(false);
    expect(hashSenha('smoke123')).not.toBe(h); // salt aleatório → ciphertext diferente
  });
  it('verificarSenha é fail-safe (nunca lança) em hash nulo/malformado', () => {
    expect(verificarSenha('x', null)).toBe(false);
    expect(verificarSenha('x', undefined)).toBe(false);
    expect(verificarSenha('x', 'lixo')).toBe(false);
    expect(verificarSenha('x', 'scrypt$1$1')).toBe(false);
  });
  it('cifra legada César +13 é reversível (round-trip do cutover)', () => {
    // "APOLLOSG" (senha de fábrica do op 1) → bytes +13; decode recupera o claro.
    expect(encodeSenhaLegado('1234')).toBe(decodeCharShift('1234', 13));
    expect(decodeSenhaLegado(encodeSenhaLegado('APOLLOSG'))).toBe('APOLLOSG');
    expect(decodeSenhaLegado(encodeSenhaLegado('0217'))).toBe('0217');
  });
});

function decodeCharShift(s: string, n: number): string {
  return Array.from(s, (ch) => String.fromCharCode((ch.charCodeAt(0) + n) & 0xff)).join('');
}

describe('jwt (HS256 artesanal)', () => {
  const now = 1_700_000_000;
  it('assina e verifica o payload; expira; rejeita adulteração', () => {
    const t = signJwt({ tenant: 'pinheirao', sub: 7, emp: 1 }, now, 3600);
    const p = verifyJwt(t, now + 10);
    expect(p?.tenant).toBe('pinheirao');
    expect(p?.sub).toBe(7);
    expect(p?.emp).toBe(1);
    expect(verifyJwt(t, now + 4000)).toBeNull(); // expirado
    expect(verifyJwt(t.slice(0, -2) + 'xx', now)).toBeNull(); // assinatura adulterada
    expect(verifyJwt('a.b.c', now)).toBeNull();
    expect(verifyJwt(undefined, now)).toBeNull();
  });
});

describe('assertAuthConfigProducao (fold A1)', () => {
  const restore = (env: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  it('em produção: aborta sem AUTH_JWT_SECRET ou com o default de DEV; passa com segredo forte', () => {
    const prev = { NODE_ENV: process.env.NODE_ENV, APP_ENV: process.env.APP_ENV, AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.APP_ENV;
      delete process.env.AUTH_JWT_SECRET;
      expect(isProducao()).toBe(true);
      expect(() => assertAuthConfigProducao()).toThrow(); // ausente
      process.env.AUTH_JWT_SECRET = 'apollo-dev-secret-troque-em-producao';
      expect(() => assertAuthConfigProducao()).toThrow(); // = default de DEV
      process.env.AUTH_JWT_SECRET = 'um-segredo-forte-de-verdade-32bytes+';
      expect(() => assertAuthConfigProducao()).not.toThrow();
    } finally {
      restore(prev);
    }
  });
  it('fora de produção: nunca aborta (usa o fallback de DEV conscientemente)', () => {
    const prev = { NODE_ENV: process.env.NODE_ENV, APP_ENV: process.env.APP_ENV, AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET };
    try {
      delete process.env.NODE_ENV;
      delete process.env.APP_ENV;
      delete process.env.AUTH_JWT_SECRET;
      expect(isProducao()).toBe(false);
      expect(() => assertAuthConfigProducao()).not.toThrow();
    } finally {
      restore(prev);
    }
  });
});

describe('TenantMiddleware — modo-duplo', () => {
  const mw = new TenantMiddleware();
  const run = (headers: Record<string, string>): any => {
    const req: any = { header: (k: string) => headers[k.toLowerCase()] };
    let ctx: any;
    mw.use(req, {} as any, () => {
      ctx = tenantStore.getStore();
    });
    return ctx;
  };

  it('Bearer válido é a fonte da identidade (ignora headers crus)', () => {
    const token = signJwt({ tenant: 'pinheirao', sub: 7, emp: 1 }, Math.floor(Date.now() / 1000), 3600);
    const ctx = run({ authorization: `Bearer ${token}`, 'x-tenant-id': 'outro', 'x-operador-id': '999', 'x-empresa-id': '5' });
    expect(ctx.tenantId).toBe('pinheirao'); // do JWT, não do header
    expect(ctx.operadorId).toBe(7);
    expect(ctx.empresaId).toBe(1);
  });

  it('sem Bearer e com header-identity PROIBIDO: só o tenant do header; operador ignorado', () => {
    const prev = process.env.AUTH_ALLOW_HEADER_IDENTITY;
    process.env.AUTH_ALLOW_HEADER_IDENTITY = '0';
    try {
      const ctx = run({ 'x-tenant-id': 'pinheirao', 'x-operador-id': '7', 'x-empresa-id': '1' });
      expect(ctx.tenantId).toBe('pinheirao');
      expect(ctx.operadorId).toBeUndefined(); // header NÃO honrado em produção
      expect(ctx.empresaId).toBeUndefined();
    } finally {
      process.env.AUTH_ALLOW_HEADER_IDENTITY = prev;
    }
  });

  it('sem Bearer e com header-identity permitido (default): headers crus valem (dev/smoke)', () => {
    const prev = process.env.AUTH_ALLOW_HEADER_IDENTITY;
    delete process.env.AUTH_ALLOW_HEADER_IDENTITY;
    try {
      const ctx = run({ 'x-tenant-id': 'pinheirao', 'x-operador-id': '7', 'x-empresa-id': '1' });
      expect(ctx.operadorId).toBe(7);
      expect(ctx.empresaId).toBe(1);
    } finally {
      if (prev !== undefined) process.env.AUTH_ALLOW_HEADER_IDENTITY = prev;
    }
  });

  it('sem tenant algum → lança (fail-closed)', () => {
    expect(() => run({})).toThrow();
  });
});
