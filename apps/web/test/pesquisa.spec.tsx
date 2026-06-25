import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pesquisa } from '../src/shared/cadmaster/Pesquisa';

const COLUNAS = [
  { campo: 'codigo', label: 'Código' },
  { campo: 'descricao', label: 'Descrição' },
];

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [
      { codigo: 1, descricao: 'NESTLE' },
      { codigo: 2, descricao: 'UNILEVER' },
    ],
  }) as any;
});

/**
 * Pesquisa agora é Modal + DataTable do DS. Os testes validam o CONTRATO da tela
 * (núcleo do frmPesquisa) sobre a UX do DS: lista carregada pela view, clique
 * seleciona, F6 cicla a situação (re-fetch), Esc fecha.
 */
describe('Pesquisa (frmPesquisa) — Modal + DataTable do DS', () => {
  it('carrega a lista pela view (situacao=ativos) e mostra as linhas', async () => {
    render(<Pesquisa resourcePath="cadastro/marcas" colunas={COLUNAS} onSelecionar={() => {}} onFechar={() => {}} />);
    await waitFor(() => screen.getByText('NESTLE'));
    expect(screen.getByText('UNILEVER')).toBeTruthy();
    const calls = (global.fetch as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((u: string) => u.includes('situacao=ativos'))).toBe(true);
  });

  it('clique na linha seleciona o registro (onRowClick → onSelecionar)', async () => {
    const onSel = vi.fn();
    render(<Pesquisa resourcePath="cadastro/marcas" colunas={COLUNAS} onSelecionar={onSel} onFechar={() => {}} />);
    await waitFor(() => screen.getByText('UNILEVER'));
    fireEvent.click(screen.getByText('UNILEVER'));
    expect(onSel).toHaveBeenCalledWith(expect.objectContaining({ descricao: 'UNILEVER' }));
  });

  it('F6 cicla a situação (rdgAtivo) e refaz a busca: ativos→inativos→todos', async () => {
    render(<Pesquisa resourcePath="cadastro/marcas" colunas={COLUNAS} onSelecionar={() => {}} onFechar={() => {}} />);
    await waitFor(() => screen.getByText('NESTLE'));
    const calls = () => (global.fetch as any).mock.calls.map((c: any[]) => String(c[0]));

    fireEvent.keyDown(window, { key: 'F6' }); // ativos → inativos
    await waitFor(() => expect(calls().some((u: string) => u.includes('situacao=inativos'))).toBe(true));

    fireEvent.keyDown(window, { key: 'F6' }); // inativos → todos
    await waitFor(() => expect(calls().some((u: string) => u.includes('situacao=todos'))).toBe(true));
  });

  it('Esc fecha (onClose do Modal do DS)', async () => {
    const user = userEvent.setup();
    const onFechar = vi.fn();
    render(<Pesquisa resourcePath="cadastro/marcas" colunas={COLUNAS} onSelecionar={() => {}} onFechar={onFechar} />);
    await waitFor(() => screen.getByText('NESTLE'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onFechar).toHaveBeenCalled());
  });
});
