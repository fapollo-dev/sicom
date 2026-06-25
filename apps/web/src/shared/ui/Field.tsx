import { forwardRef, useRef, type InputHTMLAttributes } from 'react';
import { FormFieldInput } from '@apollosg/design-system';
import { useMnemonic } from '../keyboard/useMnemonic';
import { parseMnemonic } from '../keyboard/parseMnemonic';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'size'> & {
  label: string; // pode conter & (mnemônico) — Alt+letra FOCA o campo (ADR-010, papel 2)
  error?: string;
};

function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]) {
  return (node: T) => {
    for (const r of refs) {
      if (typeof r === 'function') r(node);
      else if (r && 'current' in r) (r as React.MutableRefObject<T>).current = node;
    }
  };
}

/**
 * Campo do app: usa o `FormFieldInput` do Apollo DS + Alt+letra foca o input.
 * (O label do DS é string, então o sublinhado do mnemônico fica a cargo do DS;
 * o atalho Alt+letra é registrado pela camada de teclado e foca via ref.)
 */
export const Field = forwardRef<HTMLInputElement, Props>(function Field(
  { label, error, ...input },
  forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  // registra Alt+letra → foca o campo (papel 2 do mnemônico)
  useMnemonic(label, () => inputRef.current?.focus());
  const clean = parseMnemonic(label).text;
  return (
    <FormFieldInput
      label={clean}
      state={error ? 'error' : 'default'}
      errorMessage={error}
      ref={mergeRefs(inputRef, forwardedRef)}
      {...input}
    />
  );
});
