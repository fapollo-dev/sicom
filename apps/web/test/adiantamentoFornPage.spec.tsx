import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdiantamentoFornPage } from '../src/features/adiantamento-forn/AdiantamentoFornPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

let urls: string[] = [];
beforeEach(() => {
  urls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    urls.push(u);
    const corpo = u.endsWith('/situacoes') ? [{ idsituacao_nf: 5, descricao: 'ADIANTAMENTO', tipo_operacao: 'F20', tipo: 'D' }]
      : u.endsWith('/contas') ? [{ codconta: 1, titular: 'CAIXA', saldo: 10 }]
      : u.includes('/cadastro/pesquisa') ? { linhas: [{ codparceiro: 22, razao: 'FORNECEDOR 22' }], total: 1 }
      : [];
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShortcutScope><MensagemProvider><AdiantamentoFornPage /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);

describe('Adiantamento de fornecedor (uCadAdiantamentoFornecedor.dfm)', () => {
  it('o parceiro é escolhido pela Pesquisa (edtCodFornecedor + F3) com a razão ao lado; o Tipo do legado aparece somente leitura', async () => {
    tela();
    await waitFor(() => expect(urls.some((u) => u.endsWith('/situacoes'))).toBe(true));
    expect(screen.getByLabelText(/Parceiro/)).toBeTruthy();
    expect(screen.getAllByLabelText('Tipo').some((e) => e.tagName === 'INPUT' && (e as HTMLInputElement).disabled)).toBe(true);
  });
});
