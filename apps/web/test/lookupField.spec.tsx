import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LookupField } from '../src/shared/ui/LookupField';
import { ShortcutScope } from '../src/shared/keyboard';

const PARCEIROS: Record<string, any> = { '22': { codparceiro: 22, razao: 'FORNECEDOR VINTE E DOIS', frn: 'S' } };
const urls = () => (global.fetch as any).mock.calls.map((c: unknown[]) => new URL(String(c[0])));

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = new URL(url);
    const l = PARCEIROS[u.searchParams.get('valor') ?? ''];
    return { ok: true, status: 200, json: async () => ({ linhas: l ? [l] : [], total: l ? 1 : 0 }) };
  }) as any;
});

const montar = (props: Partial<Parameters<typeof LookupField>[0]> = {}) => {
  const onChange = vi.fn();
  render(
    <ShortcutScope>
      <LookupField label="&Fornecedor" recurso="lookup/parceiros" campoCodigo="codparceiro" descricao="razao" fixos={{ frn: 'S' }} onChange={onChange} {...props} />
    </ShortcutScope>,
  );
  return onChange;
};

describe('LookupField — o código + descrição + Pesquisa do legado (no lugar do combo cortado em 200)', () => {
  it('o código que veio do registro mostra a descrição SEM o filtro do campo (o gravado vale mesmo que hoje não passe nele)', async () => {
    montar({ value: 22 });
    expect(await screen.findByText('FORNECEDOR VINTE E DOIS')).toBeTruthy();
    const u = urls()[0];
    expect(u.searchParams.get('recurso')).toBe('lookup/parceiros');
    expect(u.searchParams.get('campo')).toBe('codparceiro');
    expect(u.searchParams.get('operacao')).toBe('igual');
    expect(u.searchParams.get('f_frn')).toBeNull();
  });

  it('o código digitado é conferido COM o filtro do campo (FRN=S)', async () => {
    montar();
    const campo = screen.getByLabelText('Fornecedor');
    fireEvent.change(campo, { target: { value: '22' } });
    fireEvent.blur(campo);
    await waitFor(() => expect(urls().length).toBeGreaterThan(0));
    expect(urls().at(-1)!.searchParams.get('f_frn')).toBe('S');
  });

  it('digitar o código e sair confere no servidor: achou → onChange(código, linha); não achou → "Não encontrado" e vazio', async () => {
    const onChange = montar();
    const campo = screen.getByLabelText('Fornecedor');
    fireEvent.change(campo, { target: { value: '22' } });
    fireEvent.blur(campo);
    expect(onChange).toHaveBeenCalledWith('22'); // sai na hora: o Gravar logo em seguida não perde o código
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('22', expect.objectContaining({ razao: 'FORNECEDOR VINTE E DOIS' })));
    fireEvent.change(campo, { target: { value: '999' } });
    fireEvent.blur(campo);
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(undefined, undefined));
    expect(await screen.findByText('Não encontrado')).toBeTruthy();
  });
});

describe('LookupField — digita-se uma coluna, grava-se outra (a conta pelo CODIREDUZIDO, o centro de custo pelo CODIGO_EXTENSO)', () => {
  it('mostra o reduzido da conta gravada; digitar o reduzido grava o CODPLANOCONTAS', async () => {
    const CONTA = { codplanocontas: 15, codireduzido: '1234', descricao: 'CAIXA GERAL' };
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      const u = new URL(url);
      const achou = (u.searchParams.get('campo') === 'codplanocontas' && u.searchParams.get('valor') === '15')
        || (u.searchParams.get('campo') === 'codireduzido' && u.searchParams.get('valor') === '1234');
      return { ok: true, status: 200, json: async () => ({ linhas: achou ? [CONTA] : [], total: achou ? 1 : 0 }) };
    }) as any;
    const onChange = vi.fn();
    const { rerender } = render(
      <ShortcutScope>
        <LookupField label="&Conta" recurso="lookup/plano-contas" campoCodigo="codplanocontas" campoDigitado="codireduzido" descricao="descricao" value={15} onChange={onChange} />
      </ShortcutScope>,
    );
    const campo = screen.getByLabelText('Conta') as HTMLInputElement;
    await waitFor(() => expect(campo.value).toBe('1234'));
    expect(screen.getByText('CAIXA GERAL')).toBeTruthy();
    rerender(
      <ShortcutScope>
        <LookupField label="&Conta" recurso="lookup/plano-contas" campoCodigo="codplanocontas" campoDigitado="codireduzido" descricao="descricao" value={undefined} onChange={onChange} />
      </ShortcutScope>,
    );
    fireEvent.change(campo, { target: { value: '1234' } });
    fireEvent.blur(campo);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('15', expect.objectContaining({ codireduzido: '1234' })));
    expect(onChange).not.toHaveBeenCalledWith('1234'); // o reduzido nunca vai como código gravado
  });
});
