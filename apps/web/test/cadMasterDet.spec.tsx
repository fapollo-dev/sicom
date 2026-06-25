import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { CadMasterDet } from '../src/shared/cadmaster/CadMasterDet';

// Schema mínimo de agregado (header + itens)
const schema = z.object({
  nome: z.string().optional(),
  itens: z.array(z.object({ valor: z.number().optional() })),
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }) as any;
});

describe('CadMasterDet — grid de itens (núcleo do TfrmCadMasterDet)', () => {
  function Tela() {
    return (
      <CadMasterDet<any>
        titulo="Teste MD"
        resourcePath="teste/md"
        pk="id"
        schema={schema}
        defaultValues={{ nome: '', itens: [] }}
        campos={({ form }) => <input aria-label="nome" {...form.register('nome')} />}
        detalhe={{
          chave: 'itens',
          titulo: 'Itens',
          novoItem: () => ({ valor: undefined }),
          itemCampos: ({ form, index }) => (
            <input aria-label={`valor-${index}`} type="number" {...form.register(`itens.${index}.valor`)} />
          ),
        }}
      />
    );
  }

  it('inicia em browse com a seção de itens e "Sem itens."', () => {
    render(wrap(<Tela />));
    expect(screen.getByText('Itens')).toBeTruthy();
    expect(screen.getByText('Sem itens.')).toBeTruthy();
  });

  it('Adicionar/Remover item mexe no useFieldArray (após entrar em inserção)', async () => {
    render(wrap(<Tela />));
    // botão por textContent exato (o mnemônico pode quebrar o nome acessível no jsdom)
    const botao = (re: RegExp) =>
      screen.getAllByRole('button').find((b) => re.test((b.textContent || '').trim()))!;
    // entra em inserção (botão Adicionar do rodapé do CadMaster)
    fireEvent.click(botao(/^Adicionar$/));
    // agora "Adicionar item" cria uma linha
    fireEvent.click(botao(/Adicionar item/));
    await waitFor(() => expect(screen.getByLabelText('valor-0')).toBeTruthy());
    fireEvent.click(botao(/Adicionar item/));
    await waitFor(() => expect(screen.getByLabelText('valor-1')).toBeTruthy());
    // remove a primeira linha → sobra uma (reindexada para 0)
    fireEvent.click(botao(/^Remover$/));
    await waitFor(() => expect(screen.queryByLabelText('valor-1')).toBeNull());
    expect(screen.getByLabelText('valor-0')).toBeTruthy();
  });
});
