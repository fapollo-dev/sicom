import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { EtiquetaPage } from '../src/features/etiqueta/EtiquetaPage';
import { ShortcutScope } from '../src/shared/keyboard';

const META = {
  titulo: 'Produtos para etiquetas', view: 'GET_PRODUTOS',
  colunas: [
    { campo: 'codigo', titulo: 'Codigo', tipo: 'numero' },
    { campo: 'codbarra', titulo: 'Codbarra', tipo: 'texto' },
    { campo: 'descricao', titulo: 'Descricao', tipo: 'texto' },
    { campo: 'etq_impressa', titulo: 'Etq_impressa', tipo: 'texto' },
  ],
  operacoes: { texto: ['igual', 'qualquer'], numero: ['igual', 'entre'], data: ['igual'] },
  abertura: { campo: 'descricao', operacao: 'qualquer', valor: null, ordenacao: 'descricao', ordemDesc: false },
  opcoes: [], situacao: false, retorno: 'codigo', obrigatorio: null,
  legenda: [{ cor: 'AZUL', legenda: 'Etiqueta Impressa Produto' }, { cor: 'PRETO', legenda: 'Etiqueta Não Impressa' }],
};
const etiqueta = (idproduto: number, codbarra: string, descricao: string) => ({
  idproduto, codbarra, descricao, unidade: 'UN', fator: 1, qtde: 3, valor_venda: 5, valor_promocao: 0, valor_venda_promocao: 5, promocao: 'N',
  origem: { tipo: 'produto', caminho: 'pesquisa' }, registro: {},
});

beforeEach(() => {
  sessionStorage.clear();
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const corpo = u.includes('/pesquisa/meta') ? META
      : u.includes('/cadastro/pesquisa/relatorios') ? []
      : u.includes('/cadastro/pesquisa?') ? { linhas: [
        { codigo: 11, codbarra: '789001', descricao: 'ARROZ', etq_impressa: 'N', _cor: 'PRETO', _linha: 0 },
        { codigo: 12, codbarra: '789002', descricao: 'FEIJAO', etq_impressa: 'S', _cor: 'AZUL', _linha: 1 },
      ], total: 2 }
      : u.includes('/cadastro/etiqueta/de-itens') ? (JSON.parse(String(init?.body)).itens as Array<{ idproduto: number }>).map((i) => etiqueta(i.idproduto, `78900${i.idproduto - 10}`, i.idproduto === 11 ? 'ARROZ' : 'FEIJAO'))
      : [];
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});

describe('Etiquetas — o "Pesquisar" é a Pesquisa da GET_PRODUTOS em multisseleção (Uetiqueta.pas:700-880)', () => {
  it('leva a situação e o "somente ativos" à Pesquisa; os marcados entram pelo de-itens (fonte pesquisa), marcados para imprimir', async () => {
    render(<ShortcutScope><EtiquetaPage /></ShortcutScope>);
    await waitFor(() => expect(screen.getAllByRole('button').some((b) => b.textContent === 'Pesquisar')).toBe(true));
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'Pesquisar')!);
    const texto = await screen.findByLabelText('Texto');
    fireEvent.keyDown(texto, { key: 'Enter' });
    await screen.findByText('FEIJAO');
    const busca = (global.fetch as any).mock.calls.map((c: any[]) => String(c[0])).find((x: string) => x.includes('/cadastro/pesquisa?'))!;
    const q = new URL(busca).searchParams;
    expect(q.get('recurso')).toBe('estoque/etiquetas-produtos');
    expect(q.get('situacaoEtq')).toBe('N'); // o rádio abre em "Não impressas"
    expect(q.get('ativos')).toBe('S');
    const caixas = screen.getAllByRole('checkbox', { name: 'Selecionar linha' });
    fireEvent.click(caixas[0]);
    fireEvent.click(caixas[1]);
    await waitFor(() => expect(screen.getByText(/2 registros selecionados/)).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: 'Imprimir' })).toHaveLength(2));
    const post = (global.fetch as any).mock.calls.find((c: any[]) => String(c[0]).includes('/cadastro/etiqueta/de-itens'));
    expect(JSON.parse(post[1].body)).toEqual({ fonte: 'pesquisa', itens: [{ idproduto: 11 }, { idproduto: 12 }] });
    expect(screen.getAllByRole('checkbox', { name: 'Imprimir' }).every((c) => (c as HTMLInputElement).checked)).toBe(true);
  });
});
