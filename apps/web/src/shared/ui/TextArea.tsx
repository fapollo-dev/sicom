import { forwardRef, useRef, type TextareaHTMLAttributes } from 'react';
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
 * Campo de texto longo (TDBMemo → TextArea, recon §5c). Como o DS não expõe um
 * textarea pronto, usamos um <textarea> acessível com o mesmo rótulo + mnemônico
 * da camada de teclado. Compatível com register() do react-hook-form.
 */
export const TextArea = forwardRef<HTMLTextAreaElement, Props>(function TextArea(
  { label, error, rows = 3, ...rest },
  forwardedRef,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useMnemonic(label, () => ref.current?.focus());
  const clean = parseMnemonic(label).text;
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span>{clean}</span>
      <textarea
        ref={mergeRefs(ref, forwardedRef)}
        rows={rows}
        style={{
          padding: '8px 10px',
          border: `1px solid ${error ? '#d33' : '#999'}`,
          borderRadius: 4,
          resize: 'vertical',
          font: 'inherit',
        }}
        {...rest}
      />
      {error && <small style={{ color: '#d33' }}>{error}</small>}
    </label>
  );
});
