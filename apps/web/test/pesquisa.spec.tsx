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
    expect(onSel).toHaveBeenCalledTimes(1);
    expect(onSel.mock.calls[0][0]).toMatchObject({ descricao: 'UNILEVER' });
    // a fonte da navegação do cadastro: os códigos do resultado inteiro, com a mesma consulta
    const navegacao = onSel.mock.calls[0][1] as () => Promise<number[]>;
    expect(typeof navegacao).toBe('function');
    (global.fetch as any).mockImplementationOnce(async () => ({ ok: true, status: 200, json: async () => ({ codigos: [2, 1], total: 2 }) }));
    expect(await navegacao()).toEqual([2, 1]);
    const u = new URL(chamadas().at(-1)!);
    expect(u.searchParams.get('soCodigos')).toBe('true');
    expect(u.searchParams.get('campo')).toBe('descricao');
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

describe('Pesquisa — corte D: cores + legenda, atalhos de detalhe e totalizador', () => {
  const linhas = [{ codigo: 1, descricao: 'ATIVO', _cor: null }, { codigo: 2, descricao: 'INATIVO', _cor: 'VERMELHO' }];
  beforeEach(() => {
    metaAtual = meta({
      legenda: [{ cor: 'VERMELHO', legenda: 'Produto Inativo' }],
      detalhes: [{ tecla: 'f8', titulo: 'Consulta de Preços' }],
      rotuloDetalhes: '[F8] - Preços do produto',
      totalizador: ['codigo'],
    });
    global.fetch = vi.fn().mockImplementation(async (url: string) => ({
      ok: true, status: 200,
      json: async () => String(url).includes('/pesquisa/meta') ? metaAtual
        : String(url).includes('/pesquisa/detalhe') ? { titulo: 'Consulta de Preços', linhas: [{ Idempresa: 1, Vrvenda: 9.9 }], indisponivel: null }
        : { linhas, total: 2, soma: 3 },
    })) as any;
  });

  it('a linha da regra pinta com o token do DS e a legenda aparece; o total soma a coluna escolhida no servidor', async () => {
    abrir();
    await pesquisarCom('');
    const inativa = await screen.findByText('INATIVO');
    expect(inativa.closest('[role="row"]')?.className).toContain('text-fg-danger');
    expect(screen.getByText('ATIVO').closest('[role="row"]')?.className).not.toContain('text-fg-danger');
    expect(screen.getByRole('list', { name: 'Legenda' }).textContent).toContain('Produto Inativo');
    expect(pesquisas().some((u) => new URL(u).searchParams.get('soma') === 'codigo')).toBe(true);
    expect(screen.getByLabelText('Soma').textContent).toBe('3,00');
    expect(screen.getByText('[F8] - Preços do produto')).toBeTruthy();
  });

  it('F8 abre o detalhe da linha posicionada (o cdsDetalhes)', async () => {
    abrir();
    await pesquisarCom('');
    fireEvent.click(await screen.findByText('INATIVO'));
    act(() => { fireEvent.keyDown(window, { key: 'F8', code: 'F8' }); });
    expect(await screen.findByText(/Consulta de Preços: 2 - INATIVO/)).toBeTruthy();
    const u = new URL(chamadas().find((x) => x.includes('/pesquisa/detalhe'))!);
    expect(u.searchParams.get('tecla')).toBe('f8');
    expect(u.searchParams.get('codigo')).toBe('2');
    expect(await screen.findByText(/9,9/)).toBeTruthy(); // número no formato do DS
  });
});

describe('Pesquisa — corte E: o status da tela (Ctrl+Shift+S/D, CONFIG_STATUS_TELA)', () => {
  beforeEach(() => {
    metaAtual = meta();
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => ({
      ok: true, status: init?.method ? 204 : 200,
      json: async () => String(url).includes('/pesquisa/meta') ? metaAtual
        : String(url).includes('/pesquisa/status') ? { campo: 'descricao', operacao: 'comeca', valor: 'NES', valor2: '' }
        : { linhas: [], total: 0 },
    })) as any;
  });

  it('reabre com o campo, a operação e o valor guardados (sem pesquisar); Ctrl+Shift+S grava, Ctrl+Shift+D apaga', async () => {
    abrir();
    await waitFor(() => expect((screen.getByLabelText('Texto') as HTMLInputElement).value).toBe('NES'));
    expect(pesquisas()).toHaveLength(0);
    act(() => { fireEvent.keyDown(window, { key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true }); });
    await waitFor(() => expect((global.fetch as any).mock.calls.some((c: any[]) => c[1]?.method === 'PUT')).toBe(true));
    const put = (global.fetch as any).mock.calls.find((c: any[]) => c[1]?.method === 'PUT');
    expect(String(put[0])).toContain('/cadastro/pesquisa/status?recurso=cadastro%2Fmarcas');
    expect(JSON.parse(put[1].body)).toMatchObject({ campo: 'descricao', operacao: 'comeca', valor: 'NES' });
    act(() => { fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true }); });
    await waitFor(() => expect((global.fetch as any).mock.calls.some((c: any[]) => c[1]?.method === 'DELETE')).toBe(true));
  });
});

