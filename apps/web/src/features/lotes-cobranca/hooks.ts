import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CriarLoteCobrancaDto } from '@apollo/shared';
import { lotesApi } from './api';

const KEY = ['lotes-cobranca'];

export function useLotes() {
  return useQuery({ queryKey: KEY, queryFn: lotesApi.listar });
}
export function useLote(cod: number | undefined) {
  return useQuery({
    queryKey: [...KEY, cod],
    queryFn: () => lotesApi.ler(cod!),
    enabled: cod != null,
  });
}
export function useCriarLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CriarLoteCobrancaDto) => lotesApi.criar(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
export function useAtualizarLote(cod: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CriarLoteCobrancaDto) => lotesApi.atualizar(cod, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
export function useExcluirLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cod: number) => lotesApi.excluir(cod),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
