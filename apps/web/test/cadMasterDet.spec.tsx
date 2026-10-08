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

  it('com `pesquisa`, o Adicionar do detalhe abre a Pesquisa em multisseleção e as marcadas entram sem repetir a chave', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      const corpo = u.includes('/pesquisa/meta') ? {
        titulo: 'Empresas', view: 'GET_EMPRESAS', colunas: [{ campo: 'codigo', titulo: 'Codigo', tipo: 'numero' }, { campo: 'fantasia', titulo: 'Fantasia', tipo: 'texto' }],
        operacoes: { texto: ['igual', 'qualquer'], numero: ['igual'], data: ['igual'] },
        abertura: { campo: 'fantasia', operacao: 'qualquer', valor: null, ordenacao: null, ordemDesc: false }, opcoes: [], situacao: false, retorno: 'codigo', obrigatorio: null,
      } : u.includes('/cadastro/pesquisa?') ? { linhas: [{ codigo: 1, fantasia: 'LOJA 1', _linha: 0 }, { codigo: 2, fantasia: 'LOJA 2', _linha: 1 }], total: 2 }
        : [];
      return { ok: true, status: 200, json: async () => corpo };
    }) as any;
    function TelaPesq() {
      return (
        <CadMasterDet<any>
          titulo="Operadores" resourcePath="teste/md" pk="id" schema={z.object({ empresas: z.array(z.object({ codempresa: z.number().optional() })) })}
          defaultValues={{ empresas: [] }} campos={() => null}
          detalhe={{
            chave: 'empresas', titulo: 'Empresas', novoItem: () => ({ codempresa: undefined }),
            itemCampos: ({ form, index }) => <span>empresa {String(form.getValues(`empresas.${index}.codempresa`))}</span>,
            pesquisa: { recurso: 'cadastro/empresas', item: (l) => ({ codempresa: Number(l.codigo) }), chave: (i) => i?.codempresa },
          }}
        />
      );
    }
    render(wrap(<TelaPesq />));
    const botoes = () => screen.getAllByRole('button');
    fireEvent.click(botoes().find((b) => (b.textContent || '').trim() === 'Adicionar' && !b.closest('fieldset'))!); // o do rodapé: inserção
    const doDetalhe = () => botoes().find((b) => (b.textContent || '').trim() === 'Adicionar' && !!b.closest('fieldset'))!;
    const marcarTudoEOk = async () => {
      fireEvent.click(doDetalhe());
      fireEvent.keyDown(await screen.findByLabelText('Texto'), { key: 'Enter' });
      await screen.findByText('LOJA 2');
      for (const c of screen.getAllByRole('checkbox', { name: 'Selecionar linha' })) fireEvent.click(c);
      await waitFor(() => expect(screen.getByText(/2 registros selecionados/)).toBeTruthy());
      fireEvent.click(botoes().find((b) => b.textContent === 'OK')!);
      await waitFor(() => expect(screen.queryByLabelText('Texto')).toBeNull());
    };
    await marcarTudoEOk();
    expect(screen.getByText('empresa 1')).toBeTruthy();
    expect(screen.getByText('empresa 2')).toBeTruthy();
    // de novo as mesmas: nada se repete (o Locate('CODEMPRESA') do legado)
    await marcarTudoEOk();
    expect(screen.getAllByText(/^empresa \d$/)).toHaveLength(2);
  });
});
