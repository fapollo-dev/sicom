import { Button as DSButton } from '@apollosg/design-system';
import { useMnemonic } from '../keyboard/useMnemonic';

type Props = {
  label: string; // pode conter & (mnemônico) — Alt+letra ACIONA o botão (ADR-010)
  onClick?: () => void;
  variant?: 'filled' | 'outline' | 'soft' | 'ghost'; // variantes do Apollo DS
  type?: 'button' | 'submit';
  disabled?: boolean;
};

/**
 * Botão do app: usa o `Button` do Apollo DS + a camada de teclado por cima
 * (mnemônico `&` via Alt+letra). A fronteira ADR-014 é respeitada — o visual
 * vem do DS; o comportamento de teclado é do app. `disabled` bloqueia o clique E o mnemônico.
 */
export function Button({ label, onClick, variant = 'filled', type = 'button', disabled = false }: Props) {
  const { text } = useMnemonic(label, () => {
    if (!disabled) onClick?.();
  });
  return (
    <DSButton variant={variant} type={type} onClick={onClick} disabled={disabled}>
      {text}
    </DSButton>
  );
}
