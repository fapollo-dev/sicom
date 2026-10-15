import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgrupamentoPage } from '../src/features/agrupamento/AgrupamentoPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const impressoes: string[] = [];
vi.mock('../src/shared/fr3/imprimirRelatorio', () => ({ imprimirRelatorio: async (path: string) => { impressoes.push(path); } }));

// a Pesquisa da GET_APAGAR_AGRUPAR
const META = {
  titulo: 'Contas a pagar', view: 'GET_APAGAR_AGRUPAR',
  colunas: [{ campo: 'codigo', titulo: 'Codigo', tipo: 'numero' }, { campo: 'fornecedor', titulo: 'Fornecedor', tipo: 'texto' }],
  operacoes: { texto: ['igual', 'qualquer'], numero: ['igual', 'entre'] },
  abertura: { campo: 'fornecedor', operacao: 'qualquer', valor: null, ordenacao: 'codigo', ordemDesc: false },
  opcoes: [], situacao: false, retorno: 'codigo', obrigatorio: null,
};
const LINHAS_PESQ = [{ codigo: 11, fornecedor: 'FORN A', _linha: 0 }, { codigo: 12, fornecedor: 'FORN A', _linha: 1 }];
const TITULOS = [
  { codapg: 11, duplicata: 'D-11', codparceiro: 5, razao: 'FORN A', dtvenc: '2026-10-20', dtcompra: '2026-10-01', valor: 100, vendor: 3.6, desconto: 0, valor_agrupar: 103.6 },
  { codapg: 12, duplicata: 'D-12', codparceiro: 5, razao: 'FORN A', dtvenc: '2026-10-25', dtcompra: '2026-10-02', valor: 50, vendor: 0, desconto: 1, valor_agrupar: 49 },
];
let opcoes: string[] = [];
let corpos: Array<{ url: string; body: any }> = [];
beforeEach(() => {
  impressoes.length = 0; corpos = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    corpos.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    const corpo = u.includes('/acesso/opcoes/') ? { opcoes }
      : u.includes('/pesquisa/meta') ? META
      : u.includes('/cadastro/pesquisa/relatorios') ? []
      : u.includes('/cadastro/pesquisa?') ? { linhas: LINHAS_PESQ, total: 2 }
      : u.includes('/cadastro/apagar?') ? TITULOS
      : u.endsWith('/cadastro/apagar/agrupar') ? { codgrupo: 77, consolidado: 900, membros: 2, total: 152.6 }
      : [];
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShortcutScope><MensagemProvider><AgrupamentoPage lado="apagar" /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const botao = (texto: string) => screen.getAllByRole('button').find((b) => b.textContent === texto)!;
const trazer = async () => {
  fireEvent.click(botao('Buscar títulos'));
  fireEvent.keyDown(await screen.findByLabelText('Texto'), { key: 'Enter' });
  await screen.findAllByText('FORN A');
  const caixas = screen.getAllByRole('checkbox', { name: 'Selecionar linha' });
  fireEvent.click(caixas[0]); fireEvent.click(caixas[1]);
  fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
  await screen.findByText('D-12');
};

describe('Agrupar contas a pagar (uAgrupaContasAPagar.dfm)', () => {
  it('a grade é a da GET_APAGAR_AGRUPAR (Venda = compra, Valor = valor + vendor − desconto); sem BTNEXCLUIRDOC o documento não sai da grade; depois de agrupar pergunta se imprime (AgrupamentoCP)', async () => {
    opcoes = [];
    tela();
    await trazer();
    const cab = [...document.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(cab).toEqual(['', 'Código', 'Duplicata', 'Vencimento', 'Venda', 'Valor', 'Cód.Forn.', 'Razão']);
    expect(screen.getByText('01/10/2026')).toBeTruthy();
    expect(screen.getByText(/103,60/)).toBeTruthy();
    const sel = screen.getAllByRole('checkbox', { name: 'Selecionar' }) as HTMLButtonElement[];
    expect(sel.every((c) => c.disabled)).toBe(true);
    expect(screen.queryByText(/Marcar\/desmarcar/)).toBeNull();
    fireEvent.click(botao('Agrupar'));
    await waitFor(() => expect(corpos.some((c) => c.url.endsWith('/cadastro/apagar/agrupar'))).toBe(true));
    expect(corpos.find((c) => c.url.endsWith('/cadastro/apagar/agrupar'))!.body.codapgs).toEqual([11, 12]);
    expect(await screen.findByText('Deseja imprimir o relatório do agrupamento?')).toBeTruthy();
    // a mensagem de sucesso (modal) fecha antes da pergunta
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
    fireEvent.click(botao('Sim'));
    await waitFor(() => expect(impressoes).toEqual(['/cadastro/apagar/900/relatorio-agrupamento/impressao?agrupado=0']));
  });

  it('com BTNEXCLUIRDOC o documento sai da grade (desmarcar) e o "marcar/desmarcar todos" aparece', async () => {
    opcoes = ['BTNEXCLUIRDOC'];
    tela();
    await trazer();
    await waitFor(() => expect(screen.getByText(/Marcar\/desmarcar/)).toBeTruthy());
    const sel = screen.getAllByRole('checkbox', { name: 'Selecionar' }) as HTMLButtonElement[];
    expect(sel.some((c) => c.disabled)).toBe(false);
  });
});
