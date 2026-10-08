import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RelVendasDataPage } from '../src/features/rel-vendas-data/RelVendasDataPage';
import { ShortcutScope } from '../src/shared/keyboard';

const META = {
  titulo: 'Família de produtos', view: 'GET_FAMILIAS_PROD',
  colunas: [{ campo: 'codigo', titulo: 'Codigo', tipo: 'numero' }, { campo: 'nome', titulo: 'Nome', tipo: 'texto' }, { campo: 'tipo', titulo: 'Tipo', tipo: 'texto' }],
  operacoes: { texto: ['igual', 'qualquer'], numero: ['igual'], data: ['igual'] },
  abertura: { campo: 'nome', operacao: 'qualquer', valor: null, ordenacao: null, ordemDesc: false },
  opcoes: [], situacao: false, retorno: 'codigo', obrigatorio: null,
};

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const corpo = u.includes('/pesquisa/meta') ? META
      : u.includes('/cadastro/pesquisa/relatorios') ? []
      : u.includes('/cadastro/pesquisa?') ? { linhas: [
        { codigo: 3, nome: 'MERCEARIA', tipo: 'DEPARTAMENTO', _linha: 0 },
        { codigo: 7, nome: 'BEBIDAS', tipo: 'DEPARTAMENTO', _linha: 1 },
      ], total: 2 }
      : { linhas: [], totais: {} };
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});

describe('Relatório de vendas — os filtros de família (F3 em multisseleção, URelVendas.pas:2462-2492)', () => {
  it('o departamento abre a Pesquisa com TIPO = DEPARTAMENTO; vários marcados viram *SELECIONADOS e a consulta leva os códigos', async () => {
    render(<ShortcutScope><RelVendasDataPage /></ShortcutScope>);
    const campo = await screen.findByLabelText('Departamento');
    fireEvent.keyDown(campo, { key: 'F3' });
    fireEvent.keyDown(await screen.findByLabelText('Texto'), { key: 'Enter' });
    await screen.findByText('BEBIDAS');
    const meta = (global.fetch as any).mock.calls.map((c: any[]) => String(c[0])).find((x: string) => x.includes('/cadastro/pesquisa?'))!;
    expect(new URL(meta).searchParams.get('f_tipo')).toBe('DEPARTAMENTO');
    const caixas = screen.getAllByRole('checkbox', { name: 'Selecionar linha' });
    fireEvent.click(caixas[0]);
    fireEvent.click(caixas[1]);
    await waitFor(() => expect(screen.getByText(/2 registros selecionados/)).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
    await waitFor(() => expect((screen.getByLabelText('Departamento') as HTMLInputElement).value).toBe('*SELECIONADOS'));

    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'Consultar')!);
    await waitFor(() => expect((global.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes('/relatorios/vendas-data/consultar'))).toBe(true));
    const post = (global.fetch as any).mock.calls.find((c: any[]) => String(c[0]).includes('/relatorios/vendas-data/consultar'));
    expect(JSON.parse(post[1].body).departamentos).toEqual([3, 7]);

    // qualquer outra tecla no campo limpa a escolha (o cdsBusca_DEP.Close do legado)
    fireEvent.keyDown(screen.getByLabelText('Departamento'), { key: 'Delete' });
    expect((screen.getByLabelText('Departamento') as HTMLInputElement).value).toBe('');
  });
});
