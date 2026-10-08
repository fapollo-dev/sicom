import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// a Pesquisa de verdade busca no servidor: aqui ela devolve os marcados de uma vez (o OK da multisseleção)
vi.mock('../src/shared/cadmaster/Pesquisa', () => ({
  Pesquisa: ({ onSelecionarVarios }: { onSelecionarVarios: (l: Array<Record<string, unknown>>) => void }) => (
    <button type="button" onClick={() => onSelecionarVarios([
      { codigo: 101, descricao: 'CAFE 500G' }, { codigo: 102, descricao: 'ACUCAR 1KG' }, { codigo: 101, descricao: 'CAFE 500G' },
    ])}>marcar e OK</button>
  ),
}));

import { PromocaoCadMaster } from '../src/features/promocao/PromocaoCadMaster';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async () => ({ ok: true, status: 200, json: async () => [] })) as any;
});

describe('Gestão de promoções — o Adicionar em lote e a grade editável (UCadPromocao.pas:901-947, CarregarItens :1638-1673)', () => {
  it('cada marcado entra uma vez com valor 0; o Gravar barra com a mensagem do legado até a grade ter o valor', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ShortcutScope><MensagemProvider><PromocaoCadMaster /></MensagemProvider></ShortcutScope></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Vários produtos…' }));
    fireEvent.click(screen.getByRole('button', { name: 'marcar e OK' }));
    expect(await screen.findByText('101 - CAFE 500G')).toBeTruthy();
    expect(screen.getByText('102 - ACUCAR 1KG')).toBeTruthy();
    expect(screen.getAllByText(/^R\$\s0,00$/).length).toBe(2);

    fireEvent.change(screen.getByLabelText(/Descrição/), { target: { value: 'PROMO LOTE' } });
    fireEvent.click(screen.getAllByRole('button').find((b) => /Gravar/.test(b.textContent ?? ''))!);
    expect(await screen.findByText(/O valor do desconto Deve ser Informada\./)).toBeTruthy();
    expect((global.fetch as any).mock.calls.some(([, init]: [string, RequestInit?]) => init?.method === 'POST')).toBe(false);

    // a grade editável: duplo clique no valor do café, 9,90 + Enter
    fireEvent.doubleClick(screen.getAllByText(/^R\$\s0,00$/)[0]);
    const editor = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[role="row"] input[type="number"], [role="row"] input[inputmode="decimal"], [role="gridcell"] input');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.change(editor, { target: { value: '9.9' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(await screen.findByText(/^R\$\s9,90$/)).toBeTruthy();
  });
});
