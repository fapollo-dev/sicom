import { useEffect, useState } from 'react';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';
import { apiHeaders } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/**
 * O FILTRO DE PRODUTOS do relatório de vendas (MultiProdutos, URelVendas.pas:1253-1265, :3419-3447): com a
 * FILTRA_PRODUTOS_RELATORIO_VENDAS = 'S', o Gerar dos relatórios 01, 22 e 46 pergunta "Deseja realizar o filtro de produtos?" e abre a
 * Pesquisa dos produtos das lojas em multisseleção (no máximo 1.000 vão ao relatório); fechar sem marcar segue sem o filtro.
 * `pedir(seguir)` faz a pergunta e chama `seguir` com a escolha; `elemento` é a Pesquisa aberta e o aviso do filtro ativo.
 */
export function useFiltroProdutosVendas() {
  const [filtraProdutos, setFiltraProdutos] = useState(false);
  const [produtosSel, setProdutosSel] = useState<number[] | undefined>(undefined);
  const [seguirApos, setSeguirApos] = useState<((p: number[] | undefined) => void) | null>(null);
  useEffect(() => {
    fetch(`${BASE}/relatorios/vendas/opcoes`, { headers: apiHeaders() })
      .then((r) => (r.ok ? r.json() : { filtraProdutos: false }))
      .then((o: { filtraProdutos?: boolean }) => setFiltraProdutos(!!o.filtraProdutos))
      .catch(() => setFiltraProdutos(false));
  }, []);

  const pedir = (seguir: (produtos: number[] | undefined) => void) => {
    if (filtraProdutos && window.confirm('Deseja realizar o filtro de produtos?')) { setSeguirApos(() => seguir); return; }
    setProdutosSel(undefined);
    seguir(undefined);
  };
  const concluir = (linhas: Array<Record<string, unknown>>) => {
    const seguir = seguirApos;
    setSeguirApos(null);
    const ids = [...new Set(linhas.map((l) => Number(l.codigo)))].filter((x) => Number.isInteger(x) && x > 0).slice(0, 1000);
    const sel = ids.length ? ids : undefined;
    setProdutosSel(sel);
    seguir?.(sel);
  };
  const desistir = () => {
    const seguir = seguirApos;
    setSeguirApos(null);
    setProdutosSel(undefined);
    seguir?.(undefined);
  };

  const elemento = (
    <>
      {produtosSel?.length ? (
        <small className="text-fg-muted">
          {produtosSel.length} produto(s) filtrado(s){' '}
          <button type="button" className="underline" onClick={() => setProdutosSel(undefined)}>tirar o filtro</button>
        </small>
      ) : null}
      {seguirApos && (
        <Pesquisa resourcePath="relatorios/vendas-produtos" multisselecao onSelecionarVarios={concluir}
          onSelecionar={(l) => concluir([l])} onFechar={desistir} />
      )}
    </>
  );
  return { produtosSel, pedir, elemento };
}
