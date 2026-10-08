import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { NfProcessamentoRapidoModal } from '../src/features/nf/NfProcessamentoRapidoModal';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

let situacao: number | null = null;
const nota = () => ({
  nota: { codnf: 501, nronf: '777', serie: '001', dtemissao: '2026-10-08', chavenfe: 'CHAVE', razao: 'LOJA 1 COMO FORNECEDOR', cnpj_cpf: '11222333000181',
    totalnf: 30, idsituacao_nf: situacao, desc_situacao: situacao ? 'TRANSFERENCIAS - ENTRADAS' : null, cfop: 1152, proc: 'N', tipo: 'E', idempresa: 2, fantasia: 'LOJA 2' },
  pendencias: [
    { ordem: 1, atalho: 'F4', descricao: 'Situação de documento', realizado: situacao ? 'R' : 'P' },
    { ordem: 2, atalho: 'F5', descricao: 'Pedido de Compra', realizado: 'R' },
  ],
});

beforeEach(() => {
  situacao = null;
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/processamento-rapido/situacoes')) return { ok: true, status: 200, json: async () => [{ idsituacao_nf: 15, descricao: 'TRANSFERENCIAS - ENTRADAS', cfops: '1152' }] };
    if (u.endsWith('/processamento-rapido/situacao') && init?.method === 'PUT') { situacao = 15; return { ok: true, status: 200, json: async () => ({ codnf: 501, idsituacao_nf: 15 }) }; }
    if (u.endsWith('/processamento-rapido')) return { ok: true, status: 200, json: async () => nota() };
    return { ok: true, status: 200, json: async () => ({}) };
  }) as any;
});

describe('Processamento rápido de nota fiscal (uProcessaNotaFiscal) — a entrada de transferência na loja de destino', () => {
  it('mostra a nota e a loja dela com as pendências; F4 escolhe a situação de transferência e a pendência vira R', async () => {
    render(<MemoryRouter><ShortcutScope><MensagemProvider><NfProcessamentoRapidoModal codnf={501} onFechar={() => undefined} /></MensagemProvider></ShortcutScope></MemoryRouter>);
    expect(await screen.findByText('LOJA 2')).toBeTruthy();
    expect(screen.getByText('Situação de documento')).toBeTruthy();
    expect(screen.getAllByText('✗ P').length).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: /Situação de documento/ }));
    expect(await screen.findByText(/TRANSFERENCIAS - ENTRADAS/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /OK \[F10\]/ }));
    await waitFor(() => expect(screen.queryAllByText('✗ P').length).toBe(0));
    expect((global.fetch as any).mock.calls.some(([u, i]: [string, RequestInit?]) => String(u).endsWith('/processamento-rapido/situacao') && i?.method === 'PUT'
      && JSON.parse(String(i?.body)).idsituacao_nf === 15)).toBe(true);
  });
});
