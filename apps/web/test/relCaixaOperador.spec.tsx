import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RelCaixaPage } from '../src/features/rel-caixa/RelCaixaPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

let urls: string[] = [];
beforeEach(() => {
  urls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    urls.push(u);
    const corpo = u.includes('/rel-caixa/opcoes') ? { recursos: ['DINHEIRO'], modelos: { DIVERGENCIAS: { indice: 0, niveis: 2, niveisPadrao: 2 }, VOUCHER: { indice: 1, niveis: 0, niveisPadrao: 0 }, APURACAO: { indice: 2, niveis: 2, niveisPadrao: 1 }, ABERTOS: { indice: 3, niveis: 0, niveisPadrao: 0 }, PEDIDOS: { indice: 4, niveis: 0, niveisPadrao: 0 } } }
      : u.includes('/cadastro/pesquisa') && u.includes('lookup%2Foperadores') ? { linhas: [{ codigo: 7, nome: 'MARIA CAIXA' }], total: 1 }
      : u.includes('/rel-caixa?') ? { modelo: 'DIVERGENCIAS', relatorio: [], auxiliar: [], resumoApuracao: [], resumoCC: [] }
      : {};
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});

describe('Relatórios de caixa (URelCaixa.dfm) — o operador', () => {
  it('o Operador é o EdtCodOperador com a Pesquisa de OPERADORES: digitar o código mostra o nome e o filtro vai na consulta', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ShortcutScope><MensagemProvider><RelCaixaPage /></MensagemProvider></ShortcutScope></MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(urls.some((u) => u.includes('/rel-caixa/opcoes'))).toBe(true));
    const op = screen.getByLabelText(/Operador/) as HTMLInputElement;
    fireEvent.change(op, { target: { value: '7' } });
    fireEvent.blur(op);
    expect(await screen.findByText('MARIA CAIXA')).toBeTruthy();
    fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Gerar')!);
    await waitFor(() => expect(urls.some((u) => u.includes('/rel-caixa?') && u.includes('codoperador=7'))).toBe(true));
  });
});
