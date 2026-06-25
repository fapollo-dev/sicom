import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

/**
 * Escopo de atalhos (ADR-010). Substitui o `accesskey` do browser (inconsistente)
 * por um registro próprio com escopo — Alt+S em uma tela não colide com Alt+S em outra.
 * Cada escopo registra acceleradores (Alt+letra) e atalhos (F-keys/Ctrl).
 */
type Handler = (e: KeyboardEvent) => void;

interface ScopeRegistry {
  bind(combo: string, handler: Handler): () => void;
}

const ShortcutContext = createContext<ScopeRegistry | null>(null);

export function useShortcutRegistry(): ScopeRegistry {
  const reg = useContext(ShortcutContext);
  if (!reg) throw new Error('useShortcut* fora de <ShortcutScope>');
  return reg;
}

function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.altKey) parts.push('alt');
  if (e.ctrlKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  parts.push(e.key.toLowerCase());
  return parts.join('+');
}

export function ShortcutScope({ children }: { children: ReactNode }) {
  const handlers = useRef(new Map<string, Set<Handler>>());

  const registry = useMemo<ScopeRegistry>(
    () => ({
      bind(combo, handler) {
        const key = combo.toLowerCase();
        let set = handlers.current.get(key);
        if (!set) {
          set = new Set();
          handlers.current.set(key, set);
        }
        set.add(handler);
        return () => set!.delete(handler);
      },
    }),
    [],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const set = handlers.current.get(comboFromEvent(e));
      if (set && set.size) {
        e.preventDefault();
        for (const h of set) h(e);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <ShortcutContext.Provider value={registry}>
      {children}
    </ShortcutContext.Provider>
  );
}
