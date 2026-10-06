import { useEffect, useRef, type ReactNode } from 'react';
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
  action: () => void | boolean,
): { text: ReactNode; accelerator: string | null } {
  const reg = useShortcutRegistry();
  const { text, key, index } = parseMnemonic(label);
  const altDown = useAltPressed();
  // o vínculo fica estável (a ação de cada render pelo ref): re-vincular a cada render mudaria a ordem do escopo, que decide quem
  // leva a letra quando dois controles a dividem. A ação devolve false quando o controle não aceita (desabilitado / fora da tela).
  const ref = useRef(action);
  ref.current = action;

  useEffect(() => {
    if (!key) return;
    return reg.bind(`alt+${key}`, () => ref.current());
  }, [key, reg]);

  // Um ÚNICO <span> inline: o Button do DS usa flex com `gap`, então múltiplos
  // filhos (texto + <u> + texto) ganhariam espaço entre si ("P esquisar"). Um só
  // filho flex evita o gap e preserva o sublinhado do acelerador (com Alt).
  const node: ReactNode =
    key && index >= 0 ? (
      <span className="whitespace-pre">
        {text.slice(0, index)}
        <u className={altDown ? 'underline' : 'no-underline'}>{text[index]}</u>
        {text.slice(index + 1)}
      </span>
    ) : (
      text
    );

  return { text: node, accelerator: key ? `Alt+${key.toUpperCase()}` : null };
}

/** foca o controle do mnemônico (papel "campo"); sem ele na tela ou desabilitado, devolve false — a letra segue para o próximo
 *  controle (o `CanFocus` da VCL) */
export function focarMnemonico(el: HTMLElement | null | undefined): false | void {
  if (!el || el.matches(':disabled')) return false;
  el.focus();
}
