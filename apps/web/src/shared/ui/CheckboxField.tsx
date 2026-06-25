import { FormFieldCheckbox } from '@apollosg/design-system';
import { useMnemonic } from '../keyboard/useMnemonic';

type Props = {
  label: string; // & → Alt+letra alterna a flag (ADR-010)
  /** flag do legado: 'S' = marcado, qualquer outra (ou null) = desmarcado */
  value?: string;
  onChange?: (v: 'S' | 'N') => void;
  disabled?: boolean;
};

/**
 * Campo booleano (TDBCheckBox → Checkbox, recon §5c) usando o **FormFieldCheckbox do DS**
 * (L-023/L-025: nada de <input>/<label> cru). Mapeia o checkbox para a flag char 'S'/'N'
 * do legado. Alt+letra alterna a marca (camada de teclado ADR-010).
 */
export function CheckboxField({ label, value, onChange, disabled }: Props) {
  const checked = value === 'S';
  const { text } = useMnemonic(label, () => {
    if (!disabled) onChange?.(checked ? 'N' : 'S');
  });
  return (
    <FormFieldCheckbox
      label={text}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(c) => onChange?.(c ? 'S' : 'N')}
    />
  );
}
