import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CotacaoPage } from '../src/features/cotacao/CotacaoPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const DETALHE = {
  codctc: 5, descricao: 'HORTIFRUTI', situacao: 'A', data: '2026-10-01T03:00:00.000Z', pedidos: null, liberada: 'S', empresas: ';1;2;',
  dtinicio_preenchimento: '2026-10-01T03:01:00.000Z', dtfim_preenchimento: '2026-10-03T02:59:00.000Z', produtos: [], fornecedores: [], precos: [],
};
let corpos: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  corpos = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    corpos.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    const r = /\/compras\/cotacao\/5$/.test(u) ? (init?.method === 'PUT' ? { codctc: 5 } : DETALHE)
      : u.endsWith('/compras/cotacao') ? [{ codctc: 5, descricao: 'HORTIFRUTI', situacao: 'A', data: '2026-10-01', pedidos: null }]
      : { linhas: [], total: 0 };
    return { ok: true, status: 200, json: async () => r };
  }) as any;
});
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShortcutScope><MensagemProvider><CotacaoPage /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const botao = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement;
const abrir = async () => {
  await waitFor(() => expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Abrir' || b.getAttribute('aria-label') === 'Abrir')).toBe(true));
  fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Abrir' || b.getAttribute('aria-label') === 'Abrir')!);
};

describe('Cotação (uCadCotacao.dfm) — o cabeçalho', () => {
  it('a nova cotação abre com a data de hoje, a janela de hoje 00:01 a 23:59 e as lojas; a cotação aberta mostra o cabeçalho gravado e as lojas só leitura', async () => {
    tela();
    expect((screen.getAllByLabelText('Hora início')[0] as HTMLInputElement).value).toBe('00:01');
    expect((screen.getAllByLabelText('Hora fim')[0] as HTMLInputElement).value).toBe('23:59');
    await abrir();
    await waitFor(() => expect(screen.getByText(/Cotação nº 5/)).toBeTruthy());
    expect((screen.getByLabelText('Empresas') as HTMLInputElement).value).toBe(';1;2;');
    expect((screen.getByLabelText('Empresas') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('checkbox', { name: /Liberar Cotação/ }).getAttribute('data-state')).toBe('checked');
  });

  it('a hora fim não passa da início: a mensagem do legado; com a janela certa grava só o cabeçalho', async () => {
    tela();
    await abrir();
    await waitFor(() => expect(screen.getByText(/Cotação nº 5/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Data fim'), { target: { value: '2026-09-01' } });
    fireEvent.click(botao('Salvar cabeçalho'));
    expect(await screen.findByText('Hora fim não pode ser MENOR ou IGUAL hora início.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
    fireEvent.change(screen.getByLabelText('Data fim'), { target: { value: '2026-10-05' } });
    fireEvent.change(screen.getByLabelText('Hora fim'), { target: { value: '18:00' } });
    fireEvent.click(botao('Salvar cabeçalho'));
    await waitFor(() => expect(corpos.some((c) => c.method === 'PUT')).toBe(true));
    const put = corpos.find((c) => c.method === 'PUT')!;
    expect(put.body).toMatchObject({ descricao: 'HORTIFRUTI', dtfim_preenchimento: '2026-10-05T18:00:00', liberada: 'S' });
    expect(put.body.produtos).toBeUndefined();
  });
});
