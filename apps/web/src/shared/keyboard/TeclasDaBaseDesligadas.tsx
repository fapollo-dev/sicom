import type { ReactNode } from 'react';
import { ShortcutScope, useShortcut } from './ShortcutScope';

/**
 * A tela cujo `FormKeyDown`/`FormKeyPress` NÃO chama o `inherited` (o `//inherited;` comentado no fonte — ex.: UConfigDREContabil,
 * uCadPlanoContas): nela as teclas do `TfrmMaster` não valem — o Esc não fecha, o Ctrl+E não troca de empresa, o Alt+← não volta e o
 * Enter não avança. ADR-010: replicar o mapa do legado, não modernizar.
 *
 * Envolve o conteúdo da tela: um escopo interno engole as teclas antes de chegarem à base, e o `data-enter="nativo"` desliga o
 * Enter-avança. As teclas próprias da tela continuam valendo; janelas abertas por cima tratam o Esc delas antes (na captura).
 */
export function TeclasDaBaseDesligadas({ children }: { children: ReactNode }) {
  return (
    <ShortcutScope>
      <EngoleTeclasDaBase />
      <div data-enter="nativo" className="contents">{children}</div>
    </ShortcutScope>
  );
}

function EngoleTeclasDaBase() {
  const engole = () => undefined;
  useShortcut('escape', engole);
  useShortcut('ctrl+e', engole);
  useShortcut('alt+arrowleft', engole);
  return null;
}
