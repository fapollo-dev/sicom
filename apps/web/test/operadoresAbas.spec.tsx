import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// a Pesquisa de verdade busca no servidor: aqui ela devolve as linhas marcadas de uma vez (o OK da multisseleção)
vi.mock('../src/shared/cadmaster/Pesquisa', () => ({
  Pesquisa: ({ onSelecionarVarios }: { onSelecionarVarios: (l: Array<Record<string, unknown>>) => void }) => (
    <button type="button" onClick={() => onSelecionarVarios([
      { codigo: 3, perfil: 'DIRETORIA' }, { codigo: 4, perfil: 'COMPRADOR GERAL' }, { codigo: 4, perfil: 'COMPRADOR GERAL' },
    ])}>marcar e OK</button>
  ),
}));

import { ListaPesquisada as Lista } from '../src/features/operadores/ListaPesquisada';
import { ShortcutScope } from '../src/shared/keyboard';

const ListaPesquisada = (p: Parameters<typeof Lista>[0]) => <ShortcutScope><Lista {...p} /></ShortcutScope>;

const props = (over: Partial<Parameters<typeof Lista>[0]> = {}) => ({
  rotulo: 'Perfis do operador', chave: 'codperfil', recurso: 'lookup/perfis', editavel: true,
  colunas: [{ campo: 'codperfil', rotulo: 'Código' }, { campo: 'perfil', rotulo: 'Perfil' }],
  deLinha: (l: Record<string, unknown>) => ({ codperfil: Number(l.codigo), perfil: l.perfil }),
  itens: [{ codperfil: 3, perfil: 'DIRETORIA' }], onChange: vi.fn(), ...over,
});

describe('Cadastro de usuários — as abas de perfil e de supervisionados (uCadUsuarios.pas:220-300)', () => {
  it('o Adicionar põe cada marcado uma vez e avisa o perfil que o operador já tinha', () => {
    const p = props({ aoRepetir: vi.fn() });
    render(<ListaPesquisada {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    fireEvent.click(screen.getByRole('button', { name: 'marcar e OK' }));
    expect(p.onChange).toHaveBeenCalledWith([{ codperfil: 3, perfil: 'DIRETORIA' }, { codperfil: 4, perfil: 'COMPRADOR GERAL' }]);
    // o 4 repetido no mesmo lote (a mesma linha uma vez por loja) não é aviso; o 3, que já estava, é
    expect(p.aoRepetir).toHaveBeenCalledWith([{ codperfil: 3, perfil: 'DIRETORIA' }]);
  });

  it('o Excluir pergunta "Deseja excluir o registro selecionado?" e só tira com o sim', () => {
    const p = props({ confirmarExclusao: true });
    render(<ListaPesquisada {...p} />);
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(p.onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(confirmar).toHaveBeenCalledWith('Deseja excluir o registro selecionado?');
    expect(p.onChange).toHaveBeenCalledWith([]);
    confirmar.mockRestore();
  });

  it('fora da edição não há Adicionar nem Excluir', () => {
    render(<ListaPesquisada {...props({ editavel: false })} />);
    expect(screen.queryByRole('button', { name: 'Adicionar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    expect(screen.getByText('DIRETORIA')).toBeTruthy();
  });
});
