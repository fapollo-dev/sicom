import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PromocaoAcumulativaPage } from '../src/features/promocao-acumulativa/PromocaoAcumulativaPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';
import { hojeNaLoja } from '../src/shared/tempo';

let urls: string[] = [];
beforeEach(() => {
  urls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url); urls.push(u);
    if (u.includes('/promocao-acumulativa/produto/10')) return { ok: true, status: 200, json: async () => ({ idproduto: 10, codbarra: '789100', descricao: 'ARROZ 5KG', cod_grupopreco: 7, grupo_preco: 'ARROZES' }) };
    if (u.includes('/promocao-acumulativa/produto/99')) return { ok: false, status: 422, json: async () => ({ statusCode: 422, code: 'PRODUTO_INATIVO_OU_INEXISTENTE', message: 'Produto nao encontrado!' }) };
    if (u.includes('/registros-log')) return { ok: true, status: 200, json: async () => ({ linhas: [] }) };
    return { ok: true, status: 200, json: async () => [] };
  }) as any;
});
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShortcutScope><MensagemProvider><PromocaoAcumulativaPage /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);

describe('Promoção acumulativa (uCadPromocaoAcumulativa.dfm) — o formulário', () => {
  it('abre em hoje 05:00–23:59; o exit do produto mostra código de barras, descrição e grupo de preço e libera o "Grupo Preço"', async () => {
    tela();
    expect((screen.getByLabelText('Início (data e hora)') as HTMLInputElement).value).toBe(`${hojeNaLoja()}T05:00`);
    expect((screen.getByLabelText('Término (data e hora)') as HTMLInputElement).value).toBe(`${hojeNaLoja()}T23:59`);
    const grupo = screen.getByLabelText('Grupo Preço') as HTMLInputElement;
    expect(grupo.disabled).toBe(true);
    const prod = screen.getByLabelText('Produto');
    fireEvent.change(prod, { target: { value: '10' } });
    fireEvent.blur(prod);
    await waitFor(() => expect((screen.getByLabelText('Descrição') as HTMLInputElement).value).toBe('ARROZ 5KG'));
    expect((screen.getByLabelText('Código de barra') as HTMLInputElement).value).toBe('789100');
    expect((screen.getByLabelText('Descrição do Grupo de Preço') as HTMLInputElement).value).toBe('ARROZES');
    expect(grupo.disabled).toBe(false);
  });

  it('o produto inexistente avisa "Produto nao encontrado!" e limpa; o Histórico abre os registros de log das exclusões', async () => {
    tela();
    const prod = screen.getByLabelText('Produto') as HTMLInputElement;
    fireEvent.change(prod, { target: { value: '99' } });
    fireEvent.blur(prod);
    expect(await screen.findByText('Produto nao encontrado!')).toBeTruthy();
    await waitFor(() => expect(prod.value).toBe(''));
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Histórico')!);
    await waitFor(() => expect(urls.some((u) => u.includes('/registros-log?') && u.includes('acao=Excluiu') && u.includes('chave=IDPROACUMULATIVA'))).toBe(true));
  });
});
