import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { CadMaster } from '../src/shared/cadmaster/CadMaster';

const schema = z.object({ nome: z.string().optional() });

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }) as any;
});

describe('CadMaster — menu "Outros" (btnOutros/ppmBotaoOutros do form-base)', () => {
  it('sem outros: não renderiza o botão Outros', () => {
    render(
      wrap(
        <CadMaster<any>
          titulo="T"
          resourcePath="t/x"
          pk="id"
          schema={schema}
          defaultValues={{ nome: '' }}
          campos={({ form }) => <input aria-label="nome" {...form.register('nome')} />}
        />,
      ),
    );
    const temOutros = screen.getAllByRole('button').some((b) => /outros/i.test(b.textContent || ''));
    expect(temOutros).toBe(false);
  });

  it('com outros: abre o menu e dispara a ação', () => {
    const acao = vi.fn();
    render(
      wrap(
        <CadMaster<any>
          titulo="T"
          resourcePath="t/x"
          pk="id"
          schema={schema}
          defaultValues={{ nome: '' }}
          outros={[{ label: '&Relatório', onClick: acao }]}
          campos={({ form }) => <input aria-label="nome" {...form.register('nome')} />}
        />,
      ),
    );
    const botao = (re: RegExp) =>
      screen.getAllByRole('button').find((b) => re.test((b.textContent || '').trim()))!;
    // menu fechado inicialmente
    expect(screen.queryByRole('menu')).toBeNull();
    // abre via clique no Outros (o mesmo onClick que o Alt+O aciona)
    fireEvent.click(botao(/^Outros$/));
    expect(screen.getByRole('menu', { name: 'Outros' })).toBeTruthy();
    // dispara a ação e fecha
    fireEvent.click(screen.getByRole('menuitem'));
    expect(acao).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
