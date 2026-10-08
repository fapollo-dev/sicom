import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgendaPromocaoCadMaster } from '../src/features/agenda-promocao/AgendaPromocaoCadMaster';
import { ShortcutScope } from '../src/shared/keyboard';

const META = {
  titulo: 'Produtos', view: 'GET_PRODUTOS',
  colunas: [{ campo: 'codigo', titulo: 'Codigo', tipo: 'numero' }, { campo: 'descricao', titulo: 'Descricao', tipo: 'texto' }, { campo: 'vrvenda', titulo: 'Vrvenda', tipo: 'numero' }],
  operacoes: { texto: ['igual', 'qualquer'], numero: ['igual'], data: ['igual'] },
  abertura: { campo: 'descricao', operacao: 'qualquer', valor: null, ordenacao: null, ordemDesc: false }, opcoes: [], situacao: false, retorno: 'codigo', obrigatorio: null,
};
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const corpo = u.includes('/pesquisa/meta') ? META
      : u.includes('/cadastro/pesquisa?') && u.includes('pagina=') ? { linhas: [
        { codigo: 101, descricao: 'CAFE 500G', vrvenda: 20, vrpromo: 0, vrclubefidelidade: 0, _linha: 0 },
        { codigo: 102, descricao: 'ACUCAR 1KG', vrvenda: 5, vrpromo: 4.5, vrclubefidelidade: 4, _linha: 1 },
      ], total: 2 }
      : u.includes('/cadastro/pesquisa?') ? { linhas: [], total: 0 }
      : [];
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});

describe('Agenda de promoção — o &Adicionar é a Pesquisa em multisseleção (uCadAgendaPromocao.pas:435-480, CarregarItens)', () => {
  it('cada marcado entra uma vez, com o VRVENDA e o preço promocional = VRVENDA − % de desconto do cabeçalho', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ShortcutScope><AgendaPromocaoCadMaster /></ShortcutScope></MemoryRouter>
      </QueryClientProvider>,
    );
    const pct = await screen.findByLabelText('% desconto');
    fireEvent.change(pct, { target: { value: '10' } });
    fireEvent.blur(pct);
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'Adicionar')!);
    fireEvent.keyDown(await screen.findByLabelText('Texto'), { key: 'Enter' });
    await screen.findByText('ACUCAR 1KG');
    for (const c of screen.getAllByRole('checkbox', { name: 'Selecionar linha' })) fireEvent.click(c);
    await waitFor(() => expect(screen.getByText(/2 registros selecionados/)).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
    await waitFor(() => expect(screen.queryByLabelText('Texto')).toBeNull());
    // 20 − 10% = 18,00 e 5 − 10% = 4,50; o clube do açúcar (4,00) vem do produto
    // (o toLocaleString põe um espaço não separável depois do R$)
    expect(await screen.findByText(/^R\$\s18,00$/)).toBeTruthy();
    expect(screen.getAllByText(/^R\$\s4,50$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/^R\$\s4,00$/)).toBeTruthy();

    // a grade editável: duplo clique no preço promocional do café, 15 + Enter
    fireEvent.doubleClick(screen.getByText(/^R\$\s18,00$/));
    const editor = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[role="row"] input[type="number"], [role="row"] input[inputmode="decimal"], [role="gridcell"] input');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.change(editor, { target: { value: '15' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(await screen.findByText(/^R\$\s15,00$/)).toBeTruthy();
  });
});
