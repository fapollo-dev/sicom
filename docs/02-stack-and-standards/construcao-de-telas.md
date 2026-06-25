# Guia de Construção de Telas (Cadastros)

> **Base de conhecimento e padrão único** para construir telas de cadastro do Apollo ERP.
> Codifica o que já foi provado em código (pilar `CadMaster` + engine declarativo + palette
> do DS). Toda tela nova segue este guia; ao construir, **copie de uma tela de referência
> real** (lista no fim) — não invente API de prop nem layout.

**Pré-requisitos:** [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) (ADR-010 teclado, ADR-012 dossiê, ADR-014 DS submódulo, ADR-015 erro/validação, **ADR-016** este padrão) · [api-erros-e-validacao.md](api-erros-e-validacao.md) · [keyboard-ux-layer.md](keyboard-ux-layer.md) · o `design-system/CLAUDE.md` + `.claude/rules/ds-standards.md` (lei do DS).

---

## 1. A tese

O legado é **majoritariamente cadastro** herdando de `TfrmCadMaster` (form-base único, ~101 telas). No alvo isso vira **dois ativos reutilizáveis**:

1. **Pilar `CadMaster`** (frontend) — o equivalente React do `TfrmCadMaster`: máquina de estados (browse/insert/edit), **código + Enter** carrega, navegação por setas (DBNavigator), **Pesquisa** (frmPesquisa), rodapé de ações com mnemônicos, camada de teclado. **Record-first**, fiel à memória muscular do operador (ADR-010).
2. **Engine declarativo** (backend) — `CrudEngineService` (tabela única) e `AggregateEngineService` (mestre-detalhe) que, a partir de uma **config**, herdam auditoria, soft/hard-delete, outbox de replicação, `HISTORICO_DINAMICO`, RBAC e a view de listagem.

> **Resultado:** uma tela trivial-a-média = **1 migration + 1 schema zod + 1 CrudConfig + 1 componente `<CadMaster>`**. Sem vertical copiado.

Fronteira (ADR-014): **componente/visual/token = repo do DS**; **tela/fluxo = repo do app**. O app **consome** o DS (via submódulo) e **compõe**; nunca hardcoda visual.

---

## 2. A receita (passo a passo)

Para uma entidade `X` (tabela `x`):

1. **Migration** `apps/api/migrations/NNN_x.sql`: tabela (tipos Oracle→PG), colunas de auditoria (`usultalteracao/dtultimalteracao/dtcadastro`) e/ou soft-delete (`indr/indr_usuario/indr_data`) conforme o legado, **view `get_x`** (projeção + decode de combos/FK, como o `GET_<TABELA>` real), seed, e os `INSERT`s de `permissoes` (RBAC). Registre a migration no harness `apps/api/test/embedded-db.ts`.
2. **Schema zod** `packages/shared/src/schema/x.schema.ts`: a fonte ÚNICA de validação (back↔front). **Nomes dos campos = nomes de COLUNA** (o engine mapeia `dto[coluna]` direto). Mensagens em **PT** (enums, obrigatórios, números) — ADR-015. Use os **validadores BR** (`zCpf/zCnpj/zCelular/zEmail/zCep/zUf`) em campos conhecidos. Exporte em `packages/shared/src/index.ts`.
3. **Config do engine** `apps/api/src/modules/cadastro/x.crud.ts`: `CrudConfig` + `createCrudController({ path, config, schema, updateSchema })`. Registre o controller no `cadastro.module.ts`.
4. **Tela** `apps/web/src/features/x/XCadMaster.tsx`: `<CadMaster<CriarXDto>>` com `resourcePath`, `pk`, `colunasPesquisa`, `schema`, `defaultValues`, e a render-prop `campos`. Registre a rota em `apps/web/src/app/router.tsx` + o item no menu (`AppLayout.tsx`).
5. **Paridade + dossiê** (ADR-012): a tela só está "pronta" com dossiê (seção 04) + teste de paridade + revisão legado×novo.

Mestre-detalhe (header+itens): troque por `AggregateConfig` + `createAggregateController` (back) e `<CadMasterDet>` (front, com `detalhe`).

---

## 3. Backend — engine declarativo

