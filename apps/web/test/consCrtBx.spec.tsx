import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// a Pesquisa da GET_CARTAOBX devolve a linha escolhida (o LOTE vai ao edtLote)
vi.mock('../src/shared/cadmaster/Pesquisa', () => ({
  Pesquisa: ({ onSelecionar }: { onSelecionar: (l: Record<string, unknown>) => void }) => (
    <button type="button" onClick={() => onSelecionar({ lote: 77, codigo: 501 })}>escolher o lote</button>
  ),
}));

import { ConsCrtBxPage } from '../src/features/cons-crt-bx/ConsCrtBxPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const LOTE = {
  idlote: 77,
  cartoes: [
    { codigo: 501, nrocupom: '1234', operadora: 'REDE DEBITO', valor: 100, valor_com_taxa: 98, data: '2026-06-01', previsao_compensacao: '2026-06-02', data_baixa: '2026-06-10', operador_baixa: 'MARIA', codigo_empresa: 1, contabilizado: 'N' },
    { codigo: 502, nrocupom: '1235', operadora: 'REDE DEBITO', valor: 50, valor_com_taxa: 49, data: '2026-06-01', previsao_compensacao: '2026-06-02', data_baixa: '2026-06-10', operador_baixa: 'MARIA', codigo_empresa: 1, contabilizado: 'N' },
  ],
  recursos: [
    { codmovconta: 1, codconta: 10, nroconta: '12345-6', titular: 'BANCO DA LOJA', modalidade: 'DINHEIRO', valor: 147, tipomovimento: 'C', historico: 'REF. BX LOTE: 77' },
    { codmovconta: 2, codconta: 11, nroconta: 'CX', titular: 'CAIXA CARTOES', modalidade: 'TEF', valor: -147, tipomovimento: 'D', historico: 'SAIDA PARA BAIXA DE DOCUMENTOS' },
  ],
  totais: { cartoes: 2, valor: 150, valor_com_taxa: 147, recursos: 0 },
};

const montar = (url: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[url]}><ShortcutScope><MensagemProvider><ConsCrtBxPage /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/cadastro/acesso/opcoes/')) return { ok: true, status: 200, json: async () => ({ opcoes: ['FRMBAIXACARTAO', 'BTNCONSULTA'] }) };
    if (String(url).includes('/cadastro/cartao/consulta-baixa/77')) return { ok: true, status: 200, json: async () => LOTE };
    if (String(url).includes('/cadastro/cartao/estornar-lote/77')) return { ok: true, status: 200, json: async () => ({ idlote: 77, itens: 2, contraMovimentos: 2 }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }) as any;
});

describe('Cartões baixados — a consulta do lote (UConsCRTbx.pas)', () => {
  it('o F3 busca o lote na Pesquisa; mostra os cartões e os recursos com o sinal; Reverter confirma, reverte e limpa a tela', async () => {
    montar('/financeiro/cartoes/consulta-baixa');
    expect(screen.getByText('Busque o lote com F3.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Buscar cartões/ }));
    fireEvent.click(screen.getByRole('button', { name: 'escolher o lote' }));
    expect(await screen.findByText('1234')).toBeTruthy();
    expect(screen.getByText('1235')).toBeTruthy();
    expect(screen.getByText('BANCO DA LOJA')).toBeTruthy();
    expect(screen.getByText(/^-R\$\s147,00$/)).toBeTruthy();
    expect(screen.getByText('2 cartão(ões)')).toBeTruthy();

    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const reverter = screen.getByRole('button', { name: /everter baixa/ });
    await waitFor(() => expect((reverter as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(reverter);
    expect(confirmar).toHaveBeenCalledWith('Tem certeza que deseja reverter todos os documentos?');
    expect(await screen.findByText('Reversão realizada com sucesso.')).toBeTruthy();
    expect((global.fetch as any).mock.calls.some(([u, init]: [string, RequestInit?]) => String(u).includes('/estornar-lote/77') && init?.method === 'POST')).toBe(true);
    expect(screen.queryByText('1234')).toBeNull();
    confirmar.mockRestore();
  });

  it('pelo "Visualizar títulos" do controle de contas: o lote carregado, sem a busca e sem a reversão (VisualizarCartoes)', async () => {
    montar('/financeiro/cartoes/consulta-baixa?lote=77&consulta=1');
    expect(await screen.findByText('1234')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Buscar cartões/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /everter baixa/ })).toBeNull();
  });
});
