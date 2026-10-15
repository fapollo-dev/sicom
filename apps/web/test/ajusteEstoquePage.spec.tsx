import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AjusteEstoquePage } from '../src/features/ajuste-estoque/AjusteEstoquePage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

let opcoes: string[] = [];
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const corpo = u.includes('/acesso/opcoes/') ? { opcoes }
      : u.includes('/motivos') ? [{ codmotivo: 1, descricao: 'AJUSTE' }]
      : u.includes('/ajuste-estoque') ? []
      : [];
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShortcutScope><MensagemProvider><AjusteEstoquePage /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const botao = (texto: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === texto) as HTMLButtonElement | undefined;

describe('Ajuste de estoque (UajusteEstoque.dfm) — o "Ajustar" tem Tag 1 (BTNOK)', () => {
  it('sem BTNOK o Ajustar fica desabilitado', async () => {
    opcoes = [];
    tela();
    await waitFor(() => expect((global.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes('/acesso/opcoes/FRMAJUSTEESTOQUE'))).toBe(true));
    expect(botao('Ajustar')?.disabled).toBe(true);
  });
  it('com BTNOK o Ajustar habilita; o Histórico tem o Exportar', async () => {
    opcoes = ['BTNOK'];
    tela();
    await waitFor(() => expect(botao('Ajustar')?.disabled).toBe(false));
    expect(botao('Exportar')).toBeTruthy();
  });
});
