import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCadMaster } from '../src/shared/cadmaster/useCadMaster';
import type { ResourceApi } from '../src/shared/cadmaster/resourceApi';

function fakeApi(): ResourceApi<{ id: number; descricao: string }> {
  return {
    listar: vi.fn().mockResolvedValue([]),
    ler: vi.fn().mockResolvedValue({ id: 7, descricao: 'CARREGADO' }),
    criar: vi.fn().mockResolvedValue({ id: 1, descricao: 'NOVO' }),
    atualizar: vi.fn().mockResolvedValue({ id: 1, descricao: 'EDITADO' }),
    excluir: vi.fn().mockResolvedValue(undefined),
  };
}

describe('useCadMaster — máquina de estados do form-base (ControlaTela)', () => {
  it('browse inicial: campos read-only, código editável, só Adicionar; botão "Sair"', () => {
    const { result } = renderHook(() => useCadMaster(fakeApi(), 'id'));
    expect(result.current.modo).toBe('browse');
    expect(result.current.editavel).toBe(false);
    expect(result.current.codigoEditavel).toBe(true);
    expect(result.current.podeAdicionar).toBe(true);
    expect(result.current.podeEditar).toBe(false); // sem registro
    expect(result.current.podeGravar).toBe(false);
    expect(result.current.cancelarLabel).toBe('Sair');
  });

  it('novo() → insert: campos editáveis, código read-only, Gravar habilitado, "Cancelar"', () => {
    const { result } = renderHook(() => useCadMaster(fakeApi(), 'id'));
    act(() => result.current.novo());
    expect(result.current.modo).toBe('insert');
    expect(result.current.editavel).toBe(true);
    expect(result.current.codigoEditavel).toBe(false);
    expect(result.current.podeGravar).toBe(true);
    expect(result.current.cancelarLabel).toBe('Cancelar');
  });

  it('gravar() no insert chama criar() e volta a browse com o registro', async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useCadMaster(api, 'id'));
    act(() => result.current.novo());
    await act(async () => {
      await result.current.gravar({ descricao: 'NOVO' });
    });
    expect(api.criar).toHaveBeenCalledWith({ descricao: 'NOVO' });
    expect(result.current.modo).toBe('browse');
    expect(result.current.registro).toEqual({ id: 1, descricao: 'NOVO' });
    expect(result.current.podeEditar).toBe(true); // agora há registro
  });

  it('carregarPorCodigo() carrega e fica em browse; editar()→edit; gravar()→atualizar', async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useCadMaster(api, 'id'));
    await act(async () => {
      await result.current.carregarPorCodigo(7);
    });
    expect(api.ler).toHaveBeenCalledWith(7);
    expect(result.current.registro).toMatchObject({ id: 7 });
    act(() => result.current.editar());
    expect(result.current.modo).toBe('edit');
    await act(async () => {
      await result.current.gravar({ descricao: 'EDITADO' });
    });
    expect(api.atualizar).toHaveBeenCalledWith(7, { descricao: 'EDITADO' });
    expect(result.current.modo).toBe('browse');
  });

  it('excluir() chama excluir() e limpa o registro', async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useCadMaster(api, 'id'));
    await act(async () => {
      await result.current.carregarPorCodigo(7);
    });
    await act(async () => {
      await result.current.excluir();
    });
    expect(api.excluir).toHaveBeenCalledWith(7);
    expect(result.current.registro).toBeNull();
    expect(result.current.modo).toBe('browse');
  });

  it('cancelar() volta de insert/edit para browse', () => {
    const { result } = renderHook(() => useCadMaster(fakeApi(), 'id'));
    act(() => result.current.novo());
    expect(result.current.modo).toBe('insert');
    act(() => result.current.cancelar());
    expect(result.current.modo).toBe('browse');
  });

  it('navegação (DBNavigator) sobre o RESULTADO DA PESQUISA, na ordem da grade; sem pesquisa as setas não andam', async () => {
    const api: ResourceApi<{ id: number; descricao: string }> = {
      listar: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }] as any),
      ler: vi.fn().mockImplementation(async (id: number) => ({ id, descricao: `R${id}` })),
      criar: vi.fn(),
      atualizar: vi.fn(),
      excluir: vi.fn(),
    };
    const { result } = renderHook(() => useCadMaster(api, 'id'));

    // antes de qualquer Pesquisa o cdsNavegation está fechado (uCadMaster.pas:870-883)
    await act(async () => { await result.current.ultimo(); });
    expect(result.current.registro).toBeNull();
    expect(api.listar).not.toHaveBeenCalled();

    // a Pesquisa trouxe 30, 10, 20 nessa ordem (a da grade, não a da PK)
    const fonte = vi.fn().mockResolvedValue([30, 10, 20]);
    act(() => result.current.definirNavegacao(fonte));
    await act(async () => { await result.current.primeiro(); });
    expect(result.current.registro).toMatchObject({ id: 30 });
    await act(async () => { await result.current.proximo(); });
    expect(result.current.registro).toMatchObject({ id: 10 });
    await act(async () => { await result.current.ultimo(); });
    expect(result.current.registro).toMatchObject({ id: 20 });
    await act(async () => { await result.current.proximo(); }); // já no último → fica
    expect(result.current.registro).toMatchObject({ id: 20 });
    await act(async () => { await result.current.anterior(); });
    expect(result.current.registro).toMatchObject({ id: 10 });
    // os códigos vêm uma vez só (cache do cdsNavegation) e nunca da tabela inteira
    expect(fonte).toHaveBeenCalledTimes(1);
    expect(api.listar).not.toHaveBeenCalled();
  });

  it('navegação só atua em browse (setas inertes durante insert/edit)', async () => {
    const api: ResourceApi<{ id: number; descricao: string }> = {
      listar: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }] as any),
      ler: vi.fn().mockResolvedValue({ id: 9, descricao: 'X' }),
      criar: vi.fn(),
      atualizar: vi.fn(),
      excluir: vi.fn(),
    };
    const { result } = renderHook(() => useCadMaster(api, 'id'));
    const fonte = vi.fn().mockResolvedValue([1, 2]);
    act(() => result.current.definirNavegacao(fonte));
    act(() => result.current.novo()); // insert
    await act(async () => { await result.current.proximo(); });
    expect(fonte).not.toHaveBeenCalled();
    expect(result.current.modo).toBe('insert');
  });
});
