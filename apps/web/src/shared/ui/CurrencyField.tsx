import { useId } from 'react';
import { FormFieldInput } from '@apollosg/design-system';
import { useMnemonic } from '../keyboard/useMnemonic';
import { parseMnemonic } from '../keyboard/parseMnemonic';

type Props = {
  label: string; // & → Alt+letra foca (ADR-010)
  value?: number;
  onChange?: (v: number | undefined) => void;
  error?: string;
  disabled?: boolean;
};

/** formata número → "1.234,56" (pt-BR, 2 casas). */
const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Campo MONETÁRIO (TJvDBCalcEdit moeda → currency, recon §5c). NÃO é spinner:
 * input de texto com máscara de centavos (digita 12345 → R$ 123,45), prefixo "R$"
 * (startAddon do FormFieldInput do DS), display sempre formatado pt-BR. Controlado em
 * number | undefined. Zero hardcode (FormFieldInput do DS). Alt+letra foca.
 */
export function CurrencyField({ label, value, onChange, error, disabled }: Props) {
  const id = useId();
  useMnemonic(label, () => document.getElementById(id)?.querySelector<HTMLInputElement>('input')?.focus());
  const clean = parseMnemonic(label).text;
  const display = value == null ? '' : fmtBRL(value);
  return (
    <div id={id}>
      <FormFieldInput
        label={clean}
        inputMode="decimal"
        startAddon="R$"
        disabled={disabled}
        state={error ? 'error' : 'default'}
        errorMessage={error}
        value={display}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          // máscara de centavos: só dígitos → valor / 100
          const digitos = e.target.value.replace(/\D/g, '');
          onChange?.(digitos === '' ? undefined : Number(digitos) / 100);
        }}
      />
    </div>
  );
}
