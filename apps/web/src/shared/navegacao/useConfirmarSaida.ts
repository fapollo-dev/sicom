import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * O `FormCloseQuery` do legado (27 units): com alteração não gravada na tela, sair pergunta antes — "Deseja realmente sair da tela?"
 * (o texto do `uPrecificacaoNF.pas:680`). Vale para a navegação dentro do app (o `useBlocker` do roteador) e para fechar/recarregar a aba
 * (`beforeunload`, cuja mensagem o navegador não deixa trocar).
 */
export function useConfirmarSaida(ativo: boolean, mensagem = 'Deseja realmente sair da tela?'): void {
  const bloqueio = useBlocker(({ currentLocation, nextLocation }) => ativo && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (bloqueio.state !== 'blocked') return;
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
