import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MensagemProvider, useMensagem } from '../src/shared/mensagem';

/** Filho que dispara um erro com o envelope padrão (ADR-015) ao clicar. */
function DisparaErro() {
  const { erro } = useMensagem();
  return (
    <button
      onClick={() =>
        erro({
          envelope: {
            statusCode: 400,
            code: 'VALIDACAO',
            message: 'Há campos inválidos.',
            campos: [{ campo: 'descricao', mensagem: 'Descrição é obrigatória' }],
          },
        })
      }
    >
      disparar
    </button>
  );
}

describe('MensagemProvider — exibição padronizada de erros (ADR-015)', () => {
  it('mostra a message e a mensagem do campo do envelope no modal', () => {
    render(
      <MensagemProvider>
        <DisparaErro />
      </MensagemProvider>,
    );

    // modal fechado inicialmente
    expect(screen.queryByText('Há campos inválidos.')).toBeNull();

    fireEvent.click(screen.getByText('disparar'));

    // message (PT) aparece
    expect(screen.getByText('Há campos inválidos.')).toBeTruthy();
    // campo organizado: {campo}: {mensagem}
    expect(screen.getByText('descricao')).toBeTruthy();
    expect(screen.getByText(/Descrição é obrigatória/)).toBeTruthy();
  });

  it('useMensagem é seguro FORA do provider (no-op, não quebra)', () => {
    // renderiza o filho SEM o MensagemProvider — não deve lançar
    expect(() =>
      render(<DisparaErro />),
    ).not.toThrow();
    // clicar também não quebra (cai no no-op com console.warn)
    expect(() => fireEvent.click(screen.getByText('disparar'))).not.toThrow();
  });
});
