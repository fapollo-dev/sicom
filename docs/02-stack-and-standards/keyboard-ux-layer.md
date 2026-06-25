# Camada de UX de Teclado — ADR-010 (arquivo-coroa)

> A UX de teclado é **requisito de primeira classe** e **fundação compartilhada**: construída uma vez, toda tela herda. Replica **idêntico** ao Delphi — taborder, Enter-avança-campo, F-keys/Ctrl, foco, grid e mnemônicos `&` (Alt+letra sublinhada) — porque a **memória muscular do operador é o critério de aceite**.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-010** (teclado primeira classe; mnemônicos do `.dfm`; fiscal pinável) e **ADR-008** (Electron).
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — anti-objetivo: **não "modernizar" atalhos**; replicar o mapa exato.
- [../00-orientation/glossary.md](../00-orientation/glossary.md) — `TabOrder`/`KeyPreview`/`TActionList`/`&`/`FocusControl`.
- [frontend-react-standards.md](frontend-react-standards.md) — onde a camada se encaixa (`shared/keyboard`, `shared/ui`).
- [tech-stack.md](tech-stack.md) — Radix/React Aria, AG Grid, react-hotkeys-hook.

---

## Por que isto é a coroa

Num ERP de supermercado, o operador **não usa mouse**. A retaguarda e o PDV são fluxos de teclas decoradas há anos: Tab pula campo, Enter avança, F2 busca produto, Alt+S salva. Se a memória muscular quebrar, a adoção morre — não importa quão bonita a tela ficou. Por isso o teclado **não é feature de tela**: é uma **camada compartilhada** (`shared/keyboard`) que toda tela herda por construção, e que reproduz o comportamento do VCL **sem inventar**.

> Regra de ouro: **capture o mapa de teclado no dossiê (seção 04) e replique-o.** Taborder e atalhos viram dados do dossiê, extraídos do `.dfm`/`.pas`, e a tela só os consome. Ver [../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md).

---

## 1) Taborder

O Delphi tem `TabOrder` por controle (inteiro por container). No web, a ordem de tabulação é a **ordem do DOM** + `tabindex`. **Regra dura: nunca use `tabindex` positivo** — ele cria uma ordem global frágil que briga com a ordem natural e quebra a cada inserção de campo. Use a **ordem do DOM** para refletir o `TabOrder` e `tabindex="0"` só para tornar focável um elemento que normalmente não é. Foco programático para fluxos complexos (pular campo condicionalmente, como o `OnExit` fazia).

```tsx
// ✅ ordem do DOM = TabOrder. tabindex="0" só onde precisa tornar focável.
<FormScope>
  <Field label="&Código"    {...register('codigo')}    autoFocus />  {/* TabOrder 0 */}
  <Field label="&Descrição" {...register('descricao')} />            {/* TabOrder 1 */}
  <Field label="&Preço"     {...register('preco')} />                {/* TabOrder 2 */}
  <div role="button" tabIndex={0}>Selecionar imagem</div>            {/* div focável */}
</FormScope>

// ❌ NUNCA: tabindex positivo cria ordem global e quebra na próxima inserção
<input tabIndex={3} /> <input tabIndex={1} /> <input tabIndex={2} />
```

```tsx
// foco programático para fluxo condicional (o que o OnExit/OnEnter do Delphi fazia)
function CamposNcm() {
  const ncmRef = useRef<HTMLInputElement>(null);
  const cstRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Field label="&NCM" ref={ncmRef}
        onBlur={(e) => { if (precisaCst(e.target.value)) cstRef.current?.focus(); }} />
      <Field label="C&ST" ref={cstRef} />
    </>
  );
}
```

> Mapeamento: `TabOrder = N` → posição N na **ordem do DOM** dentro do container. O dossiê registra a sequência exata; um teste Playwright verifica que `Tab` percorre os campos nessa ordem (ver [../06-testing-quality/playwright-e2e.md](../06-testing-quality/playwright-e2e.md)).

---

## 2) Enter-avança-campo

