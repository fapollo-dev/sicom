import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RelCaixaDrePage, corpoCompetencia } from '../src/features/rel-caixa-dre/RelCaixaDrePage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const impressoes: Array<{ path: unknown; corpo: unknown }> = [];
vi.mock('../src/shared/fr3/imprimirRelatorio', () => ({
  imprimirRelatorio: async (path: unknown, corpo: unknown) => { impressoes.push({ path, corpo }); },
}));

let opcoes: string[] = [];
let corpos: Array<{ url: string; body: any }> = [];
beforeEach(() => {
  corpos = []; impressoes.length = 0;
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    corpos.push({ url: u, body });
    const r = u.includes('/acesso/opcoes/') ? { opcoes }
      : u.endsWith('/caixa-competencia/consultar') ? { linhas: [{ data: '2026-10-01', desccodplc: '1.01.001', descricao: 'VENDAS A VISTA', tiporecurso: 'D', total_credito: 150, total_debito: 0 }], niveis: 3 }
      : u.endsWith('/caixa-baixado/consultar') ? { linhas: [
          { desccodplc: '1.01.001', descricao: 'CLIENTES', descricao_nvl1: 'RECEITAS', obs: 'BAIXA', razao: 'CLIENTE A', valor: 300, tpconta: 0 },
          { desccodplc: '4.01.001', descricao: 'ALUGUEL', descricao_nvl1: 'DESPESAS', obs: 'ALUGUEL OUT', razao: 'IMOBILIARIA', valor: -120, tpconta: 1 }], niveis: 3 }
      : u.endsWith('/caixa-dre/consultar') ? { receitas: [], despesas: [], totais: { receitas: 0, contas_recebidas_sem_conta: 0, cartoes_recebidos: 0, cheques_recebidos: 0, despesas: 0, resultado: 0, custo_mercadoria: 0 } }
      : {};
    return { ok: true, status: 200, json: async () => r };
  }) as any;
});
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShortcutScope><MensagemProvider><RelCaixaDrePage /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const botao = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement;

describe('Relatório de caixa (FRMRELATORIOCAIXA) — os controles do legado', () => {
  it('abre na Competência (emissão) com o custo de reposição marcado e a data contábil das notas; o modelo Recursos mostra a ordenação', async () => {
    opcoes = [];
    tela();
    expect((screen.getByLabelText('Relatório') as HTMLSelectElement).value).toBe('EMISSAO');
    expect(screen.getByRole('radiogroup', { name: 'Campo data para filtro de notas' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Ordenação por centro de custo' })).toBeNull();
    fireEvent.click(screen.getByLabelText('Recursos'));
    fireEvent.click(screen.getByLabelText('Descrição'));
    fireEvent.click(botao('Consultar'));
    await waitFor(() => expect(corpos.some((c) => c.url.endsWith('/caixa-competencia/consultar'))).toBe(true));
    const b = corpos.find((c) => c.url.endsWith('/caixa-competencia/consultar'))!.body;
    expect(b).toMatchObject({ regime: 'EMISSAO', modelo: 1, ordenacao: 1, custoReposicao: true, dataNota: 'DTCONTABIL', taxasCartao: false, cmv: false, expandido: false });
    expect(await screen.findByText('VENDAS A VISTA')).toBeTruthy();
    // o Imprimir é a opção BTNIMPRIMIR
    expect(botao('Imprimir').disabled).toBe(true);
  });

  it('no vencimento as taxas de cartão desabilitam e o campo data das notas some; o Anual consulta a D.R.E.', async () => {
    opcoes = ['BTNIMPRIMIR'];
    tela();
    fireEvent.change(screen.getByLabelText('Relatório'), { target: { value: 'VENCIMENTO' } });
    expect(screen.queryByRole('radiogroup', { name: 'Campo data para filtro de notas' })).toBeNull();
    expect((screen.getByRole('checkbox', { name: /taxas de cartão/ }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(botao('Imprimir').disabled).toBe(false));
    fireEvent.click(botao('Imprimir'));
    await waitFor(() => expect(impressoes.length).toBe(1));
    expect(impressoes[0].path).toBe('/relatorios/caixa-competencia/impressao');
    expect(impressoes[0].corpo).toMatchObject({ regime: 'VENCIMENTO', modelo: 0 });
    expect((impressoes[0].corpo as any).dataNota).toBeUndefined();
    fireEvent.change(screen.getByLabelText('Relatório'), { target: { value: 'ANUAL' } });
    fireEvent.click(botao('Consultar'));
    await waitFor(() => expect(corpos.some((c) => c.url.endsWith('/caixa-dre/consultar'))).toBe(true));
  });

  it('o corpo leva só o que vale no modelo: expandido só no Totalizado/Recursos totalizado, taxas só na emissão, empresas digitadas', () => {
    const base = { regime: 'VENCIMENTO' as const, dtini: '2026-10-01', dtfim: '2026-10-31', empresas: '1, 2', plc: ' 4.07 ', tpconta: '1', obs: '',
      modelo: 3, ordenacao: 1, dataNota: 'DTEMISSAO' as const, cmv: true, taxasCartao: true, notasFiscais: true, custoReposicao: false, expandido: true };
    expect(corpoCompetencia(base)).toEqual({ dtini: '2026-10-01', dtfim: '2026-10-31', regime: 'VENCIMENTO', modelo: 3, empresas: [1, 2],
      codoperador: null, codfiscal: null, codpdv: null, plc: '4.07', tpconta: 1, obs: null, cmv: true, taxasCartao: false, notasFiscais: true,
      custoReposicao: false, expandido: false });
  });

  it('Caixa Baixado: só o código, a observação e o C.M.V. valem (operador/PDV/tipo de conta desabilitados, modelo travado); consulta o balancete', async () => {
    opcoes = [];
    tela();
    fireEvent.change(screen.getByLabelText('Relatório'), { target: { value: 'BX_PAGAMENTO' } });
    expect((screen.getByLabelText('Tipo de conta') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Totalizado') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: /notas fiscais/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('checkbox', { name: /Planos de contas expandidos/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Observação'), { target: { value: 'aluguel' } });
    fireEvent.click(botao('Consultar'));
    await waitFor(() => expect(corpos.some((c) => c.url.endsWith('/caixa-baixado/consultar'))).toBe(true));
    expect(corpos.find((c) => c.url.endsWith('/caixa-baixado/consultar'))!.body).toMatchObject({ data: 'PAGAMENTO', obs: 'aluguel', cmv: false, plc: null });
    expect(await screen.findByText('IMOBILIARIA')).toBeTruthy();
    expect(screen.getByText(/Entradas R\$\s?300,00 · Saídas -R\$\s?120,00/)).toBeTruthy();
  });
});
