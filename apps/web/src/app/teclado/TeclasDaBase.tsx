import { useState, type RefObject } from 'react';
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
  useEnterAdvances(conteudoRef);
  useShortcut('escape', () => {
    if (algoAbertoPorCima()) return false;
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
