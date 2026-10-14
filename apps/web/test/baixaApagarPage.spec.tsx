import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BaixaApagarPage } from '../src/features/baixa-apagar/BaixaApagarPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const PADROES = { ccJuros: null, ccAcrescimo: null, ccDesconto: null, diasFutura: 0, permiteRetroativa: true, recursos: [{ tipo: 0, rotulo: '1 - DINHEIRO', liberado: 'S', contaCaixa: true }], empresas: [1] };
let opcoes: string[] = [];
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const corpo = u.includes('/acesso/opcoes/') ? { opcoes } : u.endsWith('/baixa-apagar/padroes') ? PADROES : u.endsWith('/baixa-apagar/contas') ? [] : {};
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});
function Onde() { const l = useLocation(); return <div data-testid="onde">{l.pathname}</div>; }
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/cobranca/baixa-apagar']}><ShortcutScope><MensagemProvider>
      <Routes>
        <Route path="/cobranca/baixa-apagar" element={<BaixaApagarPage />} />
        <Route path="/cobranca/cons-apg-bx" element={<Onde />} />
      </Routes>
    </MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const botao = (texto: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === texto) as HTMLButtonElement;

describe('Baixa de contas a pagar — as permissões de controle do UBaixaApagar.dfm (Tag 1) e o "Consulta títulos"', () => {
  it('com as opções, "Consulta títulos" abre a consulta de baixas (FRMCONSAPGBX)', async () => {
    opcoes = ['BTNADICIONARREGISTRO', 'BTNCONSULTA', 'BTNGRAVAR'];
    tela();
    await waitFor(() => expect(botao('Consulta títulos').disabled).toBe(false));
    fireEvent.click(botao('Consulta títulos'));
    expect((await screen.findByTestId('onde')).textContent).toBe('/cobranca/cons-apg-bx');
  });

  it('sem BTNADICIONARREGISTRO e BTNCONSULTA, "Iniciar baixa" e "Consulta títulos" ficam desabilitados', async () => {
    opcoes = ['BTNGRAVAR'];
    tela();
    await waitFor(() => expect((global.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes('/acesso/opcoes/FRMBAIXAAPAGAR'))).toBe(true));
    await waitFor(() => expect(botao('Iniciar baixa').disabled).toBe(true));
    expect(botao('Consulta títulos').disabled).toBe(true);
  });
});
