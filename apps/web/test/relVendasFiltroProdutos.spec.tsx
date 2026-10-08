import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RelVendasPage } from '../src/features/rel-vendas/RelVendasPage';
import { ShortcutScope } from '../src/shared/keyboard';

const META = {
  titulo: 'Produtos', view: 'GET_PRODUTOS',
  colunas: [{ campo: 'codigo', titulo: 'Codigo', tipo: 'numero' }, { campo: 'descricao', titulo: 'Descricao', tipo: 'texto' }],
  operacoes: { texto: ['igual', 'qualquer'], numero: ['igual'], data: ['igual'] },
  abertura: { campo: 'codigo', operacao: 'igual', valor: null, ordenacao: null, ordemDesc: false }, opcoes: [], situacao: false, retorno: 'codigo', obrigatorio: null,
  rotuloDetalhes: 'Limitação de no máximo 1000 registros selecionados.',
};
let filtra = true;
beforeEach(() => {
  filtra = true;
  window.confirm = vi.fn(() => true);
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const corpo = u.includes('/relatorios/vendas/opcoes') ? { filtraProdutos: filtra }
      : u.includes('/relatorios/vendas/layouts') ? []
      : u.includes('/pesquisa/meta') ? META
      : u.includes('/cadastro/pesquisa/relatorios') ? []
      : u.includes('/cadastro/pesquisa?') ? { linhas: [{ codigo: 11, descricao: 'ARROZ', idempresa: 1, _linha: 0 }, { codigo: 11, descricao: 'ARROZ', idempresa: 2, _linha: 1 }, { codigo: 12, descricao: 'FEIJAO', idempresa: 1, _linha: 2 }], total: 3 }
      : { linhas: [], totais: { qtde: 0, total_venda: 0, total_custo: 0, lucro_bruto: 0, margem: null, rentabilidade: null, acrescimo: 0, desc_promocao: 0, linhas: 0, sem_custo: 0 }, filtro: {} };
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});
const corpoDoGerar = () => {
  const c = (global.fetch as any).mock.calls.filter((x: any[]) => String(x[0]).endsWith('/relatorios/vendas/produtos-vendidos')).at(-1);
  return c ? JSON.parse(c[1].body) : null;
};
const gerar = () => fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'Gerar')!);

describe('Relatório de vendas (rel 01) — o filtro de produtos (MultiProdutos, URelVendas.pas:1253-1265)', () => {
  it('com a configuração ligada, o Gerar pergunta e abre a Pesquisa; os códigos marcados (uma vez cada) vão ao relatório', async () => {
    render(<ShortcutScope><RelVendasPage /></ShortcutScope>);
    await waitFor(() => expect((global.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes('/relatorios/vendas/opcoes'))).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    gerar();
    expect(window.confirm).toHaveBeenCalledWith('Deseja realizar o filtro de produtos?');
    fireEvent.keyDown(await screen.findByLabelText('Valor'), { key: 'Enter' });
    await screen.findByText('FEIJAO');
    const caixas = screen.getAllByRole('checkbox', { name: 'Selecionar linha' });
    fireEvent.click(caixas[0]);
    fireEvent.click(caixas[2]);
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
    await waitFor(() => expect(corpoDoGerar()?.produtos).toEqual([11, 12]));
    expect(screen.getByText(/2 produto\(s\) filtrado\(s\)/)).toBeTruthy();
  });

  it('com a configuração desligada, o Gerar não pergunta e vai sem filtro de produtos', async () => {
    filtra = false;
    render(<ShortcutScope><RelVendasPage /></ShortcutScope>);
    await waitFor(() => expect((global.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes('/relatorios/vendas/opcoes'))).toBe(true));
    gerar();
    await waitFor(() => expect(corpoDoGerar()).toBeTruthy());
    expect(window.confirm).not.toHaveBeenCalled();
    expect(corpoDoGerar().produtos).toBeUndefined();
  });
});
