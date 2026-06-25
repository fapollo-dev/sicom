import { useId } from 'react';
import { FormFieldInput } from '@apollosg/design-system';
import { useMnemonic } from '../keyboard/useMnemonic';
import { parseMnemonic } from '../keyboard/parseMnemonic';

type Props = {
  label: string; // & → Alt+letra foca o campo (ADR-010)
  value?: number;
  onChange?: (v: number | undefined) => void;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  /** casas decimais para o passo (default 2 — moeda) */
  decimais?: number;
};

/**
 * Campo numérico/moeda (TJvDBCalcEdit → NumberField, recon §5c). Controlado:
 * mantém number | undefined (vazio = undefined, não NaN). Aceita vírgula ou ponto.
 */
export function NumberField({ label, value, onChange, error, disabled, placeholder, decimais = 2 }: Props) {
  const id = useId();
  useMnemonic(label, () => document.getElementById(id)?.querySelector<HTMLInputElement>('input')?.focus());
  const clean = parseMnemonic(label).text;
  return (
    <div id={id}>
      <FormFieldInput
        label={clean}
        type="number"
        inputMode="decimal"
        step={1 / 10 ** decimais}
        disabled={disabled}
        placeholder={placeholder}
        state={error ? 'error' : 'default'}
        errorMessage={error}
        value={value ?? ''}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const raw = e.target.value.replace(',', '.').trim();
          onChange?.(raw === '' ? undefined : Number(raw));
        }}
      />
    </div>
  );
}
