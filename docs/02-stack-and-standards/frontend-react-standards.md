# Padrões de Frontend (React)

> Como estruturar o frontend React: feature-based, server state com React Query, forms com react-hook-form+zod, **uma base de código rodando em duas cascas (browser e Electron)**, componentes sobre o design system, grid teclado-first e estado de cliente mínimo.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-008** (mesma app React, duas cascas), ADR-010 (teclado é primeira classe).
- [tech-stack.md](tech-stack.md) — versões e o porquê de Radix/React Query/AG Grid.
- [keyboard-ux-layer.md](keyboard-ux-layer.md) — **a camada de teclado**, que toda tela herda (taborder, Enter-avança, mnemônicos `&`).
- [../09-design-system-and-ai/](../09-design-system-and-ai/) — o design system (fork rebrand verde→azul, ADR-013) que veste os componentes.

---

## Princípio: o frontend é o `TForm` reconstruído, não redesenhado

Cada `TForm` do Delphi vira uma **feature** com sua rota. O critério de aceite é a **memória muscular do operador** (ADR-010): mesma taborder, mesmos atalhos, mesmo Enter-avança-campo. O React aqui é infraestrutura; a UX de teclado (vinda de [keyboard-ux-layer.md](keyboard-ux-layer.md)) é o produto.

---

## Estrutura feature-based

Organização por **feature de domínio**, não por tipo de arquivo. Espelha os módulos do backend ([backend-nestjs-standards.md](backend-nestjs-standards.md)) para que a fronteira seja a mesma dos dois lados.

```
src/
  features/
    vendas/
      routes/VendaListPage.tsx        # rota = um TForm
      routes/VendaFormPage.tsx
      components/ItemVendaGrid.tsx     # grid teclado-first específico
      hooks/useVendas.ts               # React Query: queries/mutations da feature
      api/vendas.api.ts                # cliente HTTP tipado
      schema/venda.schema.ts           # zod COMPARTILHADO com o backend
    estoque/ …
    cadastro/ …
    fiscal/ …
  shared/
    ui/                                # biblioteca de componentes sobre o design system (seção 09)
      Button.tsx  Field.tsx  Modal.tsx  DataGrid.tsx
    keyboard/                          # a camada de teclado (ver keyboard-ux-layer.md)
      ShortcutScope.tsx  useEnterAdvances.ts  useMnemonics.ts  TabOrderBoundary.tsx
    query/queryClient.ts               # config do React Query
    shell/                             # detecção e bindings da casca (browser | electron)
      platform.ts  electronBridge.ts
  app/
    router.tsx                         # React Router: árvore de rotas
    providers.tsx                      # QueryClientProvider + ShortcutProvider + tema
    main.tsx                           # entry — idêntico nas duas cascas
```

Regra: **um arquivo, uma responsabilidade**; a `feature` é dona da sua API, schema, hooks e telas. `shared/ui` e `shared/keyboard` são transversais e estáveis.

---

## Duas cascas, código único (ADR-008)

A **mesma** app React empacotada pelo Vite roda em duas cascas: **browser** (uso casual) e **Electron** (PDV + superfícies teclado-pesado, onde o controle total do teclado importa — ver caveat em [keyboard-ux-layer.md](keyboard-ux-layer.md)). **Proibido fork** "versão web" vs "versão Electron" (ADR-002/008). O que muda é isolado atrás de uma fina camada de plataforma.

```ts
// shared/shell/platform.ts — detecção da casca; o resto do app não sabe onde roda
export const isElectron = typeof window !== 'undefined' && !!window.electron;

export interface PlatformCapabilities {
  /** Electron permite capturar TODAS as teclas (Ctrl+W/F5/F11); browser não. */
  ownsKeyboard: boolean;
  /** acesso a periféricos (impressora fiscal, balança, pinpad) — só Electron */
  hasDevices: boolean;
}

export const platform: PlatformCapabilities = isElectron
  ? { ownsKeyboard: true,  hasDevices: true  }
  : { ownsKeyboard: false, hasDevices: false };
```

```tsx
// um componente que se adapta SEM ramificar a base de código
function PrintButton({ docId }: { docId: string }) {
  const print = useReactQueryMutation(/* ... */);
  return (
    <Button
      label="&Imprimir"                       // mnemônico Alt+I — ver keyboard-ux-layer.md
      onClick={() =>
        platform.hasDevices
          ? window.electron!.printFiscal(docId) // impressora fiscal via bridge Electron
          : print.mutate(docId)                 // fallback: PDF no browser
      }
    />
  );
}
```

