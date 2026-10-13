import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LancamentoCaixaPage } from '../src/features/lancamento-caixa/LancamentoCaixaPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const REGISTRO = { codcx: 8801, data: '2026-10-05', valor: 125.5, valor_caixa: -125.5, idlote: 77001, obs: 'PAGAMENTO GAS', idempresa: 1, idsituacao_nf: 9,
  codparceiro: 2, codplc: 40, codconta: 3, cadastrado_manualmente: 'S', tpconta: 1 };

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/cobranca/lancamento-caixa/8801')) return { ok: true, status: 200, json: async () => REGISTRO };
    return { ok: true, status: 200, json: async () => (u.includes('/acesso/opcoes/') ? { opcoes: [] } : []) };
  }) as any;
});

const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/cobranca/lancamento-caixa']}><ShortcutScope><MensagemProvider>
      <Routes>
        <Route path="/cobranca/lancamento-caixa" element={<LancamentoCaixaPage />} />
        <Route path="/relatorios/caixa-dre" element={<div>TELA CAIXA DRE</div>} />
      </Routes>
    </MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);

describe('Lançamento de caixa (FRMMOVCAIXA) — o form-base do legado', () => {
  it('código + Enter carrega o lançamento: o valor sem sinal, o lote e a observação', async () => {
    tela();
    expect(screen.getByText('Movimentação de caixa')).toBeTruthy();
    const cod = screen.getByLabelText('Código');
    fireEvent.change(cod, { target: { value: '8801' } });
    fireEvent.keyDown(cod, { key: 'Enter' });
    await waitFor(() => expect((screen.getByLabelText('Observações') as HTMLTextAreaElement).value).toBe('PAGAMENTO GAS'));
    expect(screen.getByText('77001')).toBeTruthy();
    expect((screen.getByLabelText('Valor') as HTMLInputElement).value).not.toContain('-');
  });

  it('o Outros tem o "Relatório" do PopupMenu1, que abre a Caixa (D.R.E.)', async () => {
    tela();
    fireEvent.click(screen.getByRole('button', { name: /utros/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /elatório/ }));
    expect(await screen.findByText('TELA CAIXA DRE')).toBeTruthy();
  });
});
