import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppLayout } from '../src/app/AppLayout';
import { useMnemonic } from '../src/shared/keyboard/useMnemonic';

/**
 * Regressão: telas CUSTOMIZADAS (DRE, Plano de Contas, Caixa) não passam pelo <CadMaster> e usam
 * Button/DateField/etc. via useMnemonic, que EXIGE um <ShortcutScope>. O AppLayout precisa prover um
 * scope BASE em volta do <Outlet> — senão essas rotas quebram no render ("useShortcut* fora de
 * <ShortcutScope>"). Este teste falha se o ShortcutScope do AppLayout for removido.
 */
function MnemonicProbe() {
  const { text } = useMnemonic('&Gerar', () => {}); // Alt+G — dispara useShortcutRegistry()
  return <button type="button">{text}</button>;
}

describe('AppLayout — scope de atalhos base (ADR-010)', () => {
  it('provê <ShortcutScope> p/ rotas customizadas: componente com useMnemonic renderiza sem lançar', () => {
    const router = createMemoryRouter(
      [{ element: <AppLayout />, children: [{ path: '/', element: <MnemonicProbe /> }] }],
      { initialEntries: ['/'] },
    );
    expect(() => render(<RouterProvider router={router} />)).not.toThrow();
  });

  it('sem scope, o mesmo componente lança (garante que o teste acima é significativo)', () => {
    // silencia o console.error do React ao capturar o throw de render
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<MnemonicProbe />)).toThrow(/ShortcutScope/);
    spy.mockRestore();
  });
});
