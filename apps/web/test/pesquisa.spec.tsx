import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pesquisa } from '../src/shared/cadmaster/Pesquisa';
import { ShortcutScope } from '../src/shared/keyboard';

const COLUNAS = [
  { campo: 'codigo', label: 'Código' },
  { campo: 'descricao', label: 'Descrição' },
];

function meta(extra: Record<string, unknown> = {}) {
  return {
    titulo: 'Marcas',
    colunas: [
      { campo: 'codigo', titulo: 'Codigo', tipo: 'numero' },
      { campo: 'descricao', titulo: 'Descricao', tipo: 'texto' },
      { campo: 'dtcadastro', titulo: 'Dtcadastro', tipo: 'data' },
    ],
    operacoes: {
      texto: ['igual', 'diferente', 'comeca', 'termina', 'qualquer', 'contido'],
      numero: ['igual', 'diferente', 'entre', 'maior', 'menor', 'contido'],
      data: ['igual', 'diferente', 'entre', 'maior', 'menor', 'contido'],
    },
    abertura: { campo: 'descricao', operacao: 'qualquer', valor: null, ordenacao: null, ordemDesc: false },
    opcoes: [],
    situacao: true,
    retorno: 'codigo',
    obrigatorio: null,
    ...extra,
  };
}

let metaAtual = meta();
const chamadas = () => (global.fetch as any).mock.calls.map((c: unknown[]) => String(c[0])) as string[];
const pesquisas = () => chamadas().filter((u) => u.includes('/cadastro/pesquisa?'));

beforeEach(() => {
  metaAtual = meta();
  global.fetch = vi.fn().mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(url).includes('/pesquisa/meta')
        ? metaAtual
        : { linhas: [{ codigo: 1, descricao: 'NESTLE' }, { codigo: 2, descricao: 'UNILEVER' }], total: 2, pagina: 0, porPagina: 100 },
  })) as any;
});

const abrir = (props: Partial<Parameters<typeof Pesquisa>[0]> = {}) =>
  render(
    <ShortcutScope>
      <Pesquisa resourcePath="cadastro/marcas" colunas={COLUNAS} onSelecionar={() => {}} onFechar={() => {}} {...props} />
    </ShortcutScope>,
  );

async function pesquisarCom(texto: string) {
  const campo = await screen.findByLabelText('Texto');
  fireEvent.change(campo, { target: { value: texto } });
  fireEvent.keyDown(campo, { key: 'Enter' });
}

describe('Pesquisa (frmPesquisa) no servidor — corte A', () => {
  it('abre VAZIA (o legado não abre carregado) e o Enter no valor pesquisa no servidor com campo, operação, valor e situação', async () => {
    abrir({ situacaoInicial: 'inativos' });
    await screen.findByLabelText('Texto');
    expect(pesquisas()).toHaveLength(0);
    await pesquisarCom('nest');
    await waitFor(() => expect(pesquisas().length).toBeGreaterThan(0));
    const u = new URL(pesquisas().at(-1)!);
    expect(u.searchParams.get('recurso')).toBe('cadastro/marcas');
    expect(u.searchParams.get('campo')).toBe('descricao');
    expect(u.searchParams.get('operacao')).toBe('qualquer');
    expect(u.searchParams.get('valor')).toBe('NEST'); // o campo de texto só aceita maiúsculas
    expect(u.searchParams.get('situacao')).toBe('inativos');
    expect(u.searchParams.get('pagina')).toBe('0'); // a 1ª página do DS (1) é a 0 do servidor
    expect(await screen.findByText('UNILEVER')).toBeTruthy();
    expect(screen.getByText(/2 registros/)).toBeTruthy();
  });

  it('o clique simples só posiciona; o duplo clique confirma a linha', async () => {
    const onSel = vi.fn();
    abrir({ onSelecionar: onSel });
    await pesquisarCom('');
    const linha = await screen.findByText('UNILEVER');
    fireEvent.click(linha);
    expect(onSel).not.toHaveBeenCalled();
    fireEvent.doubleClick(linha);
    expect(onSel).toHaveBeenCalledWith(expect.objectContaining({ descricao: 'UNILEVER' }));
  });

  it('o parâmetro da tela parametrizada (tipo da NF) vai ao servidor', async () => {
    abrir({ filtroExtra: { campo: 'tipo', operador: 'igual', valor: 'E' } });
    await pesquisarCom('x');
    await waitFor(() => expect(pesquisas().length).toBeGreaterThan(0));
    expect(new URL(pesquisas().at(-1)!).searchParams.get('tipo')).toBe('E');
  });

  it('tela com opções antes da Pesquisa (A pagar): escolhe, Enter, e a opção vai na consulta', async () => {
    metaAtual = meta({ opcoes: [{ id: 'abertas', rotulo: 'Somente abertas', padrao: true }, { id: 'todas', rotulo: 'Todas' }] });
    abrir();
    const todas = await screen.findByLabelText('Todas');
    fireEvent.click(todas);
    fireEvent.keyDown(todas, { key: 'Enter' });
    await pesquisarCom('a');
    await waitFor(() => expect(pesquisas().length).toBeGreaterThan(0));
    expect(new URL(pesquisas().at(-1)!).searchParams.get('opcao')).toBe('todas');
  });

  it('F3 limpa o valor e põe o foco nele (SetaFocoFrame); Esc fecha', async () => {
    const user = userEvent.setup();
    const onFechar = vi.fn();
    abrir({ onFechar });
    const campo = await screen.findByLabelText('Texto');
    fireEvent.change(campo, { target: { value: 'ABC' } });
    act(() => { fireEvent.keyDown(window, { key: 'F3', code: 'F3' }); });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Texto')));
    expect((screen.getByLabelText('Texto') as HTMLInputElement).value).toBe('');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onFechar).toHaveBeenCalled());
  });
});
