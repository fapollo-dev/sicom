import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AjustePrecosPage, consultaDaFila } from '../src/features/ajuste-precos/AjustePrecosPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const LOTES = [
  { codlotepreco: 501, idproduto: 9, codempresa: 2, vrvenda: 6.49, markup: 40, promocao: 'S', vrpromo: 5.99, alteroupromocao: 'S', datalote: '2026-10-14',
    obs: 'REFERENTE AO PEDIDO DE NRO. 77 ', codbarra: '7890000000009', descricao: 'CAFE 500G', codgrupopreco: 12, preco_atual: 5, vrcusto: 4 },
];
let opcoes: string[] = [];
let urls: string[] = [];
beforeEach(() => {
  urls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    urls.push(u);
    const corpo = u.includes('/acesso/opcoes/') ? { opcoes } : u.includes('/ajuste-precos/fila') ? LOTES : {};
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShortcutScope><MensagemProvider><AjustePrecosPage /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const botao = (texto: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === texto) as HTMLButtonElement;

describe('Ajuste de preços - lote (uAjustePrecos.dfm) — o Pesquisar do legado', () => {
  it('as caixas de origem viram os parâmetros do sqqAjustePrecos: cadastro + pedido juntas (OU no servidor), nota fiscal, e as lojas', () => {
    expect(consultaDaFila({ dtini: '2026-10-01', dtfim: '2026-10-15', empresas: '', cadastro: false, pedido: false, nf: false }))
      .toBe('/cadastro/ajuste-precos/fila?dtini=2026-10-01&dtfim=2026-10-15');
    expect(consultaDaFila({ dtini: '2026-10-01', dtfim: '2026-10-15', empresas: '1, 2', cadastro: true, pedido: true, nf: true }))
      .toBe('/cadastro/ajuste-precos/fila?dtini=2026-10-01&dtfim=2026-10-15&empresas=1%2C2&cadastro=S&pedido=S&nf=S');
  });

  it('não consulta sem o período; com ele traz a grade com as colunas do legado (Loja, Lot. Preço, Grupo Preço, promoção)', async () => {
    opcoes = [];
    tela();
    expect(screen.getByText('Informe o período e clique em Pesquisar.')).toBeTruthy();
    fireEvent.click(botao('Pesquisar'));
    expect(await screen.findByText('Informe o período: data inicial e data final.')).toBeTruthy();
    expect(urls.some((u) => u.includes('/fila'))).toBe(false);
  });

  it('com o período e "referentes a pedidos", pesquisa; o Excluir só com BTNEXCLUIR (Tag 1) e o Processar com o acesso', async () => {
    opcoes = [];
    tela();
    fireEvent.change(screen.getByLabelText(/Data inicial/), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText(/Data final/), { target: { value: '2026-10-15' } });
    fireEvent.click(screen.getByLabelText('Trazer somente alterações referentes a pedidos'));
    fireEvent.click(botao('Pesquisar'));
    expect(await screen.findByText('CAFE 500G')).toBeTruthy();
    expect(urls.find((u) => u.includes('/fila'))).toContain('dtini=2026-10-01&dtfim=2026-10-15&pedido=S');
    expect(screen.getByText('REFERENTE AO PEDIDO DE NRO. 77')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Marcar lote 501'));
    expect(botao('Processar').disabled).toBe(false);
    expect(botao('Excluir').disabled).toBe(true);
  });

  it('com BTNEXCLUIR o Excluir habilita para os marcados', async () => {
    opcoes = ['BTNEXCLUIR'];
    tela();
    fireEvent.change(screen.getByLabelText(/Data inicial/), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText(/Data final/), { target: { value: '2026-10-15' } });
    fireEvent.click(botao('Pesquisar'));
    await screen.findByText('CAFE 500G');
    fireEvent.click(screen.getByLabelText('Marcar lote 501'));
    await waitFor(() => expect(botao('Excluir').disabled).toBe(false));
  });
});