Comportamento clássico de ERP: **Enter move o foco para o próximo campo**, não submete. O Delphi fazia isso interceptando `VK_RETURN` no `KeyPreview`/`OnKeyPress` do form e chamando `SelectNext`. Replicamos numa camada (`useEnterAdvances`/`FormScope`) que intercepta Enter e decide: **avança** no campo comum; **confirma** onde Enter de fato deve submeter (último campo, botão Default, grid).

```ts
// shared/keyboard/useEnterAdvances.ts — Enter avança; decide onde confirma
export function useEnterAdvances(scopeRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const el = scopeRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement;

      // textarea e botões: Enter mantém o papel nativo (quebra de linha / clique)
      if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return;

      // campo marcado para confirmar (último/submit) -> deixa submeter
      if (target.dataset.enterConfirms === 'true') return;

      e.preventDefault();                 // bloqueia o submit acidental
      focusNextField(el, target);         // SelectNext: próximo focável na ordem do DOM
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [scopeRef]);
}

function focusNextField(scope: HTMLElement, current: HTMLElement) {
  const focusables = [...scope.querySelectorAll<HTMLElement>(
    'input,select,[tabindex="0"],button[type="submit"]')]
    .filter(isVisibleEnabled);
  const i = focusables.indexOf(current);
  focusables[Math.min(i + 1, focusables.length - 1)]?.focus();
}
```

```tsx
// onde Enter confirma: marque o campo/botão (espelha Default=True do Delphi)
<Field label="&Quantidade" {...register('qtd')} data-enter-confirms="true" />
<Button type="submit" label="&Salvar" />  {/* botão Default: Enter no form chega aqui */}
```

> Decisão por tela (vai no dossiê): **onde Enter confirma**. Padrão herdado do Delphi — Enter avança nos campos, e confirma no último campo ou no botão `Default=True`. No PDV, Enter no campo de código costuma **inserir o item** (confirmar), não avançar — replique o que o `.pas` faz, não o que parece elegante.

---

## 3) Atalhos (F-keys, Ctrl) — registro central com escopo

O Delphi centraliza atalhos em `KeyPreview`/`OnKeyDown` do form e em `TActionList` (cada `TAction` com `ShortCut`). No alvo, um **registro central de atalhos** com **escopo por tela/painel ativo** — via `react-hotkeys-hook` ou um command registry próprio. Escopo importa: F2 na tela de venda ≠ F2 na tela de estoque; o atalho do **painel ativo** ganha.

```tsx
// shared/keyboard/ShortcutScope.tsx — registro com escopo (estilo TActionList por form)
const ShortcutContext = createContext<ShortcutRegistry | null>(null);

export function ShortcutScope({ id, children }: { id: string; children: ReactNode }) {
  const parent = useContext(ShortcutContext);
  const registry = useMemo(() => new ShortcutRegistry(id, parent), [id, parent]);
  useEffect(() => registry.activate(), [registry]); // escopo ativo = topo da pilha
  return <ShortcutContext.Provider value={registry}>{children}</ShortcutContext.Provider>;
}

// uso na tela
export function useShortcut(combo: string, handler: () => void, opts?: { when?: boolean }) {
  const reg = useContext(ShortcutContext)!;
  useEffect(() => reg.bind(combo, handler, opts), [combo, handler, opts?.when]);
}
```

```tsx
// VendaFormPage.tsx — F-keys e Ctrl no escopo da tela
function VendaFormPage() {
  useShortcut('f2', () => abrirBuscaProduto());      // F2 = busca produto (clássico)
  useShortcut('f4', () => aplicarDesconto());
  useShortcut('ctrl+s', () => salvar(), { when: podeSalvar });  // só ativo quando válido
  return <ShortcutScope id="venda-form">{/* ... */}</ShortcutScope>;
}
```

### CAVEAT HONESTO: o browser reserva teclas que você não sobrescreve

Numa **aba de navegador comum**, algumas teclas são do navegador/SO e **não podem** (nem devem) ser sequestradas por uma página web:

