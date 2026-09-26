import { useContext, useEffect } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';

/**
 * O `FormCloseQuery` do legado (27 units; o do `uCadMaster` vale para todos os cadastros): com alteração não gravada na tela, sair
 * pergunta antes. Vale para a navegação dentro do app (o `useBlocker` do roteador de dados) e para fechar/recarregar a aba
 * (`beforeunload`, cuja mensagem o navegador não deixa trocar). Fora de um roteador de dados (testes, telas soltas) fica só o da aba.
 */
export function useConfirmarSaida(ativo: boolean, mensagem = 'Deseja realmente sair da tela?'): void {
  const roteadorDeDados = useContext(UNSAFE_DataRouterContext) != null;
  // o contexto do roteador não muda durante a vida do componente: a chamada condicional é estável entre renderizações
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const bloqueio = roteadorDeDados ? useBlocker(({ currentLocation, nextLocation }) => ativo && currentLocation.pathname !== nextLocation.pathname) : null;
  useEffect(() => {
    if (!bloqueio || bloqueio.state !== 'blocked') return;
    if (window.confirm(mensagem)) bloqueio.proceed();
    else bloqueio.reset();
  }, [bloqueio, mensagem]);
  useEffect(() => {
    if (!ativo) return;
    const antes = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', antes);
    return () => window.removeEventListener('beforeunload', antes);
  }, [ativo]);
}