> O `ownsKeyboard` é consumido pela camada de teclado para saber quais atalhos pode reivindicar. No browser, Ctrl+W/F5/Ctrl+P são do navegador; no Electron, são nossos. Detalhe e a tabela completa em [keyboard-ux-layer.md](keyboard-ux-layer.md).

---

## Server state com React Query (não Redux)

O estado de servidor (listas, registros, totais) vive no **TanStack React Query** — ele substitui o par `TDataSource`/`TQuery` do Delphi: cache, refetch, invalidação e estados de loading/erro prontos. **Não** colocamos dados de servidor em store global de cliente.

```ts
// features/vendas/hooks/useVendas.ts
export function useVendas(filtro: FiltroVenda) {
  return useQuery({
    queryKey: ['vendas', filtro],
    queryFn: () => vendasApi.buscar(filtro),
    placeholderData: keepPreviousData, // mantém a grade enquanto refiltra (UX de retaguarda)
  });
}

export function useRegistrarVenda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: vendasApi.registrar,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendas'] }), // revalida a lista
  });
}
```

```ts
// features/vendas/api/vendas.api.ts — cliente HTTP tipado pelo schema compartilhado
import { criarVendaSchema, type CriarVendaDto } from '../schema/venda.schema';

export const vendasApi = {
  buscar: (f: FiltroVenda) => http.get<Venda[]>('/vendas', { params: f }),
  registrar: (dto: CriarVendaDto) => http.post<Venda>('/vendas', criarVendaSchema.parse(dto)),
};
```

> Paginação de listas grandes usa **keyset/cursor** (ADR-007), não offset — o `queryKey` carrega o cursor. Ver [performance-playbook.md](performance-playbook.md) para o contrato de cursor que o backend expõe.

---

## Forms com react-hook-form + zod

Forms com **react-hook-form** (inputs uncontrolled → sem re-render por tecla, casa com Enter-avança-campo) validados pelo **mesmo `zod`** schema do backend. Schema único = a regra de validação não diverge entre as camadas.

```tsx
// features/cadastro/routes/ProdutoFormPage.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { produtoSchema, type ProdutoForm } from '../schema/produto.schema';

export function ProdutoFormPage() {
  const { register, handleSubmit, formState: { errors } } = useForm<ProdutoForm>({
    resolver: zodResolver(produtoSchema),        // MESMO schema que o DTO do backend
    mode: 'onBlur',
  });
  const salvar = useSalvarProduto();

  return (
    // FormScope ativa: Enter-avança-campo + mnemônicos &  (ver keyboard-ux-layer.md)
    <FormScope onSubmit={handleSubmit((d) => salvar.mutate(d))}>
      <Field label="&Descrição" error={errors.descricao} {...register('descricao')} autoFocus />
      <Field label="Preço de &venda" type="number" error={errors.precoVenda} {...register('precoVenda', { valueAsNumber: true })} />
      <Button type="submit" label="&Salvar" />     {/* Alt+S e Enter no último campo confirmam */}
      <Button type="button" label="&Cancelar" variant="ghost" /> {/* Esc/Alt+C */}
    </FormScope>
  );
}
```

O `FormScope` é o componente da camada de teclado que liga Enter-avança-campo e os mnemônicos `&` ao escopo do form — detalhado em [keyboard-ux-layer.md](keyboard-ux-layer.md). O componente de form **não reimplementa** teclado; herda.

---

## Routing

**React Router**: a árvore de rotas é o mapa de `TForm`s. Mesma árvore nas duas cascas (no Electron roda em `HashRouter` ou `MemoryRouter` por causa do `file://`).

```tsx
// app/router.tsx
const router = createBrowserRouter([          // HashRouter no Electron
  { path: '/', element: <Shell />, children: [
    { path: 'vendas',          element: <VendaListPage /> },
    { path: 'vendas/nova',     element: <VendaFormPage /> },
    { path: 'cadastro/produto/:id?', element: <ProdutoFormPage /> },
  ]},
]);
```

---

## Biblioteca de componentes sobre o design system

`shared/ui` é a **fina camada de componentes** que (1) veste o design system da seção 09 (rebrand verde→azul, ADR-013) e (2) **embute a camada de teclado**. Toda tela usa `shared/ui`, nunca Radix/AG Grid crus — assim teclado e tema ficam consistentes por construção.