| Tecla | O navegador faz | Você consegue sobrescrever numa aba? |
|-------|------------------|--------------------------------------|
| **Ctrl+W** | Fecha a aba | Não |
| **Ctrl+T / Ctrl+N** | Nova aba / nova janela | Não |
| **F5 / Ctrl+R** | Recarrega | Não (de forma confiável) |
| **F11** | Fullscreen | Não |
| **Ctrl+P** | Imprime (diálogo do browser) | Parcialmente / inconsistente |
| **Ctrl+Tab** | Troca de aba | Não |
| **Alt+letra** (accesskey) | Modificador varia por SO/browser | Inconsistente — ver seção 6 |

Se a planilha de atalhos do Delphi usa **F5/Ctrl+P/Ctrl+W**, no browser comum você simplesmente **não os tem**.

> **Electron resolve.** Na casca Electron (ADR-008, [frontend-react-standards.md](frontend-react-standards.md)) temos **controle total do teclado**: registramos esses atalhos globalmente, desligamos os defaults do Chromium e rodamos o PDV em modo kiosk. É **a mesma app React** — só a casca muda. Por isso o PDV e as superfícies teclado-pesado são **Electron**, e o browser fica para uso casual onde a colisão é tolerável.

```ts
// Electron (main process) — assume o controle do teclado que o browser nega
const win = new BrowserWindow({ kiosk: true, /* ... */ });
win.webContents.on('before-input-event', (event, input) => {
  // bloqueia os defaults do Chromium para entregar as teclas à app React
  const reserved = ['F5', 'F11'];
  const ctrlReserved = ['w', 't', 'n', 'r', 'p'];
  if (reserved.includes(input.key) ||
      (input.control && ctrlReserved.includes(input.key.toLowerCase()))) {
    event.preventDefault();                          // a app React decide o que fazer
    win.webContents.send('app-shortcut', input);     // repassa para a camada de teclado
  }
});
```

```ts
// no renderer: a camada consome o atalho vindo do Electron OU do DOM (browser)
function useGlobalShortcuts() {
  useEffect(() => {
    if (!platform.ownsKeyboard) return;              // só Electron entrega os reservados
    return window.electron!.onAppShortcut((input) => registry.dispatchFromElectron(input));
  }, []);
}
```

---

## 4) Foco

Comportamento de foco fiel ao VCL, usando os primitivos **headless** do Radix/React Aria ([tech-stack.md](tech-stack.md)) para não reinventar acessibilidade:

- **Autofocus ao entrar:** primeiro campo recebe foco ao abrir a tela (`ActiveControl` do Delphi). `autoFocus` no primeiro `Field`.
- **Focus trap em modal:** Tab circula **dentro** do modal; Esc fecha (`TForm` modal com `ModalResult`). Radix `Dialog` já faz trap + restauração; React Aria `useFocusScope` quando precisa de mais controle.
- **Roving tabindex em grid:** o grid é **um** stop de Tab; setas movem entre células (seção 5).
- **Restaurar foco ao fechar:** ao fechar modal/popup, o foco volta ao elemento que o abriu (Radix faz; se rolar manual, guarde `document.activeElement`).

