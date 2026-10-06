import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

/**
 * Escopo de atalhos (ADR-010). Substitui o `accesskey` do browser (inconsistente) por um registro próprio com escopo — Alt+S numa
 * tela não colide com Alt+S em outra. Cada escopo registra aceleradores (Alt+letra) e atalhos (F-keys/Ctrl/Esc).
 *
 * PILHA DE ESCOPOS: há UM ouvinte de teclado na janela; a tecla vai primeiro ao escopo mais interno (o painel/form ativo — como o
 * `KeyPreview` do form Delphi que está em cima) e só desce ao de fora se ninguém ali a tratou. O handler devolve `false` para
 * dizer "não é comigo" (ex.: o Esc do cadastro em browse, que deixa a tecla para a base fechar a tela).
 */
export type Handler = (e: KeyboardEvent) => void | boolean;

interface ScopeRegistry {
  bind(combo: string, handler: Handler): () => void;
  profundidade: number;
}

interface Escopo {
  handlers: Map<string, Set<Handler>>;
  profundidade: number;
  ordem: number;
}

const ShortcutContext = createContext<ScopeRegistry | null>(null);
const pilha: Escopo[] = [];
let contador = 0;
let instalado = false;

export function useShortcutRegistry(): ScopeRegistry {
  const reg = useContext(ShortcutContext);
  if (!reg) throw new Error('useShortcut* fora de <ShortcutScope>');
  return reg;
}

/** a combinação da tecla: modificadores + a tecla; letras e dígitos pelo `code` (Alt+O no Mac dá 'ø' em `key`) */
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.altKey) parts.push('alt');
  if (e.ctrlKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  const code = e.code ?? '';
  const tecla = code.startsWith('Key') ? code.slice(3).toLowerCase()
    : code.startsWith('Digit') ? code.slice(5)
      : (e.key ?? '').toLowerCase();
  parts.push(tecla === 'esc' ? 'escape' : tecla);
  return parts.join('+');
}

function instalar() {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;
  window.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const combo = comboFromEvent(e);
    // o mais interno primeiro; no mesmo nível, o montado por último (o painel que abriu por cima)
    const ordem = [...pilha].sort((a, b) => b.profundidade - a.profundidade || b.ordem - a.ordem);
    for (const esc of ordem) {
      const set = esc.handlers.get(combo);
      if (!set || !set.size) continue;
      // a tecla é de UM handler (como na VCL: com dois controles no mesmo acelerador, só o primeiro que aceita o foco leva — antes,
      // Alt+C acionava os dois "&Cancelar" da baixa). No mesmo escopo, o registrado por último primeiro (o painel que abriu
      // depois); o handler que devolve false (desabilitado, fora da tela) passa a tecla ao próximo.
      for (const h of [...set].reverse()) {
        if (h(e) !== false) {
          e.preventDefault();
          return;
        }
      }
    }
  });
}

export function ShortcutScope({ children }: { children: ReactNode }) {
  const pai = useContext(ShortcutContext);
  const escopo = useRef<Escopo>({ handlers: new Map(), profundidade: (pai?.profundidade ?? -1) + 1, ordem: 0 });

  const registry = useMemo<ScopeRegistry>(
    () => ({
      profundidade: escopo.current.profundidade,
      bind(combo, handler) {
        const key = combo.toLowerCase();
        let set = escopo.current.handlers.get(key);
        if (!set) {
          set = new Set();
          escopo.current.handlers.set(key, set);
        }
        set.add(handler);
        return () => set!.delete(handler);
      },
    }),
    [],
  );

  useEffect(() => {
    instalar();
    const e = escopo.current;
    e.ordem = ++contador;
    pilha.push(e);
    return () => {
      const i = pilha.indexOf(e);
      if (i >= 0) pilha.splice(i, 1);
    };
  }, []);

  return (
    <ShortcutContext.Provider value={registry}>
      {children}
    </ShortcutContext.Provider>
  );
}

/**
 * Um atalho no escopo da tela (o `OnKeyDown` com `KeyPreview` do form / o `ShortCut` de uma TAction): `useShortcut('f9', consultar)`.
 * `when` = o `Enabled` da action (desligado, a tecla segue para o escopo de fora). O handler pode devolver `false` para não tratar.
 */
export function useShortcut(combo: string, handler: Handler, opts?: { when?: boolean }) {
  const reg = useShortcutRegistry();
  const ref = useRef(handler);
  ref.current = handler;
  const ativo = opts?.when ?? true;
  useEffect(() => {
    if (!ativo) return;
    return reg.bind(combo, (e) => ref.current(e));
  }, [combo, ativo, reg]);
}
