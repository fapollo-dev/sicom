/**
 * AuthContext (OPERADORES corte-3b) — espelha o singleton de sessão (`shared/auth/session`) para o React e
 * expõe as ações de login/logout. A guarda de rota (`RequireAuth`) e o `AppLayout` (usuário/logout) consomem
 * este contexto. A sessão global (não-React) é a fonte da verdade dos fetchers; aqui só reagimos a ela.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LoginDto, LoginResposta } from '@apollo/shared';
import { getSessao, setSessao, subscribeSessao, tokenExpirado, refrescarSessao, segundosAteExpirar, type Sessao } from '../../shared/auth/session';
import { apiLogin, apiLogout, apiMe } from './authApi';

/** o access é renovado quando faltam ≤ MARGEM_REFRESH_SEG para expirar (corte-2). */
const MARGEM_REFRESH_SEG = 10 * 60; // 10 min
const INTERVALO_CHECK_MS = 4 * 60 * 1000; // checa a cada 4 min (tab ativo)

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
  return { token: r.token, refresh: r.refresh, operador: r.operador, empresa: r.empresa, empresas: r.empresas };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessaoState] = useState<Sessao | null>(getSessao());
  useEffect(() => {
    const unsub = subscribeSessao(() => setSessaoState(getSessao()));
    // revalida a sessão PERSISTIDA no boot. corte-3c: primeiro o `exp` do JWT no cliente (barato). corte-2: se o
    // access expirou MAS há refresh, RECUPERA a sessão via /auth/refresh (não desloga). Se ainda válido, o apiMe
    // pega invalidação server-side (segredo trocado, operador desabilitado): 401 → derruba; rede NÃO desloga.
    const s = getSessao();
    if (s) {
      if (tokenExpirado(s.token)) {
        if (s.refresh) void refrescarSessao(); // recupera (ou limpa a sessão se o refresh também morreu)
        else setSessao(null);
      } else {
        apiMe().catch((e: unknown) => {
          if ((e as { status?: number })?.status === 401) setSessao(null);
        });
      }
    }

    // REFRESH PROATIVO (corte-2): mantém o access curto sempre fresco. Renova quando falta ≤ MARGEM p/ expirar,
    // checando periodicamente (tab ativo) e ao voltar o foco (tab que ficou em segundo plano além do TTL do access).
    const talvezRenovar = () => {
      const cur = getSessao();
      if (cur?.refresh && segundosAteExpirar(cur.token) <= MARGEM_REFRESH_SEG) void refrescarSessao();
    };
    const timer = setInterval(talvezRenovar, INTERVALO_CHECK_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') talvezRenovar(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsub();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
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
