/**
 * AuthContext (OPERADORES corte-3b) — espelha o singleton de sessão (`shared/auth/session`) para o React e
 * expõe as ações de login/logout. A guarda de rota (`RequireAuth`) e o `AppLayout` (usuário/logout) consomem
 * este contexto. A sessão global (não-React) é a fonte da verdade dos fetchers; aqui só reagimos a ela.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LoginDto, LoginResposta } from '@apollo/shared';
import { getSessao, setSessao, subscribeSessao, tokenExpirado, type Sessao } from '../../shared/auth/session';
import { apiLogin, apiLogout, apiMe } from './authApi';

interface AuthCtxValue {
  sessao: Sessao | null;
  autenticado: boolean;
  /** faz login; se vier { token } de sucesso PLENO (sem troca obrigatória), grava a sessão. Retorna o cru
   *  p/ a tela tratar needsEmpresa / mustChangePassword. */
  entrar(dto: LoginDto): Promise<LoginResposta>;
  sair(): Promise<void>;
}

const AuthCtx = createContext<AuthCtxValue | null>(null);

function sessaoDaResposta(r: LoginResposta): Sessao | null {
  if (!r.token || r.needsEmpresa || r.mustChangePassword || !r.operador || r.empresa == null) return null;
  return { token: r.token, operador: r.operador, empresa: r.empresa, empresas: r.empresas };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessaoState] = useState<Sessao | null>(getSessao());
  useEffect(() => {
    const unsub = subscribeSessao(() => setSessaoState(getSessao()));
    // revalida a sessão PERSISTIDA no boot. corte-3c: primeiro o `exp` do JWT no cliente (barato) — expirado →
    // derruba já, sem bater no servidor. Se ainda válido localmente, o apiMe pega invalidação server-side
    // (segredo trocado, operador desabilitado): 401 → derruba; erro de rede NÃO desloga (sem status 401).
    const s = getSessao();
    if (s) {
      if (tokenExpirado(s.token)) {
        setSessao(null);
      } else {
        apiMe().catch((e: unknown) => {
          if ((e as { status?: number })?.status === 401) setSessao(null);
        });
      }
    }
    return unsub;
  }, []);

  const entrar = async (dto: LoginDto): Promise<LoginResposta> => {
    const r = await apiLogin(dto);
    const s = sessaoDaResposta(r);
    if (s) setSessao(s); // sucesso pleno → grava (needsEmpresa/mustChange NÃO gravam; a tela conduz)
    return r;
  };

  const sair = async (): Promise<void> => {
    try {
      await apiLogout();
    } catch {
      /* logout é best-effort (auditoria); o token é descartado de qualquer forma */
    }
    setSessao(null);
  };

  return (
    <AuthCtx.Provider value={{ sessao, autenticado: !!sessao, entrar, sair }}>{children}</AuthCtx.Provider>
  );
}

export function useAuth(): AuthCtxValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth fora de <AuthProvider>');
  return ctx;
}
