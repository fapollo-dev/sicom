import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DevolucaoVendasPage, totalADevolver } from '../src/features/devolucao-vendas/DevolucaoVendasPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const ITEM = { codvendas: 1, nroitem: 1, nropedido: 'P1', nrocupom: 993220, nroserie: '3', dtvenda: '2060-05-10', codproduto: 993220, descricao: 'DEV 322', codbarra: '7899000993220',
  unidade: 'KG', aliquota: 'T01', descAcre: -1, qtde: 2, vrvenda: 10, totalItem: 19, devolvido: false, qtdeDevolvido: 0, totalItemDevolvido: 0, coddevolucaovenda: null, datadevolucao: null, operadorDevolucao: null, motivo: null };
let urls: string[] = [];
beforeEach(() => {
  urls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('/motivos')) return { ok: true, status: 200, json: async () => [] };
    if (u.includes('/venda?') && !u.includes('venda_nfc')) return { ok: true, status: 200, json: async () => ({ itens: [], escolherOrigem: true, truncado: false, totais: { itens: 0, devolvidos: 0, valor: 0, valorDevolvido: 0 } }) };
    return { ok: true, status: 200, json: async () => ({ itens: [ITEM], escolherOrigem: false, truncado: false, totais: { itens: 1, devolvidos: 0, valor: 19, valorDevolvido: 0 } }) };
  }) as any;
});

describe('Devolução de vendas (uDevolucaoVendas) — Trazer pesquisa de vendas e a grade do legado', () => {
  it('CalculaDevolucao: o total a devolver é o líquido rateado', () => {
    expect(totalADevolver(1, 19, 2)).toBe(9.5);
    expect(totalADevolver(0, 19, 2)).toBe(0);
  });

  it('o cupom em NFC-e e ECF pergunta a origem; "Com vendas de NFC" refaz com venda_nfc=S e a grade mostra Cód.Barra, Unid., Desc/Acre, Alíquota e Tot. devolver', async () => {
    render(<MemoryRouter><ShortcutScope><MensagemProvider><DevolucaoVendasPage /></MensagemProvider></ShortcutScope></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Cupom/), { target: { value: '993220' } });
    fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Buscar')!);
    expect(await screen.findByText('Trazer pesquisa de vendas')).toBeTruthy();
    fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Com vendas de NFC')!);
    await waitFor(() => expect(urls.some((u) => u.includes('venda_nfc=S'))).toBe(true));
    expect(await screen.findByText('7899000993220')).toBeTruthy();
    expect(screen.getByText('KG')).toBeTruthy();
    expect(screen.getByText('T01')).toBeTruthy();
    expect(screen.getByText('Tot. devolver')).toBeTruthy();
  });
});
