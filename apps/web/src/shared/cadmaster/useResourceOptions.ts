import { useQuery } from '@tanstack/react-query';
import { createResourceApi } from './resourceApi';

export interface Opcao {
  value: string;
  label: string;
}

/**
 * Opções de um LOOKUP/FK a partir de OUTRO recurso (espelha o lookup data-bound do
 * legado: combo populado por uma tabela relacionada). Lista o recurso e mapeia cada
 * linha para {value,label}. Usado no corpo da tela; as opções entram na render-prop.
 */
export function useResourceOptions<T = any>(
  resourcePath: string,
  mapRow: (row: T) => Opcao,
) {
  return useQuery({
    queryKey: [resourcePath, 'options'],
    queryFn: () => createResourceApi<T>(resourcePath).listar(),
    select: (rows) => rows.map(mapRow),
  });
}
