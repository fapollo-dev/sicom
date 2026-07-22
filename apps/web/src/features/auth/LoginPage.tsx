/**
 * Tela de LOGIN (OPERADORES corte-3b) — máquina de estados que reflete o /auth/login:
 *   credenciais → (multi-empresa) escolher empresa → (troca obrigatória) trocar senha → app.
 * Substitui a identidade fixa do esqueleto. Erros vêm no envelope PT (ADR-015) e são exibidos inline.
 */
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, FormFieldInput } from '@apollosg/design-system';
import type { EmpresaDisponivel, ErroResposta, LoginResposta } from '@apollo/shared';
import { useAuth } from './AuthContext';
import { apiTrocarSenha } from './authApi';

type Etapa = 'credenciais' | 'empresa' | 'trocar';

function msgErro(e: unknown): string {
  const env = (e as { envelope?: ErroResposta })?.envelope;
  return env?.message ?? 'Não foi possível concluir. Tente novamente.';
}

export function LoginPage() {
  const { entrar, autenticado } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // deep-link: a guarda guarda a rota pedida em state.from; volta pra lá após o login (fallback '/').
  const destino = (location.state as { from?: string } | null)?.from ?? '/';

  const [etapa, setEtapa] = useState<Etapa>('credenciais');
  // DEV: pré-preenche o login de desenvolvimento (ADMIN/apollosg, seedado no dev-embedded). Em produção
  // (import.meta.env.DEV=false no build) os campos vêm VAZIOS — nunca pré-preencher credencial na tela real.
  const [login, setLogin] = useState(import.meta.env.DEV ? 'ADMIN' : '');
  const [senha, setSenha] = useState(import.meta.env.DEV ? 'apollosg' : '');
  const [empresa, setEmpresa] = useState<number | undefined>(undefined);
  const [empresas, setEmpresas] = useState<EmpresaDisponivel[]>([]);
  const [chgToken, setChgToken] = useState<string | undefined>(undefined);
  const [senhaNova, setSenhaNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  // já autenticado (sessão persistida) → vai direto pro app (redirect declarativo, sem efeito no render).
  if (autenticado) return <Navigate to={destino} replace />;

  /** trata a resposta do login: escolhe empresa / troca obrigatória / entra. */
  function tratar(r: LoginResposta) {
    if (r.needsEmpresa) {
      setEmpresas(r.empresas ?? []);
      setEtapa('empresa');
      return;
    }
    if (r.mustChangePassword) {
      setChgToken(r.token);
      setSenhaNova('');
      setConfirmacao('');
      setEtapa('trocar');
      return;
    }
    // sucesso pleno: `entrar` já gravou a sessão (não re-grava aqui) — só navega.
    navigate(destino, { replace: true });
  }

  async function submeterCredenciais(ev: FormEvent, emp?: number) {
    ev.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      tratar(await entrar({ login: login.trim(), senha, empresa: emp ?? empresa }));
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      setCarregando(false);
    }
  }

  async function submeterTroca(ev: FormEvent) {
    ev.preventDefault();
    setErro(null);
    setCarregando(true);
    // passo 1: TROCAR a senha (idempotência: se este passo tiver sucesso, a senha antiga não vale mais).
    try {
      await apiTrocarSenha({ senhaAtual: senha, senhaNova, confirmacao }, chgToken);
    } catch (e) {
      setErro(msgErro(e));
      setCarregando(false);
      return; // ainda na etapa 'trocar', com a senha ANTIGA — retentar re-tenta só a troca.
    }
    // passo 2: DESACOPLADO — a senha já mudou. Volta à etapa credenciais com a senha NOVA (uma falha de rede
    // aqui não re-tenta a troca; a retentativa vira um login normal). Depois tenta entrar automaticamente.
    const nova = senhaNova;
    setSenha(nova);
    setChgToken(undefined);
    setSenhaNova('');
    setConfirmacao('');
    setEtapa('credenciais');
    try {
      tratar(await entrar({ login: login.trim(), senha: nova, empresa }));
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-muted p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-fg">Apollo ERP</h1>
        <p className="mb-6 text-sm text-fg-muted">
          {etapa === 'credenciais' && 'Entre com seu usuário e senha.'}
          {etapa === 'empresa' && 'Selecione a empresa de trabalho.'}
          {etapa === 'trocar' && 'Defina uma nova senha para continuar.'}
        </p>

        {etapa === 'credenciais' && (
          <form onSubmit={(e) => submeterCredenciais(e)} className="flex flex-col gap-4">
            <FormFieldInput label="Usuário" value={login} autoFocus onChange={(e) => setLogin(e.target.value)} />
            <FormFieldInput label="Senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} />
            {erro && <p className="text-sm text-danger">{erro}</p>}
            <Button type="submit" disabled={carregando || !login.trim() || !senha}>
              {carregando ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        )}

        {etapa === 'empresa' && (
          <form onSubmit={(e) => submeterCredenciais(e, empresa)} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm text-fg">
              Empresa
              <select
                className="rounded-md border border-border bg-surface px-3 py-2 text-fg"
                value={empresa ?? ''}
                onChange={(e) => setEmpresa(e.target.value ? Number(e.target.value) : undefined)}
              >
                <option value="">Selecione…</option>
                {empresas.map((emp) => (
                  <option key={emp.idempresa} value={emp.idempresa}>
                    {emp.nome ? `${emp.idempresa} — ${emp.nome}` : `Empresa ${emp.idempresa}`}
                  </option>
                ))}
              </select>
            </label>
            {erro && <p className="text-sm text-danger">{erro}</p>}
            <Button type="submit" disabled={carregando || empresa == null}>
              {carregando ? 'Entrando…' : 'Continuar'}
            </Button>
          </form>
        )}

        {etapa === 'trocar' && (
          <form onSubmit={submeterTroca} className="flex flex-col gap-4">
            <FormFieldInput label="Nova senha" type="password" value={senhaNova} autoFocus onChange={(e) => setSenhaNova(e.target.value)} />
            <FormFieldInput label="Confirme a nova senha" type="password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
            {erro && <p className="text-sm text-danger">{erro}</p>}
            <Button type="submit" disabled={carregando || senhaNova.length < 6 || !confirmacao}>
              {carregando ? 'Salvando…' : 'Trocar senha e entrar'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