```tsx
// shared/ui/Button.tsx — Radix headless + design system + mnemônico &
import * as RadixSlot from '@radix-ui/react-slot';
import { useMnemonic } from '../keyboard/useMnemonics';

export function Button({ label, onClick, variant = 'primary', ...rest }: ButtonProps) {
  // parseia o & do label, registra Alt+letra no escopo ativo, devolve o JSX com sublinhado
  const { text, accelerator } = useMnemonic(label, () => onClick?.());
  return (
    <button className={dsButton({ variant })} onClick={onClick} {...rest}>
      {text /* já contém o <u> da letra mnemônica */}
    </button>
  );
}
```

> `useMnemonic`/`useEnterAdvances`/`ShortcutScope` vivem em `shared/keyboard` e são a implementação do ADR-010 — toda a profundidade (parsing do `&`, render do sublinhado, escopo, caveat do browser) está em [keyboard-ux-layer.md](keyboard-ux-layer.md). Aqui o ponto é arquitetural: **componentes de UI consomem a camada de teclado; telas consomem componentes de UI.**

---

## Grid teclado-first

O `TDBGrid` era o centro da retaguarda. No alvo, `shared/ui/DataGrid` embrulha **AG Grid** (ou TanStack Table) com navegação por seta, Enter edita célula, Tab entre células, Enter confirma linha. Listas grandes paginam por keyset.

```tsx
// shared/ui/DataGrid.tsx — grid teclado-first sobre AG Grid
export function DataGrid<T>({ columns, rows, onRowEnter }: DataGridProps<T>) {
  return (
    <AgGridReact<T>
      columnDefs={columns}
      rowData={rows}
      navigateToNextCell={tabAwareNavigation}   // Tab/Setas mapeados ao comportamento do TDBGrid
      onCellKeyDown={(e) => { if (e.event?.key === 'Enter') onRowEnter?.(e.data); }}
      singleClickEdit={false}                    // Enter entra em edição, como no legado
      suppressRowClickSelection
    />
  );
}
```

Detalhe de roving tabindex, edição inline e mapeamento exato das teclas do `TDBGrid` em [keyboard-ux-layer.md](keyboard-ux-layer.md).

---

## Estado de cliente mínimo

Regra: **estado de servidor → React Query**; **estado de UI local → `useState`/`useReducer` no componente**; estado **realmente** global de cliente (usuário logado, tenant/loja ativa, tema, casca) → um Context pequeno. **Não** há Redux global de dados de domínio.

```tsx
// app/providers.tsx
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>     {/* server state */}
      <SessionProvider>                            {/* usuário, tenant, loja, casca */}
        <ShortcutProvider>                         {/* registro central de atalhos — keyboard-ux-layer */}
          <ThemeProvider>{children}</ThemeProvider>{/* design system seção 09 */}
        </ShortcutProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
```

| Tipo de estado | Onde mora | Exemplo |
|----------------|-----------|---------|
| Servidor | React Query | lista de vendas, saldo de estoque, totais |
| UI local | `useState`/`useReducer` | aba ativa, modal aberto, rascunho de filtro |
| Global de cliente | Context pequeno | usuário/tenant/loja, tema, `platform` |
| **Nunca** | Redux global de domínio | — |

---

## Tabela resumo (padrões do frontend)

| Tema | Padrão travado | Anti-padrão |
|------|----------------|-------------|
| Organização | Feature-based, espelha módulos do backend | Pasta por tipo (`/components`, `/services` globais) |
| Cascas | Uma app, `platform` isola diferenças (ADR-008) | Fork browser vs Electron |
| Server state | React Query | Dados de servidor em Redux |
| Forms | react-hook-form + zod (schema compartilhado) | Controlled inputs com re-render por tecla |
| Componentes | `shared/ui` sobre Radix + design system | Radix/AG Grid crus na tela; MUI/Chakra |
| Grid | `DataGrid` teclado-first (AG Grid) | `<table>` sem navegação por seta |
| Teclado | Herdado de `shared/keyboard` (ADR-010) | Reimplementar Tab/Enter/atalho por tela |
| Routing | React Router, mesma árvore nas duas cascas | Rotas duplicadas por casca |

---

## Ver também

- [keyboard-ux-layer.md](keyboard-ux-layer.md) — **a camada que toda tela herda** (ADR-010): taborder, Enter-avança, atalhos, mnemônicos `&`, grid.
- [tech-stack.md](tech-stack.md) — versões e justificativa (React Query, Radix, AG Grid, react-hook-form).
- [backend-nestjs-standards.md](backend-nestjs-standards.md) — os contratos/DTOs e o `zod` compartilhado.
- [performance-playbook.md](performance-playbook.md) — keyset/cursor que as listas consomem (ADR-007).
- [../09-design-system-and-ai/](../09-design-system-and-ai/) — design system (rebrand verde→azul, ADR-013).
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-008 e ADR-010.
