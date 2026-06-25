import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pesquisa } from '../src/shared/cadmaster/Pesquisa';

const COLUNAS = [
  { campo: 'codigo', label: 'Código' },
  { campo: 'descricao', label: 'Descrição' },
];

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [
      { codigo: 1, descricao: 'NESTLE' },
      { codigo: 2, descricao: 'UNILEVER' },
    ],
  }) as any;
});

describe('Pesquisa — teclado (núcleo do frmPesquisa)', () => {
  it('↓ navega e Enter seleciona a linha destacada', async () => {
    const user = userEvent.setup();
    const onSel = vi.fn();
    render(<Pesquisa resourcePath="cadastro/marcas" colunas={COLUNAS} onSelecionar={onSel} onFechar={() => {}} />);
    await waitFor(() => screen.getByText('NESTLE'));
    screen.getByRole('dialog').focus();
    await user.keyboard('{ArrowDown}{Enter}'); // sel 0→1 → seleciona UNILEVER
    expect(onSel).toHaveBeenCalledWith(expect.objectContaining({ descricao: 'UNILEVER' }));
  });

  it('Esc fecha', async () => {
    const user = userEvent.setup();
    const onFechar = vi.fn();
    render(<Pesquisa resourcePath="cadastro/marcas" colunas={COLUNAS} onSelecionar={() => {}} onFechar={onFechar} />);
    await waitFor(() => screen.getByText('NESTLE'));
    screen.getByRole('dialog').focus();
    await user.keyboard('{Escape}');
    expect(onFechar).toHaveBeenCalled();
  });

  it('F6 cicla a situação (rdgAtivo) e refaz a busca: ativos→inativos→todos', async () => {
    const user = userEvent.setup();
    render(<Pesquisa resourcePath="cadastro/marcas" colunas={COLUNAS} onSelecionar={() => {}} onFechar={() => {}} />);
    await waitFor(() => screen.getByText('NESTLE'));
    const calls = () => (global.fetch as any).mock.calls.map((c: any[]) => String(c[0]));

    // busca inicial → situacao=ativos
    expect(calls().some((u: string) => u.includes('situacao=ativos'))).toBe(true);

    screen.getByRole('dialog').focus();
    await user.keyboard('{F6}'); // ativos → inativos
    await waitFor(() => expect(calls().some((u: string) => u.includes('situacao=inativos'))).toBe(true));

    await user.keyboard('{F6}'); // inativos → todos
    await waitFor(() => expect(calls().some((u: string) => u.includes('situacao=todos'))).toBe(true));
  });
});
