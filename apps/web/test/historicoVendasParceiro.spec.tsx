import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HistoricoVendasSection } from '../src/features/parceiros/HistoricoVendasSection';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

let urls: string[] = [];
beforeEach(() => {
  urls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    urls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ origem: 'V', empresas: [1], total: 28, linhas: [{ dtvenda: '2026-03-03', nropedido: '01319001', nrocupom: 319001, razao: 'FORN 319', idempresa: 1, total: 28 }] }) };
  }) as any;
});

describe('Histórico de vendas do parceiro (tbsHistoricoVendas do uCadClientes)', () => {
  it('Buscar consulta o período e a origem Vendas; a grade traz a linha e o total', async () => {
    render(<MemoryRouter><ShortcutScope><MensagemProvider><HistoricoVendasSection codparceiro={5} /></MensagemProvider></ShortcutScope></MemoryRouter>);
    fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Buscar')!);
    await waitFor(() => expect(urls.some((u) => u.includes('/cadastro/parceiros/5/historico-vendas?de=') && u.includes('&origem=V'))).toBe(true));
    expect(await screen.findByText('01319001')).toBeTruthy();
    expect(screen.getByText('FORN 319')).toBeTruthy();
    expect(screen.getByText('28,00')).toBeTruthy();
  });

  it('sem o parceiro gravado, pede para gravar', () => {
    render(<MemoryRouter><ShortcutScope><MensagemProvider><HistoricoVendasSection /></MensagemProvider></ShortcutScope></MemoryRouter>);
    expect(screen.getByText(/Grave o parceiro/)).toBeTruthy();
  });
});
