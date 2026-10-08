import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PerfilCadMaster } from '../src/features/perfil/PerfilCadMaster';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const PERFIS: Record<number, Record<string, unknown>> = {
  221: { codperfil: 221, codigo: 221, perfil: 'PEDIDO COMPRA WEB', ativo: 'S', tipo: 'COMPRA', operadores: [{ codoperador: 8, nome: 'MARIA' }] },
  4: { codperfil: 4, codigo: 4, perfil: 'COMPRADOR GERAL', ativo: 'S', tipo: 'ACESSO', operadores: [] },
};

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const m = String(url).match(/\/cadastro\/perfil\/(\d+)$/);
    const corpo = m ? PERFIS[Number(m[1])] : String(url).includes('/acesso/opcoes/') ? { opcoes: [] } : [];
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});

const montar = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/cadastro/perfis']}><ShortcutScope><MensagemProvider><PerfilCadMaster /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const codigo = () => screen.getByLabelText('Código');

describe('Cadastro de perfil (uCadPerfilOperador) — o tipo da janela de abertura', () => {
  it('pergunta o tipo; em Compras carrega o perfil de compras com os operadores e recusa o de acesso ("O perfil não é do tipo …")', async () => {
    montar();
    expect(screen.getByText('Selecione o tipo de perfil.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Compras'));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await screen.findByRole('heading', { name: 'Perfil de compras' })).toBeTruthy();

    const cod = codigo();
    fireEvent.change(cod, { target: { value: '221' } });
    fireEvent.keyDown(cod, { key: 'Enter' });
    expect(await screen.findByText('MARIA')).toBeTruthy();
    expect(screen.getByText('Operadores vinculados')).toBeTruthy();

    fireEvent.change(cod, { target: { value: '4' } });
    fireEvent.keyDown(cod, { key: 'Enter' });
    expect(await screen.findByText('O perfil não é do tipo "Compras".')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('MARIA')).toBeNull());
  });
});
