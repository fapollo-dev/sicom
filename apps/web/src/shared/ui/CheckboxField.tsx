import { useId } from 'react';
import { useMnemonic } from '../keyboard/useMnemonic';
import { parseMnemonic } from '../keyboard/parseMnemonic';

type Props = {
  label: string; // & → Alt+letra alterna a flag (ADR-010)
  /** flag do legado: 'S' = marcado, qualquer outra (ou null) = desmarcado */
  value?: string;
  onChange?: (v: 'S' | 'N') => void;
  disabled?: boolean;
};

/**
 * Campo booleano (TDBCheckBox → Checkbox, recon §5c). Mapeia o checkbox para a
 * flag char 'S'/'N' do legado (business-rule-extraction: flags 'S'/'N' viram boolean).
 * Alt+letra alterna a marca.
 */
export function CheckboxField({ label, value, onChange, disabled }: Props) {
  const id = useId();
  const checked = value === 'S';
  const toggle = () => onChange?.(checked ? 'N' : 'S');
  useMnemonic(label, () => {
    if (!disabled) toggle();
  });
  const clean = parseMnemonic(label).text;
  return (
    <label htmlFor={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer' }}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={toggle}
        style={{ width: 16, height: 16 }}
      />
      <span>{clean}</span>
    </label>
  );
}
