/**
 * A LISTA PRONTA para as etiquetas de preço (o legado cria o TfrmEtiqueta já com o cdsImpressao preenchido): a tela de origem deixa os
 * produtos e navega para as etiquetas, que pedem ao servidor as linhas de cada um (`/cadastro/etiqueta/de-itens`). Vive em `shared`
 * porque a Pesquisa (frmPesquisa, o &Etiquetas) também entrega a lista.
 */
export type FonteEtiquetas = 'cadastro' | 'precificacao' | 'precos-alterados' | 'nf' | 'pesquisa';
export interface PedidoDeItens {
  fonte: FonteEtiquetas;
  codnf?: number;
  itens?: Array<{ idproduto: number; valor?: number }>;
  /** as linhas entram marcadas para imprimir (padrão) ou não — as da Pesquisa entram desmarcadas (`IMPRIMIR := False`, uPesquisa.pas) */
  marcar?: boolean;
}

const CHAVE_ITENS = 'apollo.etiquetas.itens';
const ROTA_ETIQUETAS = '/estoque/etiquetas';

export function abrirEtiquetasCom(pedido: PedidoDeItens, navigate: (to: string) => void): void {
  try { sessionStorage.setItem(CHAVE_ITENS, JSON.stringify(pedido)); } catch { /* sem storage: a tela abre vazia */ }
  navigate(ROTA_ETIQUETAS);
}
export function lerPedidoDeItens(): PedidoDeItens | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(CHAVE_ITENS) ?? 'null') as PedidoDeItens | null;
    sessionStorage.removeItem(CHAVE_ITENS);
    return p?.fonte ? p : null;
  } catch { return null; }
}
