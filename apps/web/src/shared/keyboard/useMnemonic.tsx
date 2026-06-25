import { useEffect, type ReactNode } from 'react';
import { parseMnemonic } from './parseMnemonic';
import { useShortcutRegistry } from './ShortcutScope';
import { useAltPressed } from './useAltPressed';

/**
 * Registra Alt+letra de um caption com `&` e devolve o texto já com a letra
 * sublinhada para render. Dois papéis (ADR-010):
 *  - ação  (botão/menu): Alt+letra ACIONA;
 *  - campo (label+input): Alt+letra FOCA o input.
 */
export function useMnemonic(
  label: string,
  action: () => void,
): { text: ReactNode; accelerator: string | null } {
  const reg = useShortcutRegistry();
  const { text, key, index } = parseMnemonic(label);
  const altDown = useAltPressed();

  useEffect(() => {
    if (!key) return;
    return reg.bind(`alt+${key}`, () => action());
  }, [key, action, reg]);

  // Um ÚNICO <span> inline: o Button do DS usa flex com `gap`, então múltiplos
  // filhos (texto + <u> + texto) ganhariam espaço entre si ("P esquisar"). Um só
  // filho flex evita o gap e preserva o sublinhado do acelerador (com Alt).
  const node: ReactNode =
    key && index >= 0 ? (
      <span style={{ whiteSpace: 'pre' }}>
        {text.slice(0, index)}
        <u style={{ textDecoration: altDown ? 'underline' : 'none' }}>{text[index]}</u>
        {text.slice(index + 1)}
      </span>
    ) : (
      text
    );

  return { text: node, accelerator: key ? `Alt+${key.toUpperCase()}` : null };
}
