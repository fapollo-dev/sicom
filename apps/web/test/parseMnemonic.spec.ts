import { describe, it, expect } from 'vitest';
import { parseMnemonic } from '../src/shared/keyboard/parseMnemonic';

describe('parseMnemonic (& estilo Delphi/VCL — ADR-010)', () => {
  it('&Salvar → letra S no índice 0', () => {
    expect(parseMnemonic('&Salvar')).toEqual({ text: 'Salvar', key: 's', index: 0 });
  });
  it('E&xcluir → letra x no índice 1', () => {
    expect(parseMnemonic('E&xcluir')).toEqual({ text: 'Excluir', key: 'x', index: 1 });
  });
  it('&& vira & literal e não é mnemônico', () => {
    expect(parseMnemonic('Lucros && Perdas')).toEqual({
      text: 'Lucros & Perdas',
      key: null,
      index: -1,
    });
  });
  it('sem & → sem mnemônico', () => {
    expect(parseMnemonic('Cidade')).toEqual({ text: 'Cidade', key: null, index: -1 });
  });
  it('primeiro & ganha quando há vários', () => {
    expect(parseMnemonic('&Gravar e &Sair')).toMatchObject({ key: 'g', index: 0 });
  });
});
