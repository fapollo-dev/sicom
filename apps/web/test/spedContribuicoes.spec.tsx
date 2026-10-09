import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { SpedContribuicoesPage } from '../src/features/sped/SpedContribuicoesPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const conta = { codplanocontas: 183, codireduzido: '183', descricao: 'CAIXA CENTRAL', codiexpandido: '1.1.01.01.0001' };
let contas: Record<string, unknown>;

beforeEach(() => {
  contas = { m400: conta, m410: conta, m800: conta, m810: null };
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/fiscal/sped/contas-pc') && init?.method === 'PUT') { contas = { ...contas, ...Object.fromEntries(Object.entries(JSON.parse(String(init.body))).map(([k, v]) => [k, v ? conta : null])) }; return { ok: true, status: 200, json: async () => contas }; }
    if (u.endsWith('/fiscal/sped/contas-pc')) return { ok: true, status: 200, json: async () => contas };
    if (u.endsWith('/fiscal/sped/pendencias')) return { ok: true, status: 200, json: async () => ({ pendencias: [] }) };
    if (u.endsWith('/fiscal/sped/efd-contribuicoes')) {
      return { ok: true, status: 200, json: async () => ({ arquivo: '|0000|006|\r\n', nomeArquivo: 'SPED_CONTRIBUICOES_12345678000190_09102026.txt', linhas: 1, documentos: 0,
        parcial: true, aviso: 'PARCIAL', validacao: { ok: true, erros: [], registros: 1 } }) };
    }
    if (u.includes('/cadastro/pesquisa')) return { ok: true, status: 200, json: async () => ({ linhas: [conta], total: 1 }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }) as any;
  (URL as any).createObjectURL = vi.fn(() => 'blob:sped');
  (URL as any).revokeObjectURL = vi.fn();
});

const chamadas = () => (global.fetch as any).mock.calls as Array<[string, RequestInit?]>;

const montar = () => render(<MemoryRouter><ShortcutScope><MensagemProvider><SpedContribuicoesPage /></MensagemProvider></ShortcutScope></MemoryRouter>);
const periodo = () => {
  fireEvent.change(screen.getByLabelText(/Competência: de/), { target: { value: '2026-09-01' } });
  fireEvent.change(screen.getByLabelText(/^até/), { target: { value: '2026-09-30' } });
};

describe('SPED Contribuições (FRMSPEDPISCOFINS) — as contas do bloco M, o pré-validador e o arquivo', () => {
  it('sem a conta do M810 recusa com a mensagem do legado (ValidaConfiguracoesSPED) e não gera', async () => {
    montar();
    await waitFor(() => expect(chamadas().some(([u]) => String(u).endsWith('/fiscal/sped/contas-pc'))).toBe(true));
    periodo();
    fireEvent.click(screen.getByRole('button', { name: /erar/ }));
    expect(await screen.findByText('Informe o plano contábil para o registro M810.')).toBeTruthy();
    expect(chamadas().some(([u]) => String(u).endsWith('/efd-contribuicoes'))).toBe(false);
  });

  it('com as quatro contas: o pré-validador (piscofins) sem pendência segue, a geração exige a apuração e baixa SPED_CONTRIBUICOES_…', async () => {
    contas = { ...contas, m810: conta };
    montar();
    await waitFor(() => expect(chamadas().some(([u]) => String(u).endsWith('/fiscal/sped/contas-pc'))).toBe(true));
    await waitFor(() => expect(screen.getAllByDisplayValue('183').length).toBe(4));
    periodo();
    fireEvent.click(screen.getByRole('button', { name: /erar/ }));
    await waitFor(() => expect(chamadas().some(([u]) => String(u).endsWith('/efd-contribuicoes'))).toBe(true));
    expect(JSON.parse(String(chamadas().find(([u]) => String(u).endsWith('/pendencias'))![1]!.body)).tipo).toBe('piscofins');
    expect(JSON.parse(String(chamadas().find(([u]) => String(u).endsWith('/efd-contribuicoes'))![1]!.body))).toEqual({ dtini: '2026-09-01', dtfim: '2026-09-30', exigirApuracao: true });
    expect(await screen.findByText('SPED_CONTRIBUICOES_12345678000190_09102026.txt')).toBeTruthy();
    expect(await screen.findByText(/Arquivo Gerado com Sucesso/)).toBeTruthy();
  });
});