`CrudConfig` (`apps/api/src/shared/crud/crud-config.ts`):

| Campo | Função |
|---|---|
| `tabela` / `pk` / `view` | tabela física, coluna PK, view de listagem (`get_*`) |
| `pkGerada?` | default `true` (sequence). **`false` = CHAVE NATURAL** (NCM/CFOP/CST): o create insere a PK vinda do dto (usuário digita) |
| `colunas` | colunas editáveis (delta) — o que o create/update gravam |
| `rbacForm` | nome do form p/ `PossuiAcessoForm` (tabela `permissoes`) |
| `softDelete?` | `true` = excluir marca `INDR='E'` (lista filtra); omitido = hard-delete |
| `empresaScoped?` | `true` = tabela tem `IDEMPRESA` (multi-tenant por empresa, ex.: CONTAS_BANCARIAS): o create **carimba** `idempresa = currentTenant().empresaId` (fail-closed) e read/list **filtram** por empresa. A view de listagem precisa expor `idempresa`. Default `false` (tabela global). |
| `audit?` | default `true` (carimba `usultalteracao/dt*`); `false` quando a tabela não tem essas colunas |
| `historico?` | default `true` — grava `HISTORICO_DINAMICO` (1 linha por campo alterado), na mesma transação |
| `replica?` | `true` = gera evento no `outbox` (tabelas com trigger `REM_*`); default `false` |
| `colunasPesquisa` | **whitelist** (anti-injection) das colunas filtráveis/ordenáveis na Pesquisa |
| `derivar?` | `(dto, id?) => Record<string,unknown>` — **campos DERIVADOS server-side** (espelha derivações do `BeforePost`/`OnValidate` do legado). Ex.: NCM grava `NCMSH = ConcatenaLeft(CODIGO,8,'0')` → `derivar: (dto,id) => ({ ncmsh: String(dto.codigo ?? id).padStart(8,'0') })`. O usuário **nunca** digita o campo (read-only na tela); a coluna derivada deve estar em `colunas` para persistir. |

O engine herda automaticamente: carimbo de auditoria, soft/hard-delete por `INDR`, `HISTORICO_DINAMICO` (helper `shared/crud/historico.ts`, usado igual pelo engine e por verticais hand-written), outbox de replicação, e a listagem com filtro `campo+operador+valor` + situação (rdgAtivo) + ordenação.

> **Contrato do `read()` (paridade BR-05/G-05):** em telas com `softDelete`, carregar por código **não reabre** um registro excluído (`INDR='E'`) — o `read()` filtra `coalesce(indr,'I')<>'E'`. O registro continua na tabela (soft-delete), mas some de toda leitura por id e da listagem padrão. Para campos derivados, declare `derivar` na config e marque o campo como **read-only** na tela (não `register()` editável).

`AggregateConfig` (mestre-detalhe) adiciona `detalhes: DetalheConfig[]` (`{ tabela, pk, fk, colunas, chave }`). O `AggregateEngineService` grava header + N itens numa **única transação**, **substitui** itens no update e exclui em **cascata em código** (espelha `TfrmCadMasterDet`).

Erro/validação: o `ZodValidationPipe` + `AllExceptionsFilter` entregam o envelope `ErroResposta` (PT) — ver [api-erros-e-validacao.md](api-erros-e-validacao.md). **Nunca** 500 genérico.

---

## 4. Frontend — o pilar `<CadMaster>`

`apps/web/src/shared/cadmaster/CadMaster.tsx`. Props:

| Prop | Função |
|---|---|
| `titulo` | título (PageHeader do DS) |
| `resourcePath` | recurso REST (ex.: `'cadastro/bairros'`) — o `createResourceApi` fala com o controller |
| `pk` | coluna PK (ex.: `'idbairro'`) |
| `viewPk?` | coluna de código na view, se ≠ pk (ex.: `get_bancos` expõe `codigo`) |
| `pkGerada?` | `false` p/ chave natural (campo-código editável no insert) |
| `colunasPesquisa` | `ColunaPesquisa[]` da Pesquisa (ver §6) |
| `schema` | a zod schema compartilhada |
| `defaultValues` | valores iniciais (inclui defaults de evento, ex.: `tipo:'D'`) |
| `outros?` | ações do menu "Outros" (Alt+O) |
| `campos` | render-prop `({ form, editavel }) => ReactNode` — os campos da tela |

