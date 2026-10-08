import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { useContext } from 'react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { Pesquisa } from '../src/shared/cadmaster/Pesquisa';
import { CadMaster } from '../src/shared/cadmaster/CadMaster';
import { CadMasterEmbutido, registrarCadastroDaPesquisa } from '../src/shared/cadmaster/CadMasterEmbutido';
import { ShortcutScope } from '../src/shared/keyboard';
import { MensagemProvider } from '../src/shared/mensagem';

const META = {
  titulo: 'Testes', view: 'GET_TESTES',
  colunas: [{ campo: 'codigo', titulo: 'Codigo', tipo: 'numero' }, { campo: 'nome', titulo: 'Nome', tipo: 'texto' }],
  operacoes: { texto: ['igual', 'qualquer'], numero: ['igual'], data: ['igual'] },
  abertura: { campo: 'nome', operacao: 'qualquer', valor: null, ordenacao: null, ordemDesc: false }, opcoes: [], situacao: false, retorno: 'codigo', obrigatorio: null,
};
let opcoes: string[] = ['FRMTESTE'];
let aberto: unknown = null;
// o cadastro de teste: mostra como abriu e grava o registro 77
function CadastroTeste() {
  const ctx = useContext(CadMasterEmbutido)!;
  aberto = ctx.inicial;
  return <button type="button" onClick={() => ctx.onGravou({ idteste: 77 })}>gravar teste</button>;
}
registrarCadastroDaPesquisa(['lookup/testes'], { form: 'FRMTESTE', titulo: 'Testes', pk: 'idteste', render: () => <CadastroTeste /> });

beforeEach(() => {
  opcoes = ['FRMTESTE'];
  aberto = null;
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const corpo = u.includes('/pesquisa/meta') ? META : u.includes('/acesso/opcoes/') ? { opcoes } : u.includes('/cadastro/pesquisa/relatorios') ? []
      : { linhas: [{ codigo: 5, nome: 'CINCO', _linha: 0 }, { codigo: 6, nome: 'SEIS', _linha: 1 }], total: 2 };
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});
const pesquisas = () => (global.fetch as any).mock.calls.map((c: any[]) => String(c[0])).filter((u: string) => u.includes('/cadastro/pesquisa?'));
const montar = () => render(<MensagemProvider><ShortcutScope><Pesquisa resourcePath="lookup/testes" onSelecionar={() => {}} onFechar={() => {}} /></ShortcutScope></MensagemProvider>);

describe('Pesquisa — Ins / F2, o cadastro da view por cima (uPesquisa.pas:1534-1567)', () => {
  it('sem acesso ao formulário, a mensagem do legado e nada abre', async () => {
    opcoes = [];
    montar();
    await screen.findByLabelText('Texto');
    act(() => { fireEvent.keyDown(window, { key: 'Insert', code: 'Insert' }); });
    expect(await screen.findByText('Operador não possui acesso ao formulário solicitado')).toBeTruthy();
    expect(aberto).toBeNull();
  });

  it('o Ins abre em inclusão; gravado, a grade mostra só o novo (o código igual ao gravado)', async () => {
    montar();
    await screen.findByLabelText('Texto');
    act(() => { fireEvent.keyDown(window, { key: 'Insert', code: 'Insert' }); });
    fireEvent.click(await screen.findByText('gravar teste'));
    expect(aberto).toEqual({ novo: true });
    await waitFor(() => {
      const q = new URL(pesquisas().at(-1)!).searchParams;
      expect([q.get('campo'), q.get('operacao'), q.get('valor')]).toEqual(['codigo', 'igual', '77']);
    });
  });

  it('o F2 abre o cadastro no registro da linha posicionada', async () => {
    const user = userEvent.setup();
    montar();
    fireEvent.keyDown(await screen.findByLabelText('Texto'), { key: 'Enter' });
    // o Enter leva o foco à grade (60 ms depois); só então o clique — que, como no navegador, move o foco à linha
    await waitFor(() => expect(document.activeElement?.closest('[role="row"]')).toBeTruthy());
    await user.click(await screen.findByText('SEIS'));
    act(() => { fireEvent.keyDown(window, { key: 'F2', code: 'F2' }); });
    await screen.findByText('gravar teste');
    expect(aberto).toEqual({ id: 6 });
  });
});

describe('CadMaster embutido (o cadastro aberto pela Pesquisa)', () => {
  it('abre em inclusão, avisa quem abriu ao gravar e o Sair fecha', async () => {
    global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => ({
      ok: true, status: init?.method === 'POST' ? 201 : 200,
      json: async () => (init?.method === 'POST' ? { idteste: 88, nome: 'NOVO' } : []),
    })) as any;
    const onGravou = vi.fn();
    const onFechar = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CadMasterEmbutido.Provider value={{ inicial: { novo: true }, onGravou, onFechar }}>
            <CadMaster<any> titulo="Teste" resourcePath="teste/x" pk="idteste" schema={z.object({ nome: z.string().optional() })} defaultValues={{ nome: '' }}
              campos={({ form, editavel }) => <input aria-label="nome" disabled={!editavel} {...form.register('nome')} />} />
          </CadMasterEmbutido.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const nome = screen.getByLabelText('nome') as HTMLInputElement;
    await waitFor(() => expect(nome.disabled).toBe(false)); // já em inclusão
    fireEvent.change(nome, { target: { value: 'NOVO' } });
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'Gravar')!);
    await waitFor(() => expect(onGravou).toHaveBeenCalledWith(expect.objectContaining({ idteste: 88 })));
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'Sair')!);
    expect(onFechar).toHaveBeenCalled();
  });
});
