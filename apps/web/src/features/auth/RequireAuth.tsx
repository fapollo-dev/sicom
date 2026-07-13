/**
 * Guarda de rota (OPERADORES corte-3b): sem sessão → redireciona ao /login. Envolve o <AppLayout> no router;
 * a troca-de-senha obrigatória é resolvida DENTRO do /login (a sessão só é gravada após a troca), então aqui
 * basta checar autenticado.
 */
import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { autenticado } = useAuth();
  const location = useLocation();
  if (!autenticado) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
