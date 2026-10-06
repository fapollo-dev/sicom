import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(container: HTMLElement): HTMLElement[] {
  // querySelectorAll já exclui disabled/hidden/tabindex=-1; mantemos a ordem do DOM
  // (= taborder reconstruída). Não filtramos por offsetParent (quebra em jsdom).
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * Enter-avança-campo (ADR-010): replica o `FormKeyPress` do `TfrmMaster` (Enter vira Tab — `Keybd_event(VK_TAB)` — fora das grades),
 * preservando a memória muscular. Em `<textarea>` Enter mantém o comportamento nativo (quebra de linha); em botão, aciona (o
 * `CM_DIALOGKEY` do VCL). No último campo de um `<form>`, dispara o submit (o botão Default).
 * Não avança quando: outro ouvinte já tratou o Enter (`defaultPrevented` — o escopo interno, ex. o form do cadastro dentro da
 * casca), o campo está numa grade (`role="grid"`, o TDBGrid/TJvDBUltimGrid que o legado exclui) ou o campo/ancestral é marcado
 * `data-enter="nativo"` (o Enter confirma, como a célula em edição ou o código+Enter que carrega).
 */
export function useEnterAdvances(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.defaultPrevented || e.isComposing) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-enter="nativo"], [role="grid"]')) return;
      const tag = target.tagName.toLowerCase();
      if (tag === 'textarea' || tag === 'button') return;
      if (tag !== 'input' && tag !== 'select') return;
      const type = (target as HTMLInputElement).type;
      if (type === 'submit' || type === 'button') return;
      e.preventDefault();
      const list = focusables(el);
      const idx = list.indexOf(target);
      const next = list.slice(idx + 1).find((n) => n.tagName.toLowerCase() !== 'button');
      if (next) next.focus();
      else if (el.tagName === 'FORM') (el as HTMLFormElement).requestSubmit?.();
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [containerRef]);
}
