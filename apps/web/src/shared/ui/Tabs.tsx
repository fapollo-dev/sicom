import { type KeyboardEvent, type ReactNode } from 'react';

export type TabDef = {
  id: string;
  label: string;
  /** aba presente no layout do legado mas ainda inerte (fase futura) — some ações, não some a aba. */
  disabled?: boolean;
};

/**
 * Barra de abas do app — reproduz o strip de abas do legado (`TfrmNF` tem ~15 abas em 2 linhas +
 * sub-abas) com o VISUAL do design system (tokens Apollo). Duas variantes:
 *  - `main`  → abas de folder (linha que quebra em 2, como o legado); a ativa "senta" na área de conteúdo.
 *  - `sub`   → sub-abas (Impostos Internos/ICMS ST…/Retenções; Dados da cobrança/Documentos…) em sublinhado.
 *
 * NAVEGAÇÃO ≠ FORMULÁRIO: as abas são `<div role="tab">` (não `<button>`) DE PROPÓSITO — assim
 * continuam clicáveis mesmo quando a tela está em modo navegação e os CAMPOS estão dentro de um
 * `<fieldset disabled>` (que desabilitaria botões, mas não elementos não-form). Teclado: Enter/Espaço
 * ativam; ←/→ movem entre abas habilitadas. ARIA: role=tablist/tab + aria-selected/aria-disabled.
 */
export function Tabs({
  tabs,
  active,
  onChange,
  variant = 'main',
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  variant?: 'main' | 'sub';
}) {
  const idxAtivo = tabs.findIndex((t) => t.id === active);

  const irPara = (delta: number) => {
    const n = tabs.length;
    for (let i = 1; i <= n; i++) {
      const t = tabs[(idxAtivo + delta * i + n * i) % n];
      if (t && !t.disabled) {
        onChange(t.id);
        return;
      }
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>, t: TabDef) => {
    if ((e.key === 'Enter' || e.key === ' ') && !t.disabled) {
      e.preventDefault();
      onChange(t.id);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      irPara(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      irPara(-1);
    }
  };

  const isSub = variant === 'sub';
  const listCls = isSub
    ? 'flex flex-wrap items-end gap-gp-xs border-b border-border'
    : 'flex flex-wrap gap-gp-xs border-b border-border pb-px';

  return (
    <div role="tablist" className={listCls}>
      {tabs.map((t) => {
        const on = t.id === active;
        const base = 'cursor-pointer select-none text-body-sm';
        const cls = isSub
          ? [
              base,
              'px-pad-sm py-gp-xs -mb-px border-b-2',
              on ? 'border-fg-link font-semibold text-fg-default' : 'border-transparent text-fg-muted hover:text-fg-default',
              t.disabled ? 'cursor-not-allowed opacity-50 hover:text-fg-muted' : '',
            ]
          : [
              base,
              'rounded-t-radius-base border px-pad-sm py-gp-xs',
              on
                ? 'border-border border-b-bg-surface bg-bg-surface font-semibold text-fg-default'
                : 'border-transparent text-fg-muted hover:bg-bg-subtle hover:text-fg-default',
              t.disabled ? 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-fg-muted' : '',
            ];
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={on}
            aria-disabled={t.disabled || undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => !t.disabled && onChange(t.id)}
            onKeyDown={(e) => onKey(e, t)}
            className={cls.join(' ')}
          >
            {t.label}
          </div>
        );
      })}
    </div>
  );
}

/** painel de conteúdo da aba (moldura que "recebe" a aba ativa, como a área de abas do legado). */
export function TabPanel({ children }: { children: ReactNode }) {
  return (
    <div
      role="tabpanel"
      className="rounded-b-radius-base rounded-tr-radius-base border border-t-0 border-border bg-bg-surface p-pad-md"
    >
      {children}
    </div>
  );
}