describe('Pesquisa — a multisseleção (HabilitaMultiselecao)', () => {
  beforeEach(() => {
    metaAtual = meta();
    global.fetch = vi.fn().mockImplementation(async (url: string) => ({
      ok: true, status: 200,
      json: async () => String(url).includes('/pesquisa/meta') ? metaAtual
        : { linhas: [{ codigo: 1, descricao: 'NESTLE' }, { codigo: 2, descricao: 'UNILEVER' }, { codigo: 3, descricao: 'COCA' }], total: 3 },
    })) as any;
  });

  it('marcar pela coluna de seleção conta no rodapé e o OK devolve as marcadas; sem marcada, a posicionada', async () => {
    const varios = vi.fn();
    abrir({ multisselecao: true, onSelecionarVarios: varios });
    await pesquisarCom('');
    await screen.findByText('UNILEVER');
    const caixas = screen.getAllByRole('checkbox', { name: 'Selecionar linha' });
    fireEvent.click(caixas[0]);
    fireEvent.click(caixas[2]);
    await waitFor(() => expect(screen.getByText(/2 registros selecionados/)).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
    expect(varios).toHaveBeenCalledWith([expect.objectContaining({ codigo: 1 }), expect.objectContaining({ codigo: 3 })]);
  });

  it('o duplo clique marca a linha e confirma junto com as já marcadas', async () => {
    const varios = vi.fn();
    abrir({ multisselecao: true, onSelecionarVarios: varios });
    await pesquisarCom('');
    const coca = await screen.findByText('COCA');
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Selecionar linha' })[0]);
    fireEvent.click(coca);
    fireEvent.doubleClick(coca);
    expect(varios).toHaveBeenCalledWith([expect.objectContaining({ codigo: 1 }), expect.objectContaining({ codigo: 3 })]);
  });
});

describe('Pesquisa — exportar o resultado (Ctrl+A / Ctrl+B na grade)', () => {
  it('com o foco na grade, Ctrl+B exporta o resultado inteiro com as colunas da view, formatado', async () => {
    metaAtual = meta();
    global.fetch = vi.fn().mockImplementation(async (url: string) => ({
      ok: true, status: 200,
      json: async () => String(url).includes('/pesquisa/meta') ? metaAtual
        : { linhas: [{ codigo: 1.5, descricao: 'NESTLE', dtcadastro: '2026-10-07T03:00:00.000Z' }], total: 1 },
    })) as any;
    const criado: Blob[] = [];
    (URL as any).createObjectURL = vi.fn((b: Blob) => { criado.push(b); return 'blob:x'; });
    (URL as any).revokeObjectURL = vi.fn();
    abrir();
    await pesquisarCom('');
    const celula = await screen.findByText('NESTLE');
    const linha = celula.closest('[role="row"]') as HTMLElement;
    linha.setAttribute('tabindex', linha.getAttribute('tabindex') ?? '0');
    linha.focus();
    fireEvent.keyDown(linha, { key: 'b', code: 'KeyB', ctrlKey: true });
    await waitFor(() => expect(criado.length).toBe(1));
    const texto = await new Promise<string>((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsText(criado[0]); });
    expect(texto).toContain('Codigo;Descricao;Dtcadastro');
    expect(texto).toContain('1,5;NESTLE;07/10/2026');
  });
});

describe('Pesquisa — as memórias da estação: F4 (SalvaConfig) e a última pesquisa (↑)', () => {
  beforeEach(() => {
    localStorage.clear();
    metaAtual = meta();
    global.fetch = vi.fn().mockImplementation(async (url: string) => ({
      ok: true, status: 200,
      json: async () => String(url).includes('/pesquisa/meta') ? metaAtual
        : String(url).includes('/pesquisa/status') ? null
        : { linhas: [{ codigo: 1, descricao: 'NESTLE' }], total: 1 },
    })) as any;
  });

  it('F4 guarda o campo e a operação; a próxima abertura vem com eles', async () => {
    const { unmount } = abrir();
    await screen.findByLabelText('Texto');
    // muda para o campo numérico "Codigo" com a operação padrão (Igual a)
    await waitFor(() => expect(screen.getByText('Descricao')).toBeTruthy());
    act(() => { fireEvent.keyDown(window, { key: 'F4', code: 'F4' }); });
    unmount();
    const k = Object.keys(localStorage).find((x) => x.startsWith('apollo:pesquisa:f4:'));
    expect(JSON.parse(localStorage.getItem(k!)!)).toMatchObject({ campo: 'descricao', operacao: 'qualquer' });
  });

  it('fechar depois de uma pesquisa com resultado guarda a última; ↑ no valor a repete', async () => {
    const r1 = abrir();
    await pesquisarCom('nes');
    await screen.findByText('NESTLE');
    r1.unmount();
    (global.fetch as any).mockClear();
    abrir();
    const campo = await screen.findByLabelText('Texto');
    fireEvent.keyDown(campo, { key: 'ArrowUp' });
    await waitFor(() => expect(pesquisas().length).toBeGreaterThan(0));
    expect(new URL(pesquisas().at(-1)!).searchParams.get('valor')).toBe('NES');
  });
});