Herdado do pilar (não reimplementar): código+Enter, setas (←/→ anterior/próximo, ↑/↓ primeiro/último), **Pesquisa** (botão/Alt+P), **F6** (situação), rodapé por estado, Esc protegido na edição, mnemônicos, `AlertModal` na exclusão, exibição de erro no **modal de mensagens padrão** (`useMensagem`, ADR-015).

Mestre-detalhe: `<CadMasterDet>` compõe o `<CadMaster>` e injeta um grid de itens (`useFieldArray`) via `detalhe={{ chave, titulo, novoItem, itemCampos }}`.

---

## 5. Palette de campos (legado VCL → componente DS)

Componentes em `apps/web/src/shared/ui/` — **todos** vestem o DS (zero hardcode) + camada de teclado (mnemônico `&` → Alt+letra foca/aciona):

| Controle legado (recon §5c) | Componente | Uso |
|---|---|---|
| `TDBEdit` (texto) | **`Field`** | `{...form.register('campo')}` |
| `TJvDBComboBox`/`TDBRadioGroup` (lista fixa) | **`SelectField`** | `Controller` + `options` (constante do schema) |
| `TJvDBCalcEdit` (número) | **`NumberField`** | número controlado (`value`/`onChange`, vazio=undefined) |
| `TJvDBCalcEdit` (moeda) | **`CurrencyField`** | **R$ formatado, máscara de centavos, SEM spinner** |
| `TJvDBDateEdit` (data) | **`DateField`** | ISO `YYYY-MM-DD` (`<input type=date>`) |
| `TDBMemo` (texto longo) | **`TextArea`** | `FormFieldTextarea` do DS |
| `TDBCheckBox` (flag 'S'/'N') | **`CheckboxField`** | mapeia checkbox ↔ char 'S'/'N' |

Regra: **moeda nunca é spinner** → `CurrencyField`. Flags `char` 'S'/'N' → `CheckboxField` (não `string`).

---

## 6. FK / lookup (mostrar o filho, não o id)

Campo FK **mostra o dado do filho** (nome/sigla), nunca o id cru:

- **FK de outro recurso** (DB): hook `useResourceOptions(path, mapRow)` (`apps/web/src/shared/cadmaster/useResourceOptions.ts`) carrega o recurso relacionado e mapeia para `{value,label}`; ligue com `Controller` + `SelectField`. Ex.: Bairros→Cidade, Contas→Banco.
- **Referência fixa**: lista estática em `@apollo/shared` (ex.: `UF_OPCOES` de `ufs.ts`) + `SelectField`. Ex.: Cidades.`iduf` → mostra `SP — São Paulo`.
- **Na listagem/Pesquisa**, a **view `get_*` decodifica** o id para o rótulo (CASE/JOIN, como o legado faz) — ex.: `get_cidades` mapeia `IDUF→SIGLA`; `get_bairro` decodifica `REGIAO`. Adicione a coluna decodificada ao `colunasPesquisa`.

---

## 7. Layout / UX (padrão showcase)

Referências de UX do DS: `design-system/src/preview/pages/` — **ClientesShowcase** (lista DataTable), **OrderEditShowcase** (form em seções), **OrderDetailShowcase**, **ClientesFinanceiroShowcase**.

- **Campos em grid 2-colunas**: `<div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">`; campo principal/memo full-width via `<div className="sm:col-span-2">`. Responsivo (1 col no mobile).
- **Rodapé** = barra com divisor: destrutivas/secundárias à esquerda, **ações primárias à direita** (Gravar em destaque). (no `Rodape` do `CadMaster`.)
- **Cabeçalho** = `PageHeader` do DS; casca = `AppShell` (menu lateral, em `AppLayout.tsx`).
- **ZERO hardcode** (lei do DS): nunca `style={{}}` com px/cor. Use **classes-token**: `gap-form-gap`, `gap-gp-*`, `px-pad-*`, `rounded-radius-*`, `bg-bg-surface`, `border-border`, `shadow-sh-md`, `text-fg-*`. Larguras de layout puro (`w-40`, `max-w-3xl`) são aceitáveis.

