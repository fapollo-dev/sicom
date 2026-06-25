import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CriarBancoDto, AtualizarBancoDto } from '@apollo/shared';
import { bancosApi } from './api';

const KEY = ['bancos'];

export function useBancos() {
  return useQuery({ queryKey: KEY, queryFn: bancosApi.listar });
}

export function useBanco(codbco: number | undefined) {
  return useQuery({
    queryKey: [...KEY, codbco],
    queryFn: () => bancosApi.ler(codbco!),
    enabled: codbco != null,
  });
}

export function useCriarBanco() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CriarBancoDto) => bancosApi.criar(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useAtualizarBanco(codbco: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: AtualizarBancoDto) => bancosApi.atualizar(codbco, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useExcluirBanco() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (codbco: number) => bancosApi.excluir(codbco),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
