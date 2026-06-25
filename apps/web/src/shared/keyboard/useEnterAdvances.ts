import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(container: HTMLElement): HTMLElement[] {
  // querySelectorAll já exclui disabled/hidden/tabindex=-1; mantemos a ordem do DOM
  // (= taborder reconstruída). Não filtramos por offsetParent (quebra em jsdom).
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * Enter-avança-campo (ADR-010): replica o comportamento do Delphi onde Enter
 * move para o próximo controle (não submete), preservando a memória muscular.
 * Em `<textarea>` Enter mantém o comportamento nativo (quebra de linha).
 * No último campo, dispara o submit do form (o botão Default).
 */
export function useEnterAdvances(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      const target = e.target as HTMLElement;
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
      else (el as HTMLFormElement).requestSubmit?.();
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [containerRef]);
}
