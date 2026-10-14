import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConferenciaNotaPage, statusDaConferencia } from '../src/features/conferencia-nota/ConferenciaNotaPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const RESP = {
  nf: { codnf: 5, nronf: '123', serie: '1', fornecedor: 'FORN A', totalnf: 100 },
  itens: [
    { codnfprod: 1, codproduto: 1, codbarra: '7890001', descricao: 'ARROZ', unidade: 'UN', quantidade: 2, qtde_nota: 2, qtde_coletada: 2, divergente: false, produc_status: 'LIBERADO' },
    { codnfprod: 2, codproduto: 2, codbarra: '7890002', descricao: 'FEIJAO', unidade: 'UN', quantidade: 3, qtde_nota: 3, qtde_coletada: null, divergente: false, produc_status: 'BLOQUEADO' },
  ],
  totais: { itens: 2, aprovados: 0, pendentes: 2, conferidos: 1, divergentes: 0 },
};
beforeEach(() => {
  window.history.replaceState({}, '', '/compras/conferencia-nota?codnf=5');
  global.fetch = vi.fn().mockImplementation(async () => ({ ok: true, status: 200, json: async () => RESP })) as any;
});

describe('Conferência de nota (uConferenciaNota) — o status do lote, as cores do status e o código de barras', () => {
  it('PreencheStatusLote: nada/parte/tudo coletado', () => {
    expect(statusDaConferencia([{ qtde_nota: 2, qtde_coletada: null }])).toBe('Não coletado');
    expect(statusDaConferencia([{ qtde_nota: 2, qtde_coletada: 2 }, { qtde_nota: 3, qtde_coletada: null }])).toBe('Parcialmente coletado');
    expect(statusDaConferencia([{ qtde_nota: 2, qtde_coletada: 2 }, { qtde_nota: 3, qtde_coletada: 3 }])).toBe('Totalmente coletado');
    expect(statusDaConferencia([])).toBe('');
  });

  it('abre a nota da URL, mostra "Status: Parcialmente coletado", pinta LIBERADO/BLOQUEADO e avisa o código de barras que não está na nota', async () => {
    render(<MemoryRouter initialEntries={['/compras/conferencia-nota?codnf=5']}><ShortcutScope><MensagemProvider><ConferenciaNotaPage /></MensagemProvider></ShortcutScope></MemoryRouter>);
    expect(await screen.findByText('Status: Parcialmente coletado')).toBeTruthy();
    expect(screen.getByText('LIBERADO').className).toContain('text-info');
    expect(screen.getByText('BLOQUEADO').className).toContain('text-danger');
    const loc = screen.getByLabelText(/Localizar/);
    fireEvent.change(loc, { target: { value: '7899999' } });
    fireEvent.keyDown(loc, { key: 'Enter' });
    expect(await screen.findByText(/Código de barras não encontrado/)).toBeTruthy();
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Pesquisar nota')).toBe(true);
    await waitFor(() => expect((global.fetch as any).mock.calls.some((c: any[]) => String(c[0]).endsWith('/compras/conferencia-nota/5'))).toBe(true));
  });
});
