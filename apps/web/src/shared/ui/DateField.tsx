import { useId } from 'react';
import { FormFieldInput } from '@apollosg/design-system';
import { useMnemonic } from '../keyboard/useMnemonic';
import { parseMnemonic } from '../keyboard/parseMnemonic';

type Props = {
  label: string; // & → Alt+letra foca o campo (ADR-010)
  value?: string; // ISO 'YYYY-MM-DD'
  onChange?: (v: string | undefined) => void;
  error?: string;
  disabled?: boolean;
};

/**
 * Campo de data (TJvDBDateEdit → DateField, recon §5c). Controlado em ISO
 * 'YYYY-MM-DD' (o que o `<input type=date>` usa e o que o Postgres devolve p/ `date`).
 * Vazio = undefined. Alt+letra foca.
 */
export function DateField({ label, value, onChange, error, disabled }: Props) {
  const id = useId();
  useMnemonic(label, () => document.getElementById(id)?.querySelector<HTMLInputElement>('input')?.focus());
  const clean = parseMnemonic(label).text;
  return (
    <div id={id}>
      <FormFieldInput
        label={clean}
        type="date"
        disabled={disabled}
        state={error ? 'error' : 'default'}
        errorMessage={error}
        value={value ?? ''}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange?.(e.target.value === '' ? undefined : e.target.value)
        }
      />
    </div>
  );
}
