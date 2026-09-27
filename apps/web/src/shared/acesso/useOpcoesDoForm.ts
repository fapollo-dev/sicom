import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHeaders, handle401 } from '../auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/**
 * As PERMISSÕES DE CONTROLE do operador numa tela (`uMaster.SetStateOfControlsMaster` do legado): o campo ou botão cujo nome é uma
 * opção de PERMISSOES só fica habilitado para quem a tem. Enquanto a lista não chega, nada é liberado (a gravação confere de novo).
 */
export function useOpcoesDoForm(form: string): { tem: (opcao: string) => boolean; carregado: boolean } {
  const { data, isSuccess } = useQuery({
    queryKey: ['acesso/opcoes', form],
    queryFn: async () => {
      const r = await fetch(`${BASE}/cadastro/acesso/opcoes/${encodeURIComponent(form)}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) return [] as string[];
      return ((await r.json()) as { opcoes?: string[] }).opcoes ?? [];
    },
    staleTime: 60_000,
  });
  const conjunto = useMemo(() => new Set((data ?? []).map((o) => o.toUpperCase())), [data]);
  const tem = useCallback((opcao: string) => conjunto.has(opcao.toUpperCase()), [conjunto]);
  return { tem, carregado: isSuccess };
}
