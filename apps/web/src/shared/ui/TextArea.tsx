import { forwardRef, useRef, type TextareaHTMLAttributes } from 'react';
import { FormFieldTextarea } from '@apollosg/design-system';
import { useMnemonic } from '../keyboard/useMnemonic';
import { parseMnemonic } from '../keyboard/parseMnemonic';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  label: string; // & → Alt+letra foca (ADR-010)
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
 * Campo de texto longo (TDBMemo → Textarea, recon §5c) usando o **FormFieldTextarea
 * do DS** (L-023: nada de <label>/<textarea> cru com hardcode). Alt+letra foca o campo
 * (camada de teclado ADR-010). Compatível com register() do react-hook-form (forwardRef).
 */
export const TextArea = forwardRef<HTMLTextAreaElement, Props>(function TextArea(
  { label, error, ...rest },
  forwardedRef,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useMnemonic(label, () => ref.current?.focus());
  const clean = parseMnemonic(label).text;
  return (
    <FormFieldTextarea
      label={clean}
      state={error ? 'error' : 'default'}
      errorMessage={error}
      ref={mergeRefs(ref, forwardedRef)}
      {...rest}
    />
  );
});
