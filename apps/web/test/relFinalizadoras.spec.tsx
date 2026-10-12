import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { RelFinalizadorasPage } from '../src/features/rel-finalizadoras/RelFinalizadorasPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const CONSULTA = {
  modalidades: [{ modalidade: 'POS', destino: 'CRT', campo: 'POS' }, { modalidade: 'DINHEIRO', destino: 'CXA', campo: 'DINHEIRO' }],
  linhas: [{ dia: '2026-10-10', total_venda: 150, desconto: 0, acrescimo: 0, cancelamento: 0, fin_POS: 100, fin_DINHEIRO: 50, total_finalizadoras: 150, diferenca: 0 }],
  totais: { total_venda: 150, desconto: 0, acrescimo: 0, cancelamento: 0, fin_POS: 100, fin_DINHEIRO: 50, total_finalizadoras: 150, diferenca: 0, sem_cadastro: 0 },
  participacao: { fin_POS: 66.67, fin_DINHEIRO: 33.33 },
};

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/finalizadoras/consultar')) return { ok: true, status: 200, json: async () => CONSULTA };
    if (u.endsWith('/finalizadoras/detalhe')) {
      const b = JSON.parse(String(init?.body));
      if (b.modalidade === 'POS') {
        return { ok: true, status: 200, json: async () => ({ titulo: 'Cartões', destino: 'CRT', linhas: [{ codvendcartao: 77, nrocupom: 321, dtvenda: '2026-10-10T13:00:00Z', valor: 100, operadora: 'REDE', nropedido: '01101026130000' }] }) };
      }
      return { ok: true, status: 200, json: async () => ({ titulo: null, destino: 'CXA', linhas: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }) as any;
});

const chamadas = () => (global.fetch as any).mock.calls as Array<[string, RequestInit?]>;

describe('Vendas e finalizadoras (FRMRELFINALIZADORAS) — o Enter numa forma de pagamento', () => {
  it('Enter na célula de uma forma de cartão abre os cartões do dia; numa forma de caixa não abre nada', async () => {
    render(<MemoryRouter><ShortcutScope><MensagemProvider><RelFinalizadorasPage /></MensagemProvider></ShortcutScope></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /onsultar/ }));
    const pos = await screen.findByLabelText('POS em 10/10/2026');
    fireEvent.keyDown(screen.getByLabelText('DINHEIRO em 10/10/2026'), { key: 'Enter' });
    await waitFor(() => expect(chamadas().filter(([u]) => String(u).endsWith('/detalhe')).length).toBe(1));
    expect(screen.queryByText(/Cartões —/)).toBeNull();
    fireEvent.keyDown(pos, { key: 'Enter' });
    expect(await screen.findByText('Cartões — POS em 10/10/2026')).toBeTruthy();
    expect(screen.getByText('REDE')).toBeTruthy();
    expect(screen.getByText('1 registro(s)')).toBeTruthy();
    const corpo = JSON.parse(String(chamadas().filter(([u]) => String(u).endsWith('/detalhe'))[1][1]!.body));
    expect(corpo).toEqual({ data: '2026-10-10', modalidade: 'POS' });
  });
});
