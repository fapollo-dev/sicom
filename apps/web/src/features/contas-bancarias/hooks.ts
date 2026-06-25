import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CriarContaBancariaDto, AtualizarContaBancariaDto } from '@apollo/shared';
import { contasBancariasApi } from './api';
import { bancosApi } from '../cadastro-bancos/api';

const KEY = ['contas-bancarias'];

export function useContasBancarias() {
  return useQuery({ queryKey: KEY, queryFn: contasBancariasApi.listar });
}
export function useContaBancaria(cod: number | undefined) {
  return useQuery({
    queryKey: [...KEY, cod],
    queryFn: () => contasBancariasApi.ler(cod!),
    enabled: cod != null,
  });
}
/** Opções do LOOKUP de banco — vêm da API de Bancos (outra entidade). */
export function useBancoOptions() {
  return useQuery({
    queryKey: ['bancos', 'options'],
    queryFn: bancosApi.listar,
    select: (rows) =>
      rows.map((b) => ({ value: String(b.codbco), label: `${b.codbco} - ${b.banco}` })),
  });
}
export function useCriarContaBancaria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CriarContaBancariaDto) => contasBancariasApi.criar(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
export function useAtualizarContaBancaria(cod: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: AtualizarContaBancariaDto) => contasBancariasApi.atualizar(cod, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
export function useExcluirContaBancaria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cod: number) => contasBancariasApi.excluir(cod),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
