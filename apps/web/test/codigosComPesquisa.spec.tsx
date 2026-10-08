import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { CodigosComPesquisa } from '../src/shared/pesquisa/CodigosComPesquisa';
import { ShortcutScope } from '../src/shared/keyboard';

const META = {
  titulo: 'CFOP', view: 'GET_CFOP',
  colunas: [{ campo: 'cfop', titulo: 'Cfop', tipo: 'numero' }, { campo: 'descricao', titulo: 'Descricao', tipo: 'texto' }],
  operacoes: { texto: ['igual', 'qualquer'], numero: ['igual'], data: ['igual'] },
  abertura: { campo: 'descricao', operacao: 'qualquer', valor: null, ordenacao: null, ordemDesc: false }, opcoes: [], situacao: false, retorno: 'cfop', obrigatorio: null,
};
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const corpo = u.includes('/pesquisa/meta') ? META : u.includes('/cadastro/pesquisa/relatorios') ? []
      : { linhas: [{ cfop: 1102, descricao: 'COMPRA', _linha: 0 }, { cfop: 1403, descricao: 'COMPRA ST', _linha: 1 }], total: 2 };
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});
let ultimo = '';
function Tela() {
  const [v, setV] = useState('5102');
  ultimo = v;
  return <ShortcutScope><CodigosComPesquisa label="CFOPs" value={v} onChange={setV} recurso="lookup/cfops" fixos={{ tipo: 'E' }} campo="cfop" /></ShortcutScope>;
}

describe('CodigosComPesquisa — o "códigos com vírgula" com a Pesquisa em multisseleção', () => {
  it('digitar continua valendo; o F3 abre a Pesquisa com o filtro e os marcados substituem a lista', async () => {
    render(<Tela />);
    const campo = screen.getByLabelText('CFOPs') as HTMLInputElement;
    expect(campo.value).toBe('5102');
    fireEvent.keyDown(campo, { key: 'F3' });
    fireEvent.keyDown(await screen.findByLabelText('Texto'), { key: 'Enter' });
    await screen.findByText('COMPRA ST');
    const busca = (global.fetch as any).mock.calls.map((c: any[]) => String(c[0])).find((x: string) => x.includes('/cadastro/pesquisa?'))!;
    expect(new URL(busca).searchParams.get('f_tipo')).toBe('E');
    for (const c of screen.getAllByRole('checkbox', { name: 'Selecionar linha' })) fireEvent.click(c);
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'OK')!);
    await waitFor(() => expect(ultimo).toBe('1102,1403'));
  });
});
