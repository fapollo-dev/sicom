import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BaixaReceberPage } from '../src/features/baixa-receber/BaixaReceberPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

let opcoes: string[] = [];
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const corpo = u.includes('/acesso/opcoes/') ? { opcoes }
      : u.endsWith('/baixa-receber/padroes') ? { ccJuros: null, ccAcrescimo: null, ccDesconto: null, diasFutura: 0, permiteRetroativa: true, recursos: [], empresas: [1] }
      : u.endsWith('/baixa-receber/contas') ? { contas: [], formasCartao: [] }
      : [];
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});
function Onde() { const l = useLocation(); return <div data-testid="onde">{l.pathname}</div>; }
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/cobranca/baixa-receber']}><ShortcutScope><MensagemProvider>
      <Routes><Route path="/cobranca/baixa-receber" element={<BaixaReceberPage />} /><Route path="/cobranca/cons-rcb-bx" element={<Onde />} /></Routes>
    </MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const botao = (texto: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === texto) as HTMLButtonElement;

describe('Baixa de contas a receber — as permissões de controle do UBaixaAreceber.dfm e o "Consulta titulos"', () => {
  it('com BTNCONSULTA, "Consulta títulos" abre a consulta de baixas (FRMCONSRCBBX)', async () => {
    opcoes = ['BTNADICIONARREGISTRO', 'BTNCONSULTA'];
    tela();
    await waitFor(() => expect(botao('Consulta títulos')?.disabled).toBe(false));
    fireEvent.click(botao('Consulta títulos'));
    expect((await screen.findByTestId('onde')).textContent).toBe('/cobranca/cons-rcb-bx');
  });

  it('sem as opções, Iniciar baixa e Consulta títulos ficam desabilitados', async () => {
    opcoes = [];
    tela();
    await waitFor(() => expect((global.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes('/acesso/opcoes/FRMBAIXAARECEBER'))).toBe(true));
    await waitFor(() => expect(botao('Iniciar baixa')?.disabled).toBe(true));
    expect(botao('Consulta títulos').disabled).toBe(true);
  });
});
