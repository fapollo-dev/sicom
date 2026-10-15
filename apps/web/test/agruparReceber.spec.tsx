import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgrupamentoPage } from '../src/features/agrupamento/AgrupamentoPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

vi.mock('../src/shared/fr3/imprimirRelatorio', () => ({ imprimirRelatorio: async () => undefined }));

const META = {
  titulo: 'Contas a receber', view: 'GET_RCB',
  colunas: [{ campo: 'codigo', titulo: 'Codigo', tipo: 'numero' }, { campo: 'cliente', titulo: 'Cliente', tipo: 'texto' }],
  operacoes: { texto: ['igual', 'qualquer'], numero: ['igual', 'entre'] },
  abertura: { campo: 'cliente', operacao: 'qualquer', valor: null, ordenacao: 'codigo', ordemDesc: false },
  opcoes: [], situacao: false, retorno: 'codigo', obrigatorio: null,
};
const TITULOS = [
  { codrcb: 21, duplicata: 'R-21', codparceiro: 8, razao: 'CLIENTE X', dtvenc: '2026-09-10', dtvenda: '2026-09-01', valor: 100, txjuros: 3, juro: 12.5, total: 112.5 },
  { codrcb: 22, duplicata: 'R-22', codparceiro: 8, razao: 'CLIENTE X', dtvenc: '2026-09-20', dtvenda: '2026-09-02', valor: 40, txjuros: 3, juro: 2, total: 42 },
];
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const corpo = u.includes('/acesso/opcoes/') ? { opcoes: [] }
      : u.includes('/agrupar/parametros') ? { txadm: 2.5 }
      : u.includes('/pesquisa/meta') ? META
      : u.includes('/cadastro/pesquisa/relatorios') ? []
      : u.includes('/cadastro/pesquisa?') ? { linhas: [{ codigo: 21, cliente: 'CLIENTE X', _linha: 0 }, { codigo: 22, cliente: 'CLIENTE X', _linha: 1 }], total: 2 }
      : u.includes('/cadastro/areceber?') ? TITULOS
      : [];
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});
const botao = (texto: string) => screen.getAllByRole('button').find((b) => b.textContent === texto)!;

describe('Agrupar contas a receber (uAgrupaContasAReceber.dfm) — o pnlCalc', () => {
  it('Total Documentos / Juros (só das linhas de Calc. Juros) / Taxa Administrativa (EMPRESAS.TXADM) / Total Geral; desconto maior que o total avisa', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ShortcutScope><MensagemProvider><AgrupamentoPage lado="areceber" /></MensagemProvider></ShortcutScope></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(botao('Buscar títulos'));
    fireEvent.keyDown(await screen.findByLabelText('Texto'), { key: 'Enter' });
    await screen.findAllByText('CLIENTE X');
    const caixas = screen.getAllByRole('checkbox', { name: 'Selecionar linha' });
    fireEvent.click(caixas[0]); fireEvent.click(caixas[1]);
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
    await screen.findByText('R-22');
    const cab = [...document.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(cab).toEqual(['', 'Calc. Juros', 'Código', 'Duplicata', 'Vencimento', 'Valor', 'Tx.Juros', 'Juro', 'Total', 'Venda', 'Cód.Cli', 'Cliente']);
    const totais = () => within(screen.getByLabelText('Totais do agrupamento'));
    const valor = (rot: string) => totais().getByText(rot).nextElementSibling!.textContent!;
    expect(valor('Total Documentos')).toMatch(/140,00/);
    expect(valor('Total Juros')).toMatch(/0,00/);
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Juro' })[0]);
    await waitFor(() => expect(valor('Total Juros')).toMatch(/12,50/));
    fireEvent.click(screen.getByRole('checkbox', { name: /Cobrar taxa administrativa/ }));
    await waitFor(() => expect(valor('Total Taxa Administrativa')).toMatch(/2,50/));
    expect(valor('Total Geral')).toMatch(/155,00/);
    // o [T] do legado marca o Calc. Juros de todas as linhas: 12,50 + 2,00
    fireEvent.click(botao('Marcar todos — Calc. Juros (T)'));
    await waitFor(() => expect(valor('Total Juros')).toMatch(/14,50/));
    const desc = screen.getByLabelText('Desconto') as HTMLInputElement;
    fireEvent.change(desc, { target: { value: '200' } });
    fireEvent.blur(desc);
    expect(await screen.findByText('Desconto maior que o total!')).toBeTruthy();
  });
});
