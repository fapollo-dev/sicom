import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ControleCartoesCadMaster } from '../src/features/cartao/ControleCartoesCadMaster';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const ABERTO = { codvendcartao: 501, codigo: 501, idempresa: 1, razao_social: 'LOJA UM', dtvenda: '2026-10-01T10:00:00Z', nrocupom: '321', nropedido: '07011026100000',
  valor: 80, nroparcela: 1, codoperadora: 3, operadora: 'REDE', idpgto: 4, modalidade: 'POS', nsu: '11', nsuhost: 'H1', autorizacao: 'A1', codrede: 5,
  liberado: 'N', consiliado: 'S', obs: '', nome_operador: 'CAIXA 7' };
const BAIXADO = { ...ABERTO, codvendcartao: 502, codigo: 502, liberado: 'S' };

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/cadastro/cartao/501') && (!init?.method || init.method === 'GET')) return { ok: true, status: 200, json: async () => ABERTO };
    if (u.endsWith('/cadastro/cartao/502')) return { ok: true, status: 200, json: async () => BAIXADO };
    if (u.includes('/cadastro/cartao/501?senhaAdmin=') && init?.method === 'DELETE') return { ok: true, status: 204, json: async () => ({}) };
    if (u.includes('/cadastro/operadoras')) return { ok: true, status: 200, json: async () => [{ codoperadoras: 3, operadora: 'REDE', ativo: 'S' }, { codoperadoras: 9, operadora: 'VELHA', ativo: 'N' }] };
    if (u.includes('/cadastro/formas-pgto')) return { ok: true, status: 200, json: async () => [{ idpgto: 4, modalidade: 'POS', destino: 'CRT' }, { idpgto: 1, modalidade: 'DINHEIRO', destino: 'CXA' }] };
    return { ok: true, status: 200, json: async () => (u.includes('/acesso/opcoes/') ? { opcoes: [] } : []) };
  }) as any;
});

function Onde() { const l = useLocation(); return <div data-testid="onde">{l.pathname + l.search}</div>; }
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/financeiro/cartoes']}><ShortcutScope><MensagemProvider>
      <Routes>
        <Route path="/financeiro/cartoes" element={<ControleCartoesCadMaster />} />
        <Route path="/vendas/historico" element={<Onde />} />
      </Routes>
    </MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const carregar = async (codigo: string) => {
  const cod = screen.getByLabelText('Código');
  fireEvent.change(cod, { target: { value: codigo } });
  fireEvent.keyDown(cod, { key: 'Enter' });
};

describe('Controle de cartões (FRMCADCARTAO) — o form-base do legado', () => {
  it('código + Enter carrega o cartão com os campos da conciliação, a loja e o operador; o "Visualizar cupom" abre a consulta do pedido', async () => {
    tela();
    expect(screen.getByText('Lançamento de Cartões')).toBeTruthy();
    await carregar('501');
    await waitFor(() => expect((screen.getByLabelText('NSU Host') as HTMLInputElement).value).toBe('H1'));
    expect(screen.getByText('1 - LOJA UM')).toBeTruthy();
    expect(screen.getByText('CAIXA 7')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /utros/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /isualizar cupom/ }));
    expect((await screen.findByTestId('onde')).textContent).toBe('/vendas/historico?nropedido=07011026100000&empresa=1');
  });

  it('o cartão baixado avisa que não pode ser alterado', async () => {
    tela();
    await carregar('502');
    expect(await screen.findByText('Este cartão não poderá ser alterado pois já foi baixado.')).toBeTruthy();
  });

  it('excluir o cartão conciliado pede a senha administrativa e a manda na exclusão', async () => {
    window.prompt = vi.fn(() => 'segredo') as any;
    tela();
    await carregar('501');
    await waitFor(() => expect((screen.getByLabelText('NSU Host') as HTMLInputElement).value).toBe('H1'));
    // a letra sublinhada parte o nome acessível no jsdom: o botão pelo texto
    fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Excluir')!);
    const confirmar = await screen.findAllByRole('button', { name: /^Excluir$/ });
    fireEvent.click(confirmar[confirmar.length - 1]);
    await waitFor(() => expect((global.fetch as any).mock.calls.some(([u, i]: [string, RequestInit?]) => String(u).includes('/cadastro/cartao/501?senhaAdmin=segredo') && i?.method === 'DELETE')).toBe(true));
    expect((window.prompt as any).mock.calls[0][0]).toContain('Documento ja conciliado na tesouraria');
  });
});
