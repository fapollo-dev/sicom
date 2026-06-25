import { useId } from 'react';
import { FormFieldSelect } from '@apollosg/design-system';
import { useMnemonic } from '../keyboard/useMnemonic';
import { parseMnemonic } from '../keyboard/parseMnemonic';

type Option = { value: string; label: string };

type Props = {
  label: string; // & → Alt+letra abre/foca o select (ADR-010)
  value?: string;
  onChange?: (v: string) => void;
  options: readonly Option[];
  placeholder?: string;
  error?: string;
};

/**
 * Campo de lista fixa (combo) do app: usa `FormFieldSelect` do Apollo DS + a camada
 * de teclado. Novo tipo de campo introduzido pela 2ª tela (Operações de Conta, TIPO).
 */
export function SelectField({ label, value, onChange, options, placeholder, error }: Props) {
  const id = useId();
  useMnemonic(label, () =>
    document.getElementById(id)?.querySelector<HTMLElement>('button,[role=combobox]')?.focus(),
  );
  const clean = parseMnemonic(label).text;
  return (
    <div id={id}>
      <FormFieldSelect
        label={clean}
        options={options as Option[]}
        placeholder={placeholder}
        value={value}
        onValueChange={onChange}
        state={error ? 'error' : 'default'}
        errorMessage={error}
      />
    </div>
  );
}
