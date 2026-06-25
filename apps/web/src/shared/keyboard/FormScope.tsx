import { useRef, type FormEvent, type ReactNode } from 'react';
import { ShortcutScope } from './ShortcutScope';
import { useEnterAdvances } from './useEnterAdvances';

/**
 * Casca de formulário teclado-first (ADR-010): abre um escopo de atalhos
 * (mnemônicos `&` via useMnemonic) e ativa Enter-avança-campo. Replica o
 * form Delphi onde Tab/Enter/Alt+letra seguem a taborder/mnemônicos do `.dfm`.
 */
export function FormScope({
  children,
  onSubmit,
}: {
  children: ReactNode;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  useEnterAdvances(ref);
  return (
    <ShortcutScope>
      <form
        ref={ref}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.(e);
        }}
      >
        {children}
      </form>
    </ShortcutScope>
  );
}
