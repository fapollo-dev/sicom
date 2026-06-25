import { useQuery } from '@tanstack/react-query';
import { createResourceApi, type PesquisaParams } from './resourceApi';

export interface Opcao {
  value: string;
  label: string;
}

/**
 * Opções de um LOOKUP/FK a partir de OUTRO recurso (espelha o lookup data-bound do
 * legado: combo populado por uma tabela relacionada). Lista o recurso e mapeia cada
 * linha para {value,label}. Usado no corpo da tela; as opções entram na render-prop.
 *
 * `params` permite FILTRAR o recurso (ex.: vendedores = parceiros com FUN='S'):
 * `useResourceOptions('cadastro/parceiros', map, { campo:'fun', operador:'igual', valor:'S' })`.
 */
export function useResourceOptions<T = any>(
  resourcePath: string,
  mapRow: (row: T) => Opcao,
  params?: PesquisaParams,
) {
  return useQuery({
    queryKey: [resourcePath, 'options', params ?? null],
    queryFn: () => createResourceApi<T>(resourcePath).listar(params),
    select: (rows) => rows.map(mapRow),
  });
}
