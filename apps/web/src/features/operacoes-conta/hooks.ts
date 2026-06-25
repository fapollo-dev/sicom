import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CriarOperacaoContaDto, AtualizarOperacaoContaDto } from '@apollo/shared';
import { operacoesContaApi } from './api';

const KEY = ['operacoes-conta'];

export function useOperacoesConta() {
  return useQuery({ queryKey: KEY, queryFn: operacoesContaApi.listar });
}
export function useOperacaoConta(cod: number | undefined) {
  return useQuery({
    queryKey: [...KEY, cod],
    queryFn: () => operacoesContaApi.ler(cod!),
    enabled: cod != null,
  });
}
export function useCriarOperacaoConta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CriarOperacaoContaDto) => operacoesContaApi.criar(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
export function useAtualizarOperacaoConta(cod: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: AtualizarOperacaoContaDto) => operacoesContaApi.atualizar(cod, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
export function useExcluirOperacaoConta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cod: number) => operacoesContaApi.excluir(cod),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
