import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const impressoes: string[] = [];
vi.mock('../src/shared/fr3/imprimirRelatorio', () => ({ imprimirRelatorio: vi.fn(async (p: string) => { impressoes.push(p); }) }));
import { RelComprasPage } from '../src/features/rel-compras/RelComprasPage';

const RES = {
  tipo: 'CATEGORIA', considerar: null, campoData: 'CONTABIL', totais: { compra: 300, venda: 0 },
  lojas: [{ idempresa: 1, fantasia: 'LOJA 1', total_compra: 300, total_porc: 100 }],
  linhas: [
    { idempresa: 1, fantasia: 'LOJA 1', data: '2026-10-01', codsecao: 1, desc_secao: 'MERCEARIA', coddpto: 2, descricao_departamento: 'SECOS', codgrupo: 3, desc_grupo: 'GRAOS', codsubgrupo: 4, desc_subgrupo: 'ARROZ', total_compra: 200, total_venda: 0, total_porc: 66.67 },
    { idempresa: 1, fantasia: 'LOJA 1', data: '2026-10-01', codsecao: 1, desc_secao: 'MERCEARIA', coddpto: 2, descricao_departamento: 'SECOS', codgrupo: 3, desc_grupo: 'GRAOS', codsubgrupo: 5, desc_subgrupo: 'FEIJAO', total_compra: 100, total_venda: 0, total_porc: 33.33 },
  ],
};
let urls: string[] = [];
beforeEach(() => {
  urls = []; impressoes.length = 0;
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url); urls.push(u);
    const r = u.includes('/relatorios/compras?') ? RES : { linhas: [], total: 0 };
    return { ok: true, status: 200, json: async () => r };
  }) as any;
});
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShortcutScope><MensagemProvider><RelComprasPage /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const botao = (t: string) => [...document.querySelectorAll('button')].filter((b) => b.textContent === t).pop() as HTMLButtonElement;

describe('Relatórios de compras (URelCompras.dfm)', () => {
  it('abre sem tipo (o FormShow cai no ramo do tipo 3) e o Imprimir pede o tipo; o tipo 1 liga o "Exibe grade" e a grade em árvore mostra o % do subgrupo no grupo', async () => {
    tela();
    expect((screen.getByLabelText('Exibe grade') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Compras') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(botao('Imprimir'));
    expect(await screen.findByText('Selecione um tipo de relatório.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    fireEvent.change(screen.getByLabelText('Tipo de Relatório'), { target: { value: 'CATEGORIA' } });
    expect((screen.getByLabelText('Exibe grade') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Compras') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(botao('Imprimir'));
    expect(await screen.findByText('4 - ARROZ')).toBeTruthy();
    expect(urls.some((u) => u.includes('/relatorios/compras?') && u.includes('tipo=CATEGORIA'))).toBe(true);
    expect(impressoes.length).toBe(0);
    expect(screen.getByText('1 - LOJA 1')).toBeTruthy();
    expect(screen.getByText('66,67%')).toBeTruthy();
    expect(screen.getByText('TOTAL DE COMPRAS (%)')).toBeTruthy();
    fireEvent.click(botao('Imprimir'));
    await waitFor(() => expect(impressoes.length).toBe(1));
    expect(impressoes[0]).toContain('/relatorios/compras/impressao?');
    fireEvent.click(botao('Sair'));
    expect(screen.queryByText('4 - ARROZ')).toBeNull();
  });

  it('o tipo 3 trava o "Exibe grade" e o Imprimir vai direto ao layout com o Considerar; o Limpar esvazia o tipo', async () => {
    tela();
    fireEvent.change(screen.getByLabelText('Tipo de Relatório'), { target: { value: 'COMPRAS_VENDAS' } });
    expect((screen.getByLabelText('Exibe grade') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Compras e Vendas'));
    fireEvent.click(botao('Imprimir'));
    await waitFor(() => expect(impressoes.length).toBe(1));
    expect(impressoes[0]).toContain('tipo=COMPRAS_VENDAS');
    expect(impressoes[0]).toContain('considerar=AMBOS');
    expect(urls.some((u) => u.includes('/relatorios/compras?'))).toBe(false);
    fireEvent.click(botao('Limpar'));
    expect((screen.getByLabelText('Tipo de Relatório') as HTMLSelectElement).value).toBe('');
  });
});
