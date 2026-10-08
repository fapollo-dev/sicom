import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FornecedoresDesassociadosSection } from '../src/features/produtos/ProdutoCadMaster';
import { ShortcutScope } from '../src/shared/keyboard';

const META = {
  titulo: 'Parceiros', view: 'GET_PARCEIROS',
  colunas: [{ campo: 'codigo', titulo: 'Codigo', tipo: 'numero' }, { campo: 'razao', titulo: 'Razao', tipo: 'texto' }],
  operacoes: { texto: ['igual', 'qualquer'], numero: ['igual'], data: ['igual'] },
  abertura: { campo: 'razao', operacao: 'qualquer', valor: null, ordenacao: null, ordemDesc: false }, opcoes: [], situacao: false, retorno: 'codigo', obrigatorio: null,
};
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    // a GET_PARCEIROS repete o parceiro por endereço: o 50 vem duas vezes
    const corpo = u.includes('/pesquisa/meta') ? META
      : u.includes('/cadastro/pesquisa?') && u.includes('soCodigos') ? { codigos: [] }
      : u.includes('/cadastro/pesquisa?') && u.includes('lookup%2Fparceiros') && !u.includes('campo=codparceiro') ? { linhas: [
        { codigo: 50, codparceiro: 50, razao: 'FORN A', _linha: 0 }, { codigo: 50, codparceiro: 50, razao: 'FORN A', _linha: 1 }, { codigo: 60, codparceiro: 60, razao: 'FORN B', _linha: 2 },
      ], total: 3 }
      : { linhas: [], total: 0 };
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});

function Tela() {
  const form = useForm<any>({ defaultValues: { fornecedores_desassociados: [{ codparceiro: 60 }] } });
  return <ShortcutScope><FornecedoresDesassociadosSection form={form} editavel /></ShortcutScope>;
}
const comQuery = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;

describe('Produto — fornecedores desassociados pela Pesquisa em multisseleção (UCadProduto.pas:1830-1862)', () => {
  it('a Pesquisa vai com FRN = S e ATIVADO = S; os marcados entram uma vez só, e o que já está não repete', async () => {
    render(comQuery(<Tela />));
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'Adicionar fornecedores')!);
    fireEvent.keyDown(await screen.findByLabelText('Texto'), { key: 'Enter' });
    await screen.findByText('FORN B');
    const busca = (global.fetch as any).mock.calls.map((c: any[]) => String(c[0])).find((x: string) => x.includes('/cadastro/pesquisa?') && x.includes('pagina='))!;
    const q = new URL(busca).searchParams;
    expect(q.get('f_frn')).toBe('S');
    expect(q.get('f_ativado')).toBe('S');
    // a marca é do código: marcar a 1ª linha do 50 já marca a 2ª (as duas aparecem marcadas)
    const caixas = screen.getAllByRole('checkbox', { name: 'Selecionar linha' });
    fireEvent.click(caixas[0]);
    fireEvent.click(caixas[2]);
    await waitFor(() => expect(screen.getByText(/2 registros selecionados/)).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
    await waitFor(() => expect(screen.queryByLabelText('Texto')).toBeNull());
    // 60 já estava; 50 entra uma vez: 2 linhas
    await waitFor(() => expect(screen.getAllByRole('button').filter((b) => b.textContent === 'Remover')).toHaveLength(2));
  });
});
