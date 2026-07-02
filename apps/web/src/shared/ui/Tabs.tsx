import { type ReactNode } from 'react';

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
 * Teclado/ARIA: role=tablist/tab; a aba ativa é `aria-selected`. Abas `disabled` aparecem esmaecidas
 * (fidelidade de layout: o legado mostra a aba mesmo quando o conteúdo é de fase futura).
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
  if (variant === 'sub') {
    return (
      <div role="tablist" className="flex flex-wrap items-end gap-gp-xs border-b border-border">
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={on}
              disabled={t.disabled}
              onClick={() => onChange(t.id)}
              className={[
                'cursor-pointer border-0 bg-transparent px-pad-sm py-gp-xs text-body-sm',
                '-mb-px border-b-2',
                on
                  ? 'border-fg-link font-semibold text-fg-default'
                  : 'border-transparent text-fg-muted hover:text-fg-default',
                t.disabled ? 'cursor-not-allowed opacity-50 hover:text-fg-muted' : '',
              ].join(' ')}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    );
  }

  // variant === 'main' — abas de folder (quebram em 2 linhas como o legado)
  return (
    <div role="tablist" className="flex flex-wrap gap-gp-xs border-b border-border pb-px">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={on}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            className={[
              'cursor-pointer rounded-t-radius-base border px-pad-sm py-gp-xs text-body-sm',
              on
                ? 'border-border border-b-bg-surface bg-bg-surface font-semibold text-fg-default'
                : 'border-transparent text-fg-muted hover:bg-bg-subtle hover:text-fg-default',
              t.disabled ? 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-fg-muted' : '',
            ].join(' ')}
          >
            {t.label}
          </button>
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
