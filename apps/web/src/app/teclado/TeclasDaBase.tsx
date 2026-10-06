import { useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShortcut, useEnterAdvances, focarAnterior } from '../../shared/keyboard';
import { TrocarEmpresaModal } from './TrocarEmpresaModal';

/** há janela, menu ou lista aberta por cima da tela: o Esc é dela (fecha o modal/menu), não da tela */
function algoAbertoPorCima(): boolean {
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"][data-state="open"], [data-radix-popper-content-wrapper]');
}

/**
 * As teclas que TODA tela herda do form-base `TfrmMaster` (uMaster.pas, `FormKeyDown`/`FormKeyPress`, `KeyPreview = True`):
 *  - Esc fecha a tela (`Self.Close`) — aqui volta ao Início, o menu sem tela aberta; o cadastro em edição segura o Esc antes;
 *  - Enter vira Tab fora das grades (`Keybd_event(VK_TAB)`);
 *  - Alt+← volta ao controle anterior (`Perform(WM_NEXTDLGCTL, 1, 0)`);
 *  - Ctrl+E troca de empresa (`dmPrincipal.TrocarEmpresa(True)`; o legado não troca com o pedido de compra aberto).
 * Ctrl+Shift+S/D ("status da tela") só vale nas telas liberadas do `TStatusTela` — na produção, só a Pesquisa (corte próprio).
 */
export function TeclasDaBase({ conteudoRef }: { conteudoRef: RefObject<HTMLElement | null> }) {
  const navigate = useNavigate();
  const [trocaAberta, setTrocaAberta] = useState(false);
  // o modal fecha no próprio Esc (o ouvinte dele roda antes do nosso): o estado "havia janela aberta" é lido na CAPTURA, no início
  // da tecla, para o mesmo Esc não fechar a janela e a tela
  const escComJanela = useRef(false);
  useEffect(() => {
    const cap = (e: KeyboardEvent) => { if (e.key === 'Escape') escComJanela.current = algoAbertoPorCima(); };
    window.addEventListener('keydown', cap, true);
    return () => window.removeEventListener('keydown', cap, true);
  }, []);
  useEnterAdvances(conteudoRef);
  useShortcut('escape', (e) => {
    // a janela/menu aberto, ou um campo da tela que já tratou o Esc (cancelar a edição da célula), fica com a tecla
    if (escComJanela.current || algoAbertoPorCima() || e.defaultPrevented) return false;
    navigate('/inicio');
  });
  useShortcut('alt+arrowleft', () => focarAnterior(conteudoRef.current));
  useShortcut('ctrl+e', () => {
    // "Ocorrem vários erros na tela de pedido ao trocar de empresa com ela aberta" — o legado não troca com o pedido de compra aberto
    if (window.location.pathname.startsWith('/compras/pedidos')) return;
    setTrocaAberta(true);
  });
  return trocaAberta ? <TrocarEmpresaModal onFechar={() => setTrocaAberta(false)} /> : null;
}
