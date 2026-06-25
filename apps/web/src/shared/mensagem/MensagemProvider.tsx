import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertModal } from '@apollosg/design-system';
import { isErroResposta, type CampoErro, type ErroResposta } from '@apollo/shared';

/**
 * Exibição PADRONIZADA de mensagens no front (ADR-015). Toda falha de API vira o
 * envelope `ErroResposta` (vide `resourceApi.req`); aqui ele é apresentado num
 * AlertModal do DS — `message` em PT + lista organizada dos erros por campo.
 * Sucesso usa o mesmo modal com tone='success'.
 */

export interface MensagemApi {
  /** abre o modal de erro a partir de QUALQUER throwable (extrai o envelope) */
  erro(e: unknown): void;
  /** abre o modal de sucesso com uma mensagem em PT */
  sucesso(msg: string): void;
}

/** PT genérico quando não há envelope no erro capturado. */
const ERRO_GENERICO = 'Ocorreu um erro inesperado. Tente novamente.';

/** Extrai o envelope padrão de um throwable; cai num PT genérico se não houver. */
function extrairEnvelope(e: unknown): ErroResposta {
  // 1) Error lançado por resourceApi.req carrega `.envelope`
  const env = (e as { envelope?: unknown } | null | undefined)?.envelope;
  if (isErroResposta(env)) return env;
  // 2) o próprio throwable já é o envelope
  if (isErroResposta(e)) return e;
  // 3) fallback genérico em PT
  return { statusCode: 0, code: 'ERRO', message: ERRO_GENERICO };
}

const MensagemContext = createContext<MensagemApi | null>(null);

interface ModalState {
  tone: 'danger' | 'success';
  title: string;
  message: string;
  campos: CampoErro[];
}

export function MensagemProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<ModalState | null>(null);

  const erro = useCallback((e: unknown) => {
    const env = extrairEnvelope(e);
    setEstado({
      tone: 'danger',
      title: 'Não foi possível concluir',
      message: env.message,
      campos: env.campos ?? [],
    });
  }, []);

  const sucesso = useCallback((msg: string) => {
    setEstado({ tone: 'success', title: 'Operação concluída', message: msg, campos: [] });
  }, []);

  const api = useMemo<MensagemApi>(() => ({ erro, sucesso }), [erro, sucesso]);

  const aberto = estado !== null;
  // descrição = mensagem + (quando houver) lista ORGANIZADA dos erros por campo.
  // Usa <span> (inline-level) com layout flex em vez de <ul>/<li> — o
  // AlertDialogDescription do DS renderiza um <p>, e blocos (<ul>) dentro de <p>
  // são HTML inválido (hydration error).
  const descricao = estado && (
    <span className="flex flex-col gap-gp-xs">
      <span>{estado.message}</span>
      {estado.campos.length > 0 && (
        <span className="flex flex-col gap-gp-2xs text-left text-fg-default">
          {estado.campos.map((c, i) => (
            <span key={`${c.campo}-${i}`}>
              <strong>{c.campo}</strong>: {c.mensagem}
            </span>
          ))}
        </span>
      )}
    </span>
  );

  return (
    <MensagemContext.Provider value={api}>
      {children}
      <AlertModal
        open={aberto}
        onOpenChange={(o) => {
          if (!o) setEstado(null);
        }}
        tone={estado?.tone ?? 'danger'}
        title={estado?.title ?? ''}
        description={descricao ?? undefined}
        confirmLabel="OK"
        hideCancel
        onConfirm={() => setEstado(null)}
      />
    </MensagemContext.Provider>
  );
}

/**
 * Acessa a API de mensagens. SEGURO fora do provider: retorna um no-op que apenas
 * faz `console.warn` — assim componentes/testes sem `<MensagemProvider>` não quebram.
 */
export function useMensagem(): MensagemApi {
  const ctx = useContext(MensagemContext);
  if (ctx) return ctx;
  return NOOP;
}

const NOOP: MensagemApi = {
  erro: (e) => console.warn('[useMensagem] sem MensagemProvider — erro ignorado:', e),
  sucesso: (msg) => console.warn('[useMensagem] sem MensagemProvider — sucesso ignorado:', msg),
};