---

## 8. Pesquisa (DataTable do DS)

`Pesquisa.tsx` = `Modal` + `DataTable` do DS. `ColunaPesquisa`:

| Campo | Função |
|---|---|
| `campo` / `label` | coluna na view + rótulo |
| `tipo?` | `'text'\|'number'\|'date'\|'currency'\|'status'\|'badge'\|'email'\|'phone'` — render/alinhamento/filtro corretos (não tudo como texto) |
| `largura?` | largura fixa (px); sem isso o autoFit distribui |
| `filtro?` | override do tipo de filtro (default derivado do `tipo`) |

A primeira coluna é o código (estreito); a segunda é o "título" no card/mobile. **F6** cicla a situação (ativos/inativos/todos).

---

## 9. Regras finas (paridade)

- **Campo derivado**: campos calculados do legado (ex.: NCM `NCMSH = ConcatenaLeft(CODIGO,8,'0')`) são **derivados no service** e **read-only** na tela — não editáveis.
- **Defaults de evento**: `OnNewRecord` do legado vira `defaultValues` (ex.: Operações `tipo:'D'`).
- **Uppercase/CharCase**: aplicar via `.transform()` no schema quando o `.dfm` tem `CharCase` (Bancos sim; Operações não).
- **Soft vs hard delete**: pela presença de `INDR` no legado.

---

## 10. Telas de referência (copie destas)

| Padrão | Tela | Arquivos |
|---|---|---|
| Mínima (texto, soft-delete) | Marcas | `features/marcas/MarcasCadMaster.tsx` · `modules/cadastro/marcas.crud.ts` |
| Combo + flag + lookup FK | Bairros | `features/bairros/BairrosCadMaster.tsx` (+ `useResourceOptions`) |
| Moeda + checkbox | Reajuste de Preço | `features/precos/PrecosCadMaster.tsx` (CurrencyField) |
| Chave natural + data + memo | NCM | `features/ncm/NcmCadMaster.tsx` (`pkGerada:false`, DateField, TextArea) |
| Lookup de referência fixa (UF) | Cidades | `features/cidades/CidadesCadMaster.tsx` (`UF_OPCOES`) |
| Mestre-detalhe | Lote de Cobrança | `features/lotes-md/LotesCobrancaCadMaster.tsx` (`<CadMasterDet>`) · `modules/cobranca/lote-cobranca.aggregate.ts` |
| Piloto (golden de runtime) | Bancos | `features/cadastro-bancos/BancosCadMaster.tsx` · `modules/cadastro/banco.*` |

---

## 11. Checklist de uma tela nova

- [ ] Dossiê (seção 04) extraído do `.pas/.dfm` + Oracle (read-only).
- [ ] Migration (tipos, auditoria/INDR, view `get_*` com decode, seed, permissões) + registrada no harness.
- [ ] Schema zod (campos = colunas, mensagens PT, validadores BR onde couber) + export.
- [ ] CrudConfig/AggregateConfig + controller registrado no módulo.
- [ ] Tela `<CadMaster>`/`<CadMasterDet>`: grid 2-col, palette correto (moeda=CurrencyField, FK=lookup), `colunasPesquisa` tipadas, defaults de evento, derivados read-only.
- [ ] Rota + item de menu.
- [ ] Zero hardcode (`grep style={{` = 0); erros via envelope PT/modal padrão.
- [ ] Testes verdes (API/web/smoke) + (quando o usuário exercitar o ERP) **golden de runtime** via V$SQL.
- [ ] Revisão legado×novo.

## Ver também
- [../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md) — o dossiê que alimenta a construção.
- [../09-design-system-and-ai/ds-agent-workflow.md](../09-design-system-and-ai/ds-agent-workflow.md) — fronteira DS×app, crud-builder, autonomia.
- [api-erros-e-validacao.md](api-erros-e-validacao.md) — contrato de erro/validação (ADR-015).
- [keyboard-ux-layer.md](keyboard-ux-layer.md) — a camada de teclado (ADR-010).
