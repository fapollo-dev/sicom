import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PromocaoCadMaster } from '../src/features/promocao/PromocaoCadMaster';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const LISTA = [{ idpromocao: 5, descricao: 'COMPRA PREMIADA', tipo: 'T', datainicio: '2023-08-11T08:00:00.000Z', datafim: '2023-08-12T02:59:00.000Z', qtde_itens: 1 },
  { idpromocao: 6, descricao: 'PRECO FIXO X', tipo: 'P', datainicio: '2028-05-01T11:00:00.000Z', datafim: '2028-05-11T01:00:00.000Z', qtde_itens: 1 }];
const PROMOS: Record<number, unknown> = {
  5: { idpromocao: 5, descricao: 'COMPRA PREMIADA', tipo: 'T', opcao: 'O', destino: 'T', empresas: '1', datainicio: '2023-08-11T08:00:00.000Z', datafim: '2023-08-12T02:59:00.000Z',
    itens: [{ idclubedesconto: 1148, origem: 'T ', operacao: 'DESCONTO_POR_PDV', pdv: 72, minimo: 90, maximo: 160 }] },
  6: { idpromocao: 6, descricao: 'PRECO FIXO X', tipo: 'P', opcao: 'V', destino: 'C', empresas: '1', datainicio: '2028-05-01T11:00:00.000Z', datafim: '2028-05-11T01:00:00.000Z',
    itens: [{ idclubedesconto: 9, origem: 'P', idorigempromocao: 1, valor: 3.99, quantidade: 1, descricao: 'ARROZ 5KG' }] },
};
let chamadas: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  chamadas = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url); const method = init?.method ?? 'GET';
    chamadas.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    const m = u.match(/\/cadastro\/promocao\/(\d+)$/);
    const r = m && method === 'GET' ? PROMOS[Number(m[1])] : u.includes('/cadastro/promocao') && method === 'GET' ? LISTA : {};
    return { ok: true, status: 200, json: async () => r };
  }) as any;
});
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShortcutScope><MensagemProvider><PromocaoCadMaster /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const acao = (linha: string, nome: string) => {
  const tr = (screen.getByText(linha).closest('tr') ?? screen.getByText(linha).closest('[role="row"]'))!;
  fireEvent.click([...tr.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === nome || b.textContent === nome)!);
};
const botao = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement;

describe('Gestão de promoções (UCadPromocao.dfm) — abrir, alterar e o cabeçalho do legado', () => {
  it('abre a promoção gravada (cabeçalho e itens; com itens o cabeçalho trava) e o Gravar altera (PUT) com a Opção', async () => {
    tela();
    expect(await screen.findByText('PRECO FIXO X')).toBeTruthy();
    acao('PRECO FIXO X', 'Abrir');
    await waitFor(() => expect((screen.getByLabelText('Descrição') as HTMLInputElement).value).toBe('PRECO FIXO X'));
    expect(screen.getByText('Promoção nº 6')).toBeTruthy();
    expect((screen.getByLabelText('Início (data e hora)') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText(/ARROZ 5KG/).length).toBeGreaterThan(0);
    fireEvent.click(botao('Gravar promoção'));
    await waitFor(() => expect(chamadas.some((c) => c.method === 'PUT')).toBe(true));
    const put = chamadas.find((c) => c.method === 'PUT')!;
    expect(put.url).toMatch(/\/cadastro\/promocao\/6$/);
    expect(put.body).toMatchObject({ descricao: 'PRECO FIXO X', tipo: 'P', opcao: 'V', destino: 'C' });
    expect(put.body.itens).toHaveLength(1);
  });

  it("o tipo 'T' do binário novo abre e regrava só o cabeçalho (sem a chave de itens); sem Opção o gravar avisa como o legado", async () => {
    tela();
    expect(await screen.findByText('COMPRA PREMIADA')).toBeTruthy();
    acao('COMPRA PREMIADA', 'Abrir');
    await waitFor(() => expect((screen.getByLabelText('Descrição') as HTMLInputElement).value).toBe('COMPRA PREMIADA'));
    fireEvent.click(botao('Gravar promoção'));
    await waitFor(() => expect(chamadas.some((c) => c.method === 'PUT')).toBe(true));
    const put = chamadas.find((c) => c.method === 'PUT')!;
    expect(put.body.tipo).toBe('T');
    expect('itens' in put.body).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: /ok/i }));
    // nova: datas e descrição, sem Opção
    fireEvent.change(screen.getByLabelText('Início (data e hora)'), { target: { value: '2030-01-01T05:00' } });
    fireEvent.change(screen.getByLabelText('Fim (data e hora)'), { target: { value: '2030-01-02T23:59' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'NOVA' } });
    fireEvent.click(botao('Gravar promoção'));
    expect(await screen.findByText('Informe uma opção para a promoção.')).toBeTruthy();
  });
});
