import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConsultoriaPage } from '../src/features/consultoria/ConsultoriaPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const impressoes: Array<{ path: unknown; corpo: any }> = [];
vi.mock('../src/shared/fr3/imprimirRelatorio', () => ({ imprimirRelatorio: async (path: unknown, corpo: unknown) => { impressoes.push({ path, corpo }); } }));

let corpos: Array<{ url: string; body: any }> = [];
beforeEach(() => {
  corpos = []; impressoes.length = 0;
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    corpos.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    const r = u.endsWith('/consultoria/layouts') ? [
        { arquivo: 'at&m_participacao_dos_setores.fr3', nome: 'participacao dos setores' },
        { arquivo: 'at&m_ranking_geral_por_familias.fr3', nome: 'ranking geral por familias' }]
      : u.endsWith('/consultoria/consultar') ? { tipo: 'RANKING', linhas: [{ familia: 'FEIJAO', qtde: 2, vlcusto: 6.67, vlvenda: 11.99, vllucro: 5.32, lucrofin: 5.32 }], geral: 5.32 }
      : {};
    return { ok: true, status: 200, json: async () => r };
  }) as any;
});
const botao = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement;

describe('Consultoria Apollo (UConsultoriaATM.dfm)', () => {
  it('o combo traz os layouts at&m; o centro de custo só no "participacao dos setores" e o fornecedor (maiúsculo, com o filtro) só no ranking', async () => {
    render(<MemoryRouter><ShortcutScope><MensagemProvider><ConsultoriaPage /></MensagemProvider></ShortcutScope></MemoryRouter>);
    const combo = await screen.findByLabelText('Escolha o Relatório Desejado') as HTMLSelectElement;
    await waitFor(() => expect(combo.value).toBe('at&m_participacao_dos_setores.fr3'));
    expect((screen.getByLabelText('Fornecedor') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(combo, { target: { value: 'at&m_ranking_geral_por_familias.fr3' } });
    expect((screen.getByLabelText('Fornecedor') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText(/Centro de custo/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Vendas e Notas Fiscais'));
    fireEvent.change(screen.getByLabelText('Fornecedor'), { target: { value: 'distrib' } });
    fireEvent.change(screen.getByLabelText('Filtro do fornecedor'), { target: { value: 'comeca' } });
    fireEvent.click(botao('Gerar'));
    await waitFor(() => expect(corpos.some((c) => c.url.endsWith('/consultoria/consultar'))).toBe(true));
    expect(corpos.find((c) => c.url.endsWith('/consultoria/consultar'))!.body).toMatchObject({ arquivo: 'at&m_ranking_geral_por_familias.fr3', tipo: 1, fornecedor: 'DISTRIB', filtroFornecedor: 'comeca', plc: null });
    expect(await screen.findByText('FEIJAO')).toBeTruthy();
    fireEvent.click(botao('Imprimir'));
    await waitFor(() => expect(impressoes.length).toBe(1));
    expect(impressoes[0].path).toBe('/relatorios/consultoria/impressao');
  });
});
