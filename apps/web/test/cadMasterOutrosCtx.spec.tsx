import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { CadMaster } from '../src/shared/cadmaster/CadMaster';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';
import { produtoDuplicado } from '../src/features/produtos/ProdutoCadMaster';

const schema = z.object({ idproduto: z.number().optional(), descricao: z.string().optional(), codbarra: z.string().optional() });

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/cadastro/produtos/760')) return { ok: true, status: 200, json: async () => ({ idproduto: 760, descricao: 'ARROZ 5KG', codbarra: '7890000000760' }) };
    return { ok: true, status: 200, json: async () => (u.includes('/acesso/opcoes/') ? { opcoes: [] } : []) };
  }) as any;
});

describe('CadMaster — as ações do Outros recebem o registro e o "incluir com estes valores" (o Duplicar produto)', () => {
  it('sem registro o item que precisa dele fica cinza; com ele, o Duplicar entra em inclusão com o formulário copiado e o código de barras vazio', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ShortcutScope><MensagemProvider>
          <CadMaster<any> titulo="Produtos" resourcePath="cadastro/produtos" pk="idproduto" schema={schema} defaultValues={{ descricao: '', codbarra: '' }}
            outros={[
              { label: 'Duplicar produto', requerRegistro: true, onClick: ({ registro, novoCom }) => { if (registro) novoCom({ ...registro, idproduto: undefined, codbarra: '' }); } },
              { label: 'Sem permissão', desabilitado: true, onClick: () => undefined },
            ]}
            campos={({ form }) => (<><input aria-label="descricao" {...form.register('descricao')} /><input aria-label="codbarra" {...form.register('codbarra')} /></>)} />
        </MensagemProvider></ShortcutScope></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /utros/ }));
    expect((screen.getByRole('menuitem', { name: 'Duplicar produto' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('menuitem', { name: 'Sem permissão' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /utros/ }));

    const cod = screen.getByLabelText('Código');
    fireEvent.change(cod, { target: { value: '760' } });
    fireEvent.keyDown(cod, { key: 'Enter' });
    await waitFor(() => expect((screen.getByLabelText('descricao') as HTMLInputElement).value).toBe('ARROZ 5KG'));
    fireEvent.click(screen.getByRole('button', { name: /utros/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicar produto' }));
    // inclusão: o Gravar aparece, a descrição veio e o código de barras ficou vazio
    expect(await screen.findByRole('button', { name: /ravar/ })).toBeTruthy();
    expect((screen.getByLabelText('descricao') as HTMLInputElement).value).toBe('ARROZ 5KG');
    expect((screen.getByLabelText('codbarra') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Código') as HTMLInputElement).value).toBe('');
  });

  it('o produto duplicado: sem chave, carimbos e código de barras; a linha de preço da loja sem a promoção; detalhes vazios', () => {
    const d = produtoDuplicado({
      idproduto: 760, codbarra: '7890000000760', descricao: 'ARROZ', ncmsh: '10063021', codoperador: 7, usultalteracao: 'X', dtultimalteracao: '2026-10-01', dtcadastro: '2020-01-01',
      precos: [{ id_multi_preco: 9, idproduto: 760, idempresa: 2, vrvenda: 30 }, { id_multi_preco: 8, idproduto: 760, idempresa: 1, vrvenda: 20, vrcusto: 10, promocao: 'S', vrpromo: 18 }],
      codauxiliares: [{ codauxiliar: 'CX' }], composicoes: [{ idproduto_01: 1 }],
    }, 1);
    expect(d.idproduto).toBeUndefined();
    expect(d.codoperador).toBeUndefined();
    expect(d.dtcadastro).toBeUndefined();
    expect(d.codbarra).toBe('');
    expect(d.ncmsh).toBe('10063021');
    expect(d.precos).toEqual([{ idempresa: 1, vrvenda: 20, vrcusto: 10, promocao: 'N' }]);
    expect(d.codauxiliares).toEqual([]);
    expect(d.composicoes).toEqual([]);
  });
});
