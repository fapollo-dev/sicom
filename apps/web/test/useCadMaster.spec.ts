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

  it('navegação (DBNavigator): primeiro/próximo/anterior/último sobre o cdsNavegation', async () => {
    // api de navegação: lista [1,2,3] por código; ler(id) devolve {id}
    const api: ResourceApi<{ id: number; descricao: string }> = {
      listar: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }] as any),
      ler: vi.fn().mockImplementation(async (id: number) => ({ id, descricao: `R${id}` })),
      criar: vi.fn(),
      atualizar: vi.fn(),
      excluir: vi.fn(),
    };
    const { result } = renderHook(() => useCadMaster(api, 'id'));

    await act(async () => { await result.current.primeiro(); });
    expect(result.current.registro).toMatchObject({ id: 1 });
    // lista navegável ordenada por PK ascendente
    expect(api.listar).toHaveBeenCalledWith({ orderBy: 'id', orderDir: 'asc' });

    await act(async () => { await result.current.proximo(); });
    expect(result.current.registro).toMatchObject({ id: 2 });

    await act(async () => { await result.current.ultimo(); });
    expect(result.current.registro).toMatchObject({ id: 3 });

    await act(async () => { await result.current.proximo(); }); // já no último → fica no 3
    expect(result.current.registro).toMatchObject({ id: 3 });

    await act(async () => { await result.current.anterior(); });
    expect(result.current.registro).toMatchObject({ id: 2 });

    // a lista navegável é carregada uma só vez (cache do cdsNavegation)
    expect((api.listar as any).mock.calls.length).toBe(1);
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
    act(() => result.current.novo()); // insert
    await act(async () => { await result.current.proximo(); });
    expect(api.listar).not.toHaveBeenCalled();
    expect(result.current.modo).toBe('insert');
  });
});
