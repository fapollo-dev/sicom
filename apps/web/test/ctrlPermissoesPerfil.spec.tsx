import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CtrlPermissoesPage } from '../src/features/perfil/CtrlPermissoesPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const chamadas = () => (global.fetch as any).mock.calls.map(([u, init]: [string, RequestInit?]) => `${init?.method ?? 'GET'} ${String(u)}`) as string[];

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const corpo = u.includes('/permissoes/catalogo') ? [{ form: 'FRMLIBERACOES', opcao: 'BTNCONSULTAR', caption: 'Consultar', form_caption: 'LIBERACOES' }]
      : u.includes('/permissoes/perfil/') ? { codperfil: 4, codempresa: 1, grants: [{ form: 'FRMLIBERACOES', opcao: 'BTNCONSULTAR' }] }
      : u.includes('/permissoes/auditoria') ? []
      : u.includes('/cadastro/pesquisa') ? { linhas: [{ codigo: 4, perfil: 'COMPRADOR GERAL' }], total: 1 }
      : [];
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});

const montar = (url: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[url]}><ShortcutScope><MensagemProvider><CtrlPermissoesPage /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);

describe('Controle de permissões — a aba Perfil (uCtrlPermissoes: cxTbsPerfil, AbreTelaTipoCodigo = tpPerfil)', () => {
  it('aberta pelo F4 da tela de perfis (?perfil=4): a aba Perfil com os grants do perfil; sem o Registro de log, que é só do usuário', async () => {
    montar('/cadastro/permissoes?perfil=4');
    await waitFor(() => expect(chamadas().some((c) => c.startsWith('GET ') && c.includes('/cadastro/permissoes/perfil/4'))).toBe(true));
    expect(screen.getByRole('tab', { name: /Perfil/ }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('1 ação(ões) concedida(s) de 1 no catálogo.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Registro de/ })).toBeNull();
    expect(screen.getByRole('button', { name: /opiar de outro perfil/ })).toBeTruthy();
    expect(chamadas().some((c) => c.includes('/permissoes/operador/'))).toBe(false);

    // TbsUsuarioEnter: trocar de aba limpa o código
    fireEvent.click(screen.getByRole('tab', { name: /Usuário/ }));
    expect(await screen.findByText(/Selecione um operador para ver e editar as permissões/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Registro de/ })).toBeTruthy();
  });
});
