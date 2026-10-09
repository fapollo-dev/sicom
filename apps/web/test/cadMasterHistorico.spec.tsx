import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { CadMaster } from '../src/shared/cadmaster/CadMaster';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const schema = z.object({ idproduto: z.number().optional(), descricao: z.string().optional() });

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/cadastro/produtos/760')) return { ok: true, status: 200, json: async () => ({ idproduto: 760, descricao: 'ARROZ 5KG' }) };
    if (u.includes('/cadastro/historico-dinamico/MULTI_PRECO/760')) {
      return { ok: true, status: 200, json: async () => ({ campos: ['VRCUSTO', 'VRVENDA'], campo: 'VRVENDA',
        linhas: [{ codhistorico: 9, campo: 'VRVENDA', valor_anterior: '21.9', valor_atual: '22.5', data: '2026-10-07 08:01:02', codoperador: 7, nome: 'SMOKE', codempresa: 1, historico: 'Cadastro de Produtos' }] }) };
    }
    return { ok: true, status: 200, json: async () => (u.includes('/acesso/opcoes/') ? { opcoes: [] } : []) };
  }) as any;
});

describe('CadMaster — o "Histórico" do form-base (FGravaHistorico → uHistoricoDinamico)', () => {
  it('com o registro carregado, Outros → Histórico abre o HISTORICO_DINAMICO no campo padrão, item "código-descrição", na loja do login', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ShortcutScope><MensagemProvider>
          <CadMaster<any> titulo="Produtos" resourcePath="cadastro/produtos" pk="idproduto" schema={schema} defaultValues={{ descricao: '' }}
            historico={{ tabela: 'MULTI_PRECO', campoDefault: 'VRVENDA', campoDescricao: 'descricao' }}
            campos={({ form }) => <input aria-label="descricao" {...form.register('descricao')} />} />
        </MensagemProvider></ShortcutScope></MemoryRouter>
      </QueryClientProvider>,
    );
    // sem registro, não há Outros
    expect(screen.queryByRole('button', { name: /utros/ })).toBeNull();
    const cod = screen.getByLabelText('Código');
    fireEvent.change(cod, { target: { value: '760' } });
    fireEvent.keyDown(cod, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: /utros/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Histórico' }));
    expect(await screen.findByText('Histórico Produtos')).toBeTruthy();
    expect(screen.getByText('760-ARROZ 5KG')).toBeTruthy();
    expect(await screen.findByText('22.5')).toBeTruthy();
    const url = (global.fetch as any).mock.calls.map(([u]: [string]) => String(u)).find((u: string) => u.includes('/historico-dinamico/'));
    expect(url.endsWith('/cadastro/historico-dinamico/MULTI_PRECO/760?campo=VRVENDA')).toBe(true);
  });
});