```tsx
// modal com focus trap + restauração (Radix Dialog headless, vestido pelo design system)
import * as Dialog from '@radix-ui/react-dialog';

function ConfirmarModal({ open, onOpenChange, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dsOverlay()} />
        <Dialog.Content
          className={dsModal()}
          onOpenAutoFocus={(e) => { e.preventDefault(); firstFieldRef.current?.focus(); }}
          onEscapeKeyDown={() => onOpenChange(false)}  // Esc = Cancel (seção abaixo)
        >
          <ShortcutScope id="modal">{children}</ShortcutScope>{/* escopo próprio: atalhos do modal ganham */}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

---

## 5) Grid teclado-first (substitui o TDBGrid)

O `TDBGrid` era o coração da retaguarda. O alvo usa **AG Grid** (ou TanStack Table) embrulhado em `shared/ui/DataGrid` ([frontend-react-standards.md](frontend-react-standards.md)) com a navegação exata: **seta** move célula, **Enter edita / confirma**, **Tab entre células**, **roving tabindex** (o grid é um único stop de Tab da página).

| Tecla | Comportamento (espelha TDBGrid) |
|-------|----------------------------------|
| ↑ ↓ ← → | Move a célula ativa |
| Enter | Entra em edição; segunda vez confirma e desce |
| Tab / Shift+Tab | Próxima/anterior célula editável |
| F2 | Edita a célula (convenção planilha/ERP) |
| Esc | Cancela a edição da célula |
| Setas no fim da linha | Vai pra próxima linha (wrap) conforme o legado |

```tsx
// shared/ui/DataGrid.tsx — navegação por seta + Enter edita + Tab entre células
<AgGridReact<T>
  columnDefs={columns}
  rowData={rows}
  singleClickEdit={false}                      // Enter/F2 entram em edição (não clique)
  stopEditingWhenCellsLoseFocus
  navigateToNextCell={(p) => tdbGridNavigation(p)}  // mapeia setas ao comportamento do TDBGrid
  onCellKeyDown={(e) => {
    if (e.event?.key === 'Enter' && !e.editing) e.api.startEditingCell({ rowIndex: e.rowIndex!, colKey: e.column.getColId() });
    if (e.event?.key === 'Enter' &&  e.editing) confirmarLinha(e.data); // 2º Enter confirma
  }}
/>
```

> Roving tabindex (TanStack Table): só a célula ativa tem `tabIndex={0}`; as demais `-1`. Tab entra/sai do grid como um stop; setas movem internamente — o foco visível segue a célula ativa.

---

## 6) Mnemônicos `&` (Alt+letra sublinhada) — implementação própria

No Delphi, `Caption = '&Salvar'` desenha **S**alvar (S sublinhado) e Alt+S aciona o controle. Isto **tem que** ser replicado idêntico. **Não use `accesskey` do browser.**

### Por que NÃO `accesskey`

| Problema do `accesskey` | Detalhe |
|--------------------------|---------|
| Modificador inconsistente | Alt no Win/Chrome; **Alt+Shift** no Firefox; **Ctrl+Option** no Mac |
| Colisões | Browser usa Alt+letra para seu próprio menu/UI; conflita com os do app |
| Não desenha sublinhado | `accesskey` **não** renderiza o `S` sublinhado — perde a affordance visual do Windows |
| Escopo global | É por documento, não por form — dois forms com `&Salvar` colidem |

A camada própria resolve os quatro. Ela: **(a) parseia o `&` do label**, **(b) registra Alt+letra com escopo por form**, **(c) renderiza o sublinhado** (opcionalmente só enquanto **Alt** está pressionado — clonando o Windows), e **(d)** trata os **dois papéis** do `&` no Delphi.

### Os dois papéis do `&` no Delphi (ambos suportados)

1. **`&` em label de ação** (botão/menu): Alt+letra **aciona** a ação. `'&Salvar'` → Alt+S clica Salvar.
2. **`&` em label de campo** (`TLabel` com `FocusControl` apontando para um `TEdit`): Alt+letra **foca o campo** associado. `'&Nome'` no label cujo `FocusControl = edNome` → Alt+N foca `edNome`.

### API de componente (o que a tela escreve)

```tsx
// ação: Alt+S aciona o onClick
<Button label="&Salvar" onClick={salvar} />

// campo: Alt+N foca o input (o & vive no label do Field)
<Field label="&Nome" {...register('nome')} />

