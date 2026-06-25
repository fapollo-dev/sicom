import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormScope } from '../src/shared/keyboard/FormScope';
import { useMnemonic } from '../src/shared/keyboard/useMnemonic';

function SaveButton({ onSave }: { onSave: () => void }) {
  const { text } = useMnemonic('&Salvar', onSave); // Alt+S
  return (
    <button type="button" onClick={onSave}>
      {text}
    </button>
  );
}

function TestForm({ onSave }: { onSave: () => void }) {
  return (
    <FormScope>
      <input aria-label="banco" />
      <input aria-label="cidade" />
      <SaveButton onSave={onSave} />
    </FormScope>
  );
}

describe('Camada de teclado (ADR-010)', () => {
  it('Enter avança do campo Banco para o campo Cidade (não submete)', async () => {
    const user = userEvent.setup();
    const { getByLabelText } = render(<TestForm onSave={() => {}} />);
    const banco = getByLabelText('banco') as HTMLInputElement;
    const cidade = getByLabelText('cidade') as HTMLInputElement;
    banco.focus();
    expect(document.activeElement).toBe(banco);
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(cidade);
  });

  it('Alt+S aciona o botão &Salvar (mnemônico)', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TestForm onSave={onSave} />);
    await user.keyboard('{Alt>}s{/Alt}');
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
