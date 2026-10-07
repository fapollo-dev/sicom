import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHeaders, handle401 } from '../auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export type LinhaDaView = Record<string, any>;

/**
 * As linhas da view SÓ dos códigos exibidos numa grade (a Pesquisa com `contido`): para mostrar o nome ao lado do código sem carregar a
 * tabela inteira — o combo de `useResourceOptions` trazia 200 linhas sem ordem e a grade caía no código cru para o resto (47.812
 * produtos, 19.089 parceiros, 11.028 contas na produção). Devolve um Map código → linha (vazio enquanto carrega).
 */
export function useLinhasDosCodigos(recurso: string, campo: string, codigos: ReadonlyArray<unknown>): Map<string, LinhaDaView> {
  const valor = [...new Set(codigos.filter((c) => c != null && String(c).trim() !== '').map((c) => String(c).trim()))].sort().join(',');
  const { data } = useQuery({
    queryKey: ['lookup-linhas', recurso, campo, valor],
    enabled: valor !== '',
    placeholderData: (anterior) => anterior,
    queryFn: async () => {
      const qs = new URLSearchParams({ recurso, campo, operacao: 'contido', valor, situacao: 'todos', porPagina: '1000' });
      const r = await fetch(`${BASE}/cadastro/pesquisa?${qs.toString()}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) throw new Error(r.statusText);
      return ((await r.json()) as { linhas: LinhaDaView[] }).linhas;
    },
  });
  return useMemo(() => new Map((data ?? []).map((l) => [String(l[campo]).trim(), l])), [data, campo]);
}
