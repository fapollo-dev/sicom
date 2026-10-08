import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CartaoPage } from '../src/features/cartao/CartaoPage';
import { ShortcutScope } from '../src/shared/keyboard';

// a Pesquisa da GET_CARTAO (rel_get_cartao): CODIGO = CODVENDCARTAO, DATA = a data da venda
const META = {
  titulo: 'Cartões a baixar', view: 'GET_CARTAO',
  colunas: [
    { campo: 'codigo', titulo: 'Codigo', tipo: 'numero' },
    { campo: 'data', titulo: 'Data', tipo: 'data' },
    { campo: 'operadora', titulo: 'Operadora', tipo: 'texto' },
    { campo: 'valor', titulo: 'Valor', tipo: 'numero' },
  ],
  operacoes: { texto: ['igual', 'qualquer'], numero: ['igual', 'entre'], data: ['igual', 'entre'] },
  abertura: { campo: 'operadora', operacao: 'qualquer', valor: null, ordenacao: 'data', ordemDesc: false },
  opcoes: [], situacao: false, retorno: 'codigo', obrigatorio: null,
};
const LINHAS = [
  { codigo: 501, data: '2026-10-01', operadora: 'VISA', valor: 100, valor_com_taxa: 97, previsao_compensacao: '2026-10-31', _linha: 0 },
  { codigo: 502, data: '2026-10-02', operadora: 'MASTER', valor: 50, valor_com_taxa: 48.5, previsao_compensacao: '2026-11-01', _linha: 1 },
];

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const corpo = u.includes('/pesquisa/meta') ? META
      : u.includes('/cadastro/pesquisa/relatorios') ? []
      : u.includes('/cadastro/pesquisa?') ? { linhas: LINHAS, total: 2 }
      : [];
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
  window.alert = vi.fn();
});

const botao = (texto: string) => screen.getAllByRole('button').find((b) => b.textContent === texto)!;

describe('Baixa de cartões — os recebíveis vêm da Pesquisa da GET_CARTAO para o lote (UbaixaCartao.pas:801-830)', () => {
  it('não lista cartões do CRUD em "Abertos"; Iniciar baixa → a Pesquisa → os marcados entram no lote sem repetir; baixar sem conta avisa', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ShortcutScope><CartaoPage /></ShortcutScope></MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(botao('Iniciar baixa')).toBeTruthy());
    // em "Abertos" não há a lista de 200 do CRUD (nenhum GET /cadastro/cartao sem filtro)
    expect((global.fetch as any).mock.calls.some((c: any[]) => /\/cadastro\/cartao(\?|$)/.test(String(c[0])))).toBe(false);

    fireEvent.click(botao('Iniciar baixa'));
    const texto = await screen.findByLabelText('Texto');
    fireEvent.keyDown(texto, { key: 'Enter' });
    await screen.findByText('MASTER');
    const caixas = screen.getAllByRole('checkbox', { name: 'Selecionar linha' });
    fireEvent.click(caixas[0]);
    fireEvent.click(caixas[1]);
    await waitFor(() => expect(screen.getByText(/2 registros selecionados/)).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
    await waitFor(() => expect(screen.getByText(/2 recebível\(is\) no lote/)).toBeTruthy());
    expect(botao('Adicionar cartões')).toBeTruthy();

    // de novo: o 501 já está no lote e não repete
    fireEvent.click(botao('Adicionar cartões'));
    fireEvent.keyDown(await screen.findByLabelText('Texto'), { key: 'Enter' });
    await screen.findAllByText('MASTER');
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Selecionar linha' }).at(-2)!);
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
    await waitFor(() => expect(screen.queryByLabelText('Texto')).toBeNull());
    expect(screen.getByText(/2 recebível\(is\) no lote/)).toBeTruthy();

    // baixar sem a conta corrente: o aviso do legado
    fireEvent.click(botao('Baixar o lote'));
    expect(window.alert).toHaveBeenCalledWith('É necessário informar a conta corrente!');
  });
});