// menu: Alt+A abre, depois letras navegam os itens (menu Alt clássico)
<MenuBar items={[{ label: '&Arquivo', items: [{ label: '&Novo', onSelect: novo }] }]} />
```

### Implementação da camada

```ts
// shared/keyboard/parseMnemonic.ts — extrai a letra mnemônica do label
export function parseMnemonic(label: string): { text: string; key: string | null; index: number } {
  // '&&' é um & literal; '&X' marca X como mnemônico
  const idx = label.replace(/&&/g, '').search(/&./);
  if (idx < 0) return { text: label.replace(/&&/g, '&'), key: null, index: -1 };
  const key = label[idx + 1].toLowerCase();
  const text = label.slice(0, idx) + label.slice(idx + 1); // remove o &
  return { text: text.replace(/&&/g, '&'), key, index: idx };
}
```

```tsx
// shared/keyboard/useMnemonics.ts — registra Alt+letra com escopo por form + render do sublinhado
export function useMnemonic(label: string, action: () => void) {
  const reg = useContext(ShortcutContext)!;       // escopo do FormScope ativo (não global)
  const { text, key, index } = parseMnemonic(label);

  useEffect(() => {
    if (!key) return;
    return reg.bindMnemonic(`alt+${key}`, action); // escopo do form: 2 forms com Alt+S não colidem
  }, [key, action, reg]);

  // render do sublinhado (clona o Windows: opcionalmente só enquanto Alt pressionado)
  const altDown = useAltPressed();
  const node = key
    ? <>{text.slice(0, index)}<u className={altDown ? 'mnem-on' : 'mnem'}>{text[index]}</u>{text.slice(index + 1)}</>
    : text;
  return { text: node, accelerator: key ? `Alt+${key.toUpperCase()}` : null };
}

