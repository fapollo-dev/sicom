import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OperadorasPage } from '../src/features/cartao/OperadorasPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const OPER = { codoperadoras: 7, operadora: 'CIELO CREDITO', txadm: 2.5, diascomp: 30, tipo: 'I', tipocartao: 2, ativo: 'S', txgestao: 0.3, txanuidade: 12,
  diafechamento: '10', obs: 'OBS', empresas: '1', pos: 'N', operadora_pdv: 'CIELO', codrede: 3, codbandeira: 1,
  itens: [{ idempresa: 1, txadm: 2.2, diafechamento: 5, txgestao: 0.1, txanuidade: 8, txantecipacao: 1.99 }] };
let corpos: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  corpos = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    corpos.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    const r = u.endsWith('/cadastro/operadoras/7/filhas') ? [{ codoperadoras: 70, operadora: 'CIELO FILHA', operadora_pdv: 'CIELOF', tipo: 'C', codrede: 3 }]
      : /\/cadastro\/operadoras\/7$/.test(u) ? OPER : u.endsWith('/cadastro/operadoras') ? [{ codoperadoras: 7, operadora: 'CIELO CREDITO', tipo: 'I' }] : { linhas: [], total: 0 };
    return { ok: true, status: 200, json: async () => r };
  }) as any;
});
const botao = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === t || b.getAttribute('aria-label') === t) as HTMLButtonElement;

describe('Operadoras de cartão (UcadOperadoras.dfm)', () => {
  it('abre com todos os campos do legado (o TIPO fora do combo se preserva, o grupo TEF, a taxa por loja com antecipação) e grava tudo', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ShortcutScope><MensagemProvider><OperadorasPage /></MensagemProvider></ShortcutScope></MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(botao('Abrir')).toBeTruthy());
    fireEvent.click(botao('Abrir'));
    await waitFor(() => expect((screen.getByLabelText('Operadora PDV') as HTMLInputElement).value).toBe('CIELO'));
    expect((screen.getByLabelText('Tipo') as HTMLSelectElement).value).toBe('I');
    expect((screen.getByLabelText('Dia Fechamento', { selector: 'input[maxlength="5"]' }) as HTMLInputElement).value).toBe('10');
    expect(screen.getByText('1.99')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Observações'), { target: { value: 'NOVA OBS' } });
    fireEvent.click(botao('Salvar'));
    await waitFor(() => expect(corpos.some((c) => c.method === 'PUT')).toBe(true));
    const put = corpos.find((c) => c.method === 'PUT')!.body;
    expect(put).toMatchObject({ obs: 'NOVA OBS', operadora_pdv: 'CIELO', codrede: 3, tipo: 'I', txgestao: 0.3, diafechamento: '10' });
    expect(put.itens[0]).toMatchObject({ idempresa: 1, txantecipacao: 1.99, txgestao: 0.1 });
  });

  it('a aba Operadoras Assossiadas lista as que têm esta como base; a taxa da mesma empresa não entra de novo, mas a linha em edição se substitui', async () => {
    window.alert = vi.fn() as any;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ShortcutScope><MensagemProvider><OperadorasPage /></MensagemProvider></ShortcutScope></MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(botao('Abrir')).toBeTruthy());
    fireEvent.click(botao('Abrir'));
    expect(await screen.findByText('CIELO FILHA')).toBeTruthy();
    expect(screen.getByLabelText('Operadoras Assossiadas').textContent).toContain('CIELOF');
    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: '1' } });
    fireEvent.click(botao('Inserir'));
    expect(window.alert).toHaveBeenCalledWith('Empresa já cadastrada para essa operadora.');
    fireEvent.click(botao('Editar'));
    fireEvent.change(screen.getByLabelText('Taxa Antecipação'), { target: { value: '2.5' } });
    fireEvent.blur(screen.getByLabelText('Taxa Antecipação'));
    // o Salvar da aba Taxas (o do cadastro vem antes)
    fireEvent.click([...document.querySelectorAll('button')].filter((b) => b.textContent === 'Salvar').pop()!);
    expect(screen.getByLabelText('Taxas por empresa').textContent).toContain('2.50');
    expect(screen.getByLabelText('Taxas por empresa').querySelectorAll('tbody tr').length).toBe(1);
  });

  it('na inclusão, a Operadora PDV vazia herda o nome ao sair do campo (edtOperadoraExit)', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ShortcutScope><MensagemProvider><OperadorasPage /></MensagemProvider></ShortcutScope></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await waitFor(() => botao('Nova operadora')));
    const nome = screen.getByLabelText('Nome da Operadora');
    fireEvent.change(nome, { target: { value: 'GOODCARD' } });
    fireEvent.blur(nome);
    expect((screen.getByLabelText('Operadora PDV') as HTMLInputElement).value).toBe('GOODCARD');
  });
});
