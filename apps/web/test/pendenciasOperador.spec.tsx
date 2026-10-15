import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { PendenciasPage } from '../src/features/pendencias/PendenciasPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const LINHAS = [
  { po_id: 1, codoperador: 7, po_tipo_pendencia_operador: 'CFN', po_status: 'A', po_complemento: '165533', po_observacao: 'Finalize na tela de Conferência da nota Fiscal', po_data: '2026-10-14T12:54:15Z', codempresa: 2, nome_origem: 'FULANO', status_str: 'Aberta' },
  { po_id: 2, codoperador: 7, po_tipo_pendencia_operador: 'APN', po_status: 'A', po_complemento: '24585', po_observacao: 'Verifique as divergências', po_data: '2026-10-08T11:09:19Z', codempresa: 1, fornecedor: 'FORN A', tipo_str: 'Análise de pedido x Nota fiscal', status_str: 'Aberta' },
];
let corpos: Array<{ url: string; body: any }> = [];
beforeEach(() => {
  corpos = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    corpos.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return { ok: true, status: 200, json: async () => ({ linhas: LINHAS, totais: { linhas: 2, abertas: 2 }, filtro: { supervisor: false } }) };
  }) as any;
});
function Onde() { const l = useLocation(); return <div data-testid="onde">{l.pathname + l.search}</div>; }

describe('Pendências do operador (UFrmPendenciasOperador) — a fila abre sozinha, atravessa as lojas e a CFN leva à conferência', () => {
  it('o FormShow carrega todas as pendências (sem filtro de status), com a coluna Empresa; "Conferência" da CFN abre a conferência da NF', async () => {
    render(<MemoryRouter initialEntries={['/compras/pendencias']}><ShortcutScope><MensagemProvider>
      <Routes><Route path="/compras/pendencias" element={<PendenciasPage />} /><Route path="/compras/conferencia-nota" element={<Onde />} /></Routes>
    </MensagemProvider></ShortcutScope></MemoryRouter>);
    expect(await screen.findByText('FORN A')).toBeTruthy();
    expect(corpos[0].url.endsWith('/compras/pendencias/listar')).toBe(true);
    expect(corpos[0].body).toEqual({});
    expect(screen.getByText('Empresa')).toBeTruthy();
    const linhaCfn = screen.getByText('Finalize na tela de Conferência da nota Fiscal').closest('tr')!;
    expect(linhaCfn.textContent).toContain('2');
    fireEvent.click([...linhaCfn.querySelectorAll('button')].find((b) => b.textContent === 'Conferência')!);
    expect((await screen.findByTestId('onde')).textContent).toBe('/compras/conferencia-nota?codnf=165533');
  });
});
