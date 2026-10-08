import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { PgtosSection } from '../src/features/parceiros/ParceirosDetalhes';
import { ShortcutScope } from '../src/shared/keyboard';

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const corpo = u.includes('/pesquisa/meta') ? {
      titulo: 'Formas de pagamento', view: 'GET_FORMAS_PGTO',
      colunas: [{ campo: 'codigo', titulo: 'Codigo', tipo: 'numero' }, { campo: 'modalidade', titulo: 'Modalidade', tipo: 'texto' }],
      operacoes: { texto: ['igual', 'qualquer'], numero: ['igual'], data: ['igual'] },
      abertura: { campo: 'modalidade', operacao: 'qualquer', valor: null, ordenacao: null, ordemDesc: false }, opcoes: [], situacao: false, retorno: 'codigo', obrigatorio: null,
    } : u.includes('/cadastro/pesquisa?') ? { linhas: [{ codigo: 1, modalidade: 'DINHEIRO', _linha: 0 }, { codigo: 4, modalidade: 'BOLETO', _linha: 1 }], total: 2 }
      : [];
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});

function Tela() {
  const form = useForm<any>({ defaultValues: { pgtos: [] } });
  return <ShortcutScope><PgtosSection form={form} editavel /></ShortcutScope>;
}

describe('Parceiro — formas de pagamento pela Pesquisa da GET_FORMAS_PGTO (uCadClientes.pas:4181-4198)', () => {
  it('o Adicionar abre a Pesquisa em multisseleção; cada marcada entra com o IDPGTO (CODIGO) e a MODALIDADE da view', async () => {
    render(<Tela />);
    fireEvent.click(screen.getAllByRole('button').find((b) => /Adicionar forma de pagamento/.test(b.textContent || ''))!);
    fireEvent.keyDown(await screen.findByLabelText('Texto'), { key: 'Enter' });
    await screen.findByText('BOLETO');
    for (const c of screen.getAllByRole('checkbox', { name: 'Selecionar linha' })) fireEvent.click(c);
    await waitFor(() => expect(screen.getByText(/2 registros selecionados/)).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
    await waitFor(() => expect(screen.queryByLabelText('Texto')).toBeNull());
    expect(await screen.findByText('DINHEIRO')).toBeTruthy();
    expect(screen.getByText('BOLETO')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy(); // o IDPGTO do boleto
  });
});
