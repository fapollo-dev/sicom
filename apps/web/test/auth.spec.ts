import { describe, it, expect, beforeEach } from 'vitest';
import { apiHeaders, loginHeaders, getToken, getSessao, setSessao, tokenExpirado, TENANT } from '../src/shared/auth/session';

/** JWT de teste (só o payload importa p/ tokenExpirado — assinatura irrelevante no cliente). */
function jwtCom(exp: number): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 7, exp })}.sig`;
}

/** OPERADORES corte-3b — contrato do store de sessão que os fetchers consomem. */

describe('session / apiHeaders', () => {
  beforeEach(() => setSessao(null));

  it('sem sessão: apiHeaders só tem content-type (sem Authorization) → rota de domínio 401', () => {
    const h = apiHeaders();
    expect(h.authorization).toBeUndefined();
    expect(h['content-type']).toBe('application/json');
    expect(getToken()).toBeNull();
    expect(getSessao()).toBeNull();
  });

  it('após login: apiHeaders vira Bearer <token>; limpa no logout', () => {
    setSessao({ token: 'jwt-abc', operador: { codoperador: 7, nome: 'SMOKE', login: 'SMOKE' }, empresa: 1, empresas: [{ idempresa: 1 }] });
    expect(getToken()).toBe('jwt-abc');
    expect(apiHeaders().authorization).toBe('Bearer jwt-abc');
    expect(apiHeaders({ 'x-foo': 'bar' })['x-foo']).toBe('bar'); // extras preservados
    setSessao(null);
    expect(apiHeaders().authorization).toBeUndefined();
  });

  it('tokenExpirado (corte-3c): expirado/ilegível → true; futuro → false', () => {
    expect(tokenExpirado(jwtCom(Math.floor(Date.now() / 1000) + 3600))).toBe(false); // +1h
    expect(tokenExpirado(jwtCom(Math.floor(Date.now() / 1000) - 10))).toBe(true); // já venceu
    expect(tokenExpirado('lixo')).toBe(true);
    expect(tokenExpirado(null)).toBe(true);
    expect(tokenExpirado('')).toBe(true);
  });

  it('loginHeaders leva o tenant (seletor do banco), NÃO o Bearer', () => {
    const h = loginHeaders();
    expect(h['x-tenant-id']).toBe(TENANT);
    expect(h.authorization).toBeUndefined();
  });

  it('sessão persiste em localStorage (sobrevive a reload)', () => {
    setSessao({ token: 't1', operador: { codoperador: 7, nome: 'X', login: 'X' }, empresa: 1, empresas: [] });
    expect(localStorage.getItem('apollo.session')).toContain('t1');
    setSessao(null);
    expect(localStorage.getItem('apollo.session')).toBeNull();
  });
});
