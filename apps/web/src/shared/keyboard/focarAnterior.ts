const FOCAVEIS =
  'input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Alt+← do `TfrmMaster` (`Perform(WM_NEXTDLGCTL, 1, 0)`): o foco volta ao controle anterior na ordem de tabulação (a do DOM), dentro
 * do container (o conteúdo da tela).
 */
export function focarAnterior(container: HTMLElement | null): void {
  if (!container) return;
  const lista = Array.from(container.querySelectorAll<HTMLElement>(FOCAVEIS));
  const atual = document.activeElement as HTMLElement | null;
  const i = atual ? lista.indexOf(atual) : -1;
  const alvo = i > 0 ? lista[i - 1] : lista[lista.length - 1];
  alvo?.focus();
}
