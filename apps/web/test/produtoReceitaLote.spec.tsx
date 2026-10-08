import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReceitaSection } from '../src/features/produtos/ProdutoCadMaster';
import { ShortcutScope } from '../src/shared/keyboard';
import { MensagemProvider } from '../src/shared/mensagem';

const META = {
  titulo: 'Produtos', view: 'GET_PRODUTOS_ESTOQUE',
  colunas: [{ campo: 'codigo', titulo: 'Codigo', tipo: 'numero' }, { campo: 'descricao', titulo: 'Descricao', tipo: 'texto' }],
  operacoes: { texto: ['igual', 'comeca'], numero: ['igual'], data: ['igual'] },
  abertura: { campo: 'descricao', operacao: 'comeca', valor: null, ordenacao: null, ordemDesc: false }, opcoes: [], situacao: false, retorno: 'codigo', obrigatorio: null,
};
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const corpo = u.includes('/pesquisa/meta') ? META
      : u.includes('/cadastro/pesquisa/relatorios') ? []
      : u.includes('/cadastro/pesquisa?') && u.includes('pagina=') ? { linhas: [
        { codigo: 31, descricao: 'FARINHA', vrcusto: 4.2, fatorcx_producao: 25, _linha: 0 },
        { codigo: 32, descricao: 'FERMENTO', vrcusto: 9, fatorcx_producao: 1, _linha: 1 },
      ], total: 2 }
      : { linhas: [], total: 0 };
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});

let formRef: any;
function Tela({ fator }: { fator?: number }) {
  const form = useForm<any>({ defaultValues: { receitas: [], receitafator: fator, receitaqtde: 0 } });
  formRef = form;
  return <ReceitaSection form={form} editavel />;
}
const montar = (fator?: number) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MensagemProvider><ShortcutScope><Tela fator={fator} /></ShortcutScope></MensagemProvider>
  </QueryClientProvider>,
);
const adicionar = () => fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'Adicionar ingrediente')!);

describe('Produto — receita em lote (btnAddItemReceitaClick + CarregaItensReceita, UCadProduto.pas:1779-1806, :8316)', () => {
  it('sem a quantidade total da receita, o Adicionar avisa e não abre a Pesquisa', async () => {
    montar(undefined);
    adicionar();
    expect(await screen.findByText('Informe a quantidade da receita.')).toBeTruthy();
    expect(screen.queryByLabelText('Texto')).toBeNull();
  });

  it('com ela, os marcados entram com QTDE 1, KG, o VRCUSTO e o FATORCX_PRODUCAO; a quantidade unitária zerada vira 1', async () => {
    montar(10);
    adicionar();
    fireEvent.keyDown(await screen.findByLabelText('Texto'), { key: 'Enter' });
    await screen.findByText('FERMENTO');
    for (const c of screen.getAllByRole('checkbox', { name: 'Selecionar linha' })) fireEvent.click(c);
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
    await waitFor(() => expect(formRef.getValues('receitas')).toHaveLength(2));
    expect(formRef.getValues('receitas')[0]).toMatchObject({ idproduto_receita: 31, qtde: 1, unidade: 'KG', valor: 4.2, fatorcxprod: 25 });
    expect(formRef.getValues('receitaqtde')).toBe(1);
  });
});