// hook que segue a tecla Alt para mostrar/esconder os sublinhados como no Windows
function useAltPressed() {
  const [down, setDown] = useState(false);
  useEffect(() => {
    const on  = (e: KeyboardEvent) => e.key === 'Alt' && setDown(true);
    const off = (e: KeyboardEvent) => e.key === 'Alt' && setDown(false);
    window.addEventListener('keydown', on); window.addEventListener('keyup', off);
    return () => { window.removeEventListener('keydown', on); window.removeEventListener('keyup', off); };
  }, []);
  return down;
}
```

```tsx
// Field usa o mesmo motor: o & no label FOCA o input (papel 2, FocusControl)
export function Field({ label, ...inputProps }: FieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { text } = useMnemonic(label, () => inputRef.current?.focus()); // Alt+letra foca o campo
  return (
    <label className={dsField()}>
      <span>{text}</span>
      <input ref={inputRef} {...inputProps} />
    </label>
  );
}
```

> Escopo por form é o que `accesskey` não dá: dois `FormScope` na mesma página, cada um com `&Salvar`, não colidem — o Alt+S do form **ativo** ganha (a mesma pilha de escopo da seção 3).

### Extrair os mnemônicos do `.dfm` (alimenta o dossiê)

Os mnemônicos **não** são digitados à mão pela tela — são **extraídos do `.dfm`** (ADR-010). O `.dfm` é texto serializado com `Caption = '&Salvar'`, `FocusControl = edNome`, `TabOrder = N`. Um parser varre o `.dfm` e produz o **mapa de teclado** do dossiê (seção 04): taborder + mnemônicos + atalhos.

```ts
// scripts/extract-dfm-mnemonics.ts — varre o .dfm e monta o mapa p/ o dossiê
// Trechos de .dfm:
//   object btnSalvar: TButton  Caption = '&Salvar'  Default = True  TabOrder = 7
//   object lblNome: TLabel     Caption = '&Nome'    FocusControl = edNome
//   object edNome: TEdit       TabOrder = 0
const mnemonicRe = /object\s+(\w+):\s+(\w+)[\s\S]*?Caption\s*=\s*'([^']*&[^']*)'/g;
const focusCtrlRe = /FocusControl\s*=\s*(\w+)/;
const tabOrderRe  = /TabOrder\s*=\s*(\d+)/;

export function extractKeyboardMap(dfm: string): KeyboardMapEntry[] {
  const out: KeyboardMapEntry[] = [];
  for (const m of dfm.matchAll(mnemonicRe)) {
    const [block, name, type, caption] = m;
    const { key } = parseMnemonic(caption);
    out.push({
      control: name, type, mnemonic: key,
      focusControl: block.match(focusCtrlRe)?.[1] ?? null,   // papel 2: foca campo
      tabOrder: Number(block.match(tabOrderRe)?.[1] ?? -1),
      role: type === 'TButton' || type === 'TMenuItem' ? 'action' : 'focus',
    });
  }
  return out.sort((a, b) => a.tabOrder - b.tabOrder);        // já na ordem de tabulação
}
```

> O resultado vira o **"mapa de teclado" do dossiê** (taborder + mnemônicos + F-keys/Ctrl do `TActionList`), capturado na **seção 04** ([../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md)). A tela só consome esse mapa via `label="&..."`. Um teste Playwright valida que Alt+S aciona Salvar e Tab segue a ordem extraída.

---

## Tabela de mapeamento Delphi → web

| Delphi (VCL) | Web (camada de teclado) | Nota |
|--------------|--------------------------|------|
| `TabOrder = N` | Ordem do **DOM** + `tabindex="0"` (nunca positivo) | Foco programático p/ fluxo condicional (seção 1) |
| `KeyPreview` + `OnKeyDown` no form | `ShortcutScope` + registro central com escopo | Tecla do **painel ativo** ganha (seção 3) |
| `TActionList` / `TAction.ShortCut` | `useShortcut('ctrl+s', …)` no escopo da tela | F-keys/Ctrl; `when` = `Enabled` da action |
| Enter avança campo (`SelectNext`) | `useEnterAdvances` / `FormScope` | `data-enter-confirms` onde Enter confirma (seção 2) |
| `Default = True` (botão) | botão `type="submit"` + Enter chega nele | Enter no form confirma o Default |
| `Cancel = True` (botão) | `Esc` → onClick do Cancel; `onEscapeKeyDown` no modal | Esc = Cancelar |
| `&` em ação (`'&Salvar'`) | `useMnemonic` → Alt+letra **aciona** | Render do sublinhado próprio (seção 6) |
| `&` em label + `FocusControl` | `Field label="&Nome"` → Alt+letra **foca** | Os **dois papéis** do `&` |
| Menu `Alt` (`'&Arquivo'`) | `MenuBar` com mnemônicos próprios | Não usar menu Alt do browser |
| `TDBGrid` | `DataGrid` (AG Grid/TanStack): seta/Enter/Tab | Roving tabindex (seção 5) |
| `ActiveControl` | `autoFocus` no 1º campo | Autofocus ao entrar (seção 4) |
| `accesskey` do browser | **NÃO usar** | Modificador inconsistente; sem sublinhado; colide |

---

## Construir desde o dia 1

A camada de teclado é **fundação**, não polimento de fim de projeto (ADR-010). Implicações para o roadmap:

- **Antes** da primeira tela-piloto, `shared/keyboard` (`ShortcutScope`, `useEnterAdvances`, `useMnemonics`, `TabOrderBoundary`) e `shared/ui` (`Button`, `Field`, `Modal`, `DataGrid`) já existem — a tela **herda**, não reimplementa.
- O **dossiê de cada tela captura o mapa de teclado** (taborder + atalhos + mnemônicos), extraído do `.dfm`/`.pas` ([../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md)).
- O **teste de paridade de teclado** é Playwright: Tab segue a ordem, Alt+letra aciona/foca, F-keys disparam, Enter avança/confirma como no legado ([../06-testing-quality/playwright-e2e.md](../06-testing-quality/playwright-e2e.md)).
- Atalhos reservados pelo browser (Ctrl+W/F5/F11/Ctrl+P) ⇒ a superfície vai para **Electron** (ADR-008). Decisão de casca por tela mora no dossiê.

---

## Ver também

- [frontend-react-standards.md](frontend-react-standards.md) — onde a camada se encaixa (`shared/keyboard`, `shared/ui`, as duas cascas).
- [tech-stack.md](tech-stack.md) — Radix/React Aria, AG Grid/TanStack, react-hotkeys-hook, Electron.
- [../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md) — o dossiê captura o mapa de teclado (seção 04).
- [../06-testing-quality/playwright-e2e.md](../06-testing-quality/playwright-e2e.md) — testes de fluxo de teclado.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-010** (e ADR-008).
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — anti-objetivo: não modernizar atalhos.
