# Template do Dossiê de Tela (arquivo-coroa)

> O **template preenchível** do dossiê de tela — a unidade de trabalho do Apollo (ADR-012). Uma tela só vira código depois que este documento existe **completo**: cada componente do `.dfm` mapeado, cada handler do `.pas` lido, **toda** SQL reconstruída (estática + dinâmica, com todos os caminhos condicionais), cada regra de negócio e seu *porquê*, cada efeito colateral em estado externo, e os casos golden capturados do legado em runtime. **Não migre o que você vê; migre o que o sistema faz.**

## Pré-requisitos de leitura

- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — a tese "contexto é tudo" e os 3 hábitos.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-012** (dossiê é a unidade de trabalho), **ADR-010** (teclado primeira classe), **ADR-008** (PDV Electron offline), **ADR-011** (Oracle→Postgres).
- [dossier-process.md](dossier-process.md) — o processo que preenche e fecha este template (quem faz o quê, quando "concluído").
- [../03-legacy-analysis/delphi-anatomy.md](../03-legacy-analysis/delphi-anatomy.md) — como ler `.dpr`/`.pas`/`.dfm`/datamodules.
- [../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md) — reconstruir a SQL dinâmica e capturar golden em runtime.
- [../03-legacy-analysis/business-rule-extraction.md](../03-legacy-analysis/business-rule-extraction.md) — extrair regra com profundidade (o *porquê*).
- [../03-legacy-analysis/hidden-coupling-traps.md](../03-legacy-analysis/hidden-coupling-traps.md) — a armadilha de estado global em `TDataModule` (a seção que salva o dossiê).
- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) — o mapa de teclado é extraído do `.dfm`.

---

## Como usar este template

1. **Copie** este arquivo para `04-screen-dossier/dossiers/<modulo>/<form>.md` (um dossiê por `TForm`).
2. **Preencha todas as seções.** Campo que não se aplica recebe `N/A — <motivo>`, **nunca** fica em branco (branco = não investigado).
3. **Marque a procedência** de cada achado: `[.dfm]`, `[.pas:L<linha>]`, `[runtime]`, `[DM <nome>]`, `[inferido]`. Achado sem procedência é suspeito.
4. **Externe o que descobriu.** Regra escondida vira [Regras de negócio](#5-regras-de-negócio); se for canônica, registre em [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md).
5. **Versione o dossiê junto do código** que ele gera (ver [dossier-process.md](dossier-process.md)).

> Cada seção abaixo traz, em *itálico recuado*, **um exemplo curto de campo preenchido** mostrando o nível de detalhe esperado. Apague os exemplos ao preencher o seu.

---

# Dossiê — `<NomeDoForm>`

| Campo | Valor |
|---|---|
| **Status** | `rascunho` · `em-revisão` · `paridade-verde` · `concluído` |
| **Autor / Revisor** | `<agente/humano>` / `<revisor independente>` (ver [../08-agents/roster.md](../08-agents/roster.md)) |
| **Versão do dossiê** | `v<N>` — casada com o commit/PR do código-alvo |
| **Data** | `<AAAA-MM-DD>` |
| **Commit do legado analisado** | `<hash/branch do repo Delphi>` |

---

## 1. Identidade

| Campo | Valor |
|---|---|
| **Form (`.pas` / `.dfm`)** | `<caminho/Unidade.pas>` + `<caminho/Unidade.dfm>` |
| **Classe do form** | `T<Form>` (`TForm` / `TFrame` / herança custom) |
| **Módulo de domínio** | `<retaguarda · balcão · pdv · fiscal · financeiro · estoque · cadastro>` |
| **Função no negócio** | 1–2 frases: o que o operador faz aqui |
| **Frequência / criticidade** | `alta/média/baixa` · é caminho de PDV? toca fiscal? (risco-coroa) |
| **Rota-alvo (web)** | `<rota React>` (ex.: `/cadastro/produto/:id`) |
| **Casca-alvo** | `browser` · `Electron` · `ambas` — **por quê** (devices, teclas reservadas, offline → ADR-008) |

> *Exemplo preenchido:*
> *Form: `Retaguarda/uCadProduto.pas` + `uCadProduto.dfm` `[.dfm]`. Classe `TfrmCadProduto` (herda `TfrmCadBase`, que injeta botões Salvar/Cancelar — ver [Dependências](#7-dependências)). Módulo: `cadastro`. Função: cadastrar/editar produto com dados fiscais (NCM, CST, alíquotas) usados depois pelo PDV no cálculo do cupom. Criticidade: alta — alimenta tributação offline. Rota-alvo: `/cadastro/produto/:id`. Casca: `ambas` — não toca device, mas é tela teclado-pesada da retaguarda; Electron para os power-users que usam F-keys reservadas pelo browser (F5).*

---

## 2. UI — inventário de componentes (`.dfm` → React)

Inventário **completo** dos controles do `.dfm`, na ordem da árvore, mapeado para o componente React do design system. Cada linha registra também `Left/Top` (layout absoluto do Delphi) — porque o alvo **não** posiciona por pixel: reflui em layout fluido (grid/flex). Anote agrupamentos visuais (`TPanel`, `TGroupBox`, `TPageControl`/`TTabSheet`) que viram containers.

| Controle (`.dfm`) | Tipo VCL | Left,Top,W,H | Caption/label (com `&`) | Bind (`DataSource`/`DataField`) | → Componente React | Nota de reflow |
|---|---|---|---|---|---|---|
| `edCodigo` | `TEdit` | 88,16,80,21 | `&Código` | `dsProduto/COD` | `<Field>` | linha 1, col 1 |
| … | … | … | … | … | … | … |

**Notas de reflow (layout absoluto Left/Top → fluido):**
- O Delphi posiciona por `Left/Top` absolutos; **não copie pixels**. Reconstrua o agrupamento lógico (qual `TPanel`/`TGroupBox` contém o quê) e reflua em `grid`/`flex` do design system, preservando a **ordem de leitura** e a **taborder** (seção 8) — não a coordenada.
- `TPageControl`/`TTabSheet` → componente de abas; cada `TTabSheet` é um painel. Registre as abas e o que vive em cada uma.
- Controles invisíveis em design-time (`Visible=False`, mostrados por código) têm de constar — são estado de UI condicional (cruzar com [Eventos](#3-eventos) e [Regras](#5-regras-de-negócio)).
- `TDBGrid` → `<DataGrid>` teclado-first ([../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) §5). Liste colunas, `DataField`, máscara e largura.

> *Exemplo preenchido:*
> *`edPreco: TMaskEdit` `[.dfm]` em `Left=88 Top=72`, `EditMask='!###,##0.00;1; '`, bind `dsProduto/PRECOVENDA`. → `<MoneyField label="&Preço" />` do design system (máscara monetária pt-BR). Reflow: agrupado com `edCusto` e `edMargem` dentro do `TGroupBox gbPrecificacao` → vira `<FieldGroup legend="Precificação">` em flex coluna; o `Top` cresce 24px por campo no Delphi, mas no alvo o espaçamento vem do token do DS, não do pixel.*

---

## 3. Eventos

**Cada** handler do `.pas` ligado a um evento do `.dfm` (`OnClick`, `OnExit`, `OnKeyDown`, `OnChange`, `OnEnter`, `BeforePost`, `OnCalcFields`, `BeforeScroll`, etc.) — o que faz, em ordem de disparo. Eventos de **dataset** (`BeforePost`, `AfterPost`, `OnNewRecord`) costumam esconder regra crítica.

| Componente.Evento | `.pas` | O que faz (passo a passo) | Toca SQL? | Toca estado externo? | Vira (alvo) |
|---|---|---|---|---|---|
| `btnSalvar.OnClick` | `[.pas:L…]` | valida → `qryProduto.Post` → commit | sim ([Dados](#4-dados)) | sim ([Efeitos](#6-efeitos-colaterais--estado-externo)) | `POST/PUT` + mutation |
| `edCodigo.OnExit` | `[.pas:L…]` | busca produto; se existe, carrega; senão habilita inclusão | sim | foco condicional | `onBlur` + query |
| `qryProduto.BeforePost` | `[.pas:L…]` | regra de validação final | — | — | validação do DTO/service |
| … | … | … | … | … | … |

> *Exemplo preenchido:*
> *`edEAN.OnExit` `[.pas:L214]`: se `Length(edEAN.Text)=13` e dígito verificador OK, faz `qryDupEAN` ([Dados](#4-dados), Q3) procurando outro produto com o mesmo EAN; se achar (e não for o registro corrente) → `MessageDlg('EAN já usado por X', mtError)` e `Abort` (cancela a saída do campo, devolve o foco). Vira: `validator async` no `onBlur` do `<Field>` chamando `GET /produtos?ean=` com debounce; o `Abort` (foco preso) é replicado pela camada de teclado ([../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) §1).*

---

## 4. Dados — TODA query (a alma do dossiê)

Inventário **exaustivo** de tudo que toca o banco: `TQuery`/`TFDQuery` com SQL no `.dfm` (estática), SQL montada em runtime no `.pas` (dinâmica), `StoredProc`, comandos diretos, triggers disparadas, sequences. **Reconstrua a SQL dinâmica com TODOS os caminhos condicionais** — não a forma "feliz". A verdade da SQL dinâmica vem de **capturar em runtime** ([../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md)).

Para **cada** query:

### Q`<n>` — `<nomeDoDataset/Proc>`

- **Origem:** `[.dfm SQL.Strings]` · `[.pas:L… montada]` · `[StoredProc]` · `[runtime capturado]`
- **Quando dispara:** evento/handler ([Eventos](#3-eventos))
- **SQL base (Oracle, verbatim):**
  ```sql
  <cole a SQL exatamente como no legado — Oracle>
  ```
- **Fragmentos condicionais (TODOS os caminhos):** liste cada `if/case` no `.pas` que **adiciona/troca** WHERE/JOIN/ORDER, com a condição:
  | Condição (`.pas`) | Fragmento adicionado/trocado |
  |---|---|
  | `if cbInativos.Checked` | remove `AND ATIVO='S'` |
  | `if edBusca.Text<>''` | `+ AND UPPER(DESCRICAO) LIKE :busca` |
  | `case rgOrdenacao` | troca `ORDER BY` (0=descrição, 1=código) |
- **Params:** nome, tipo, origem (campo/variável), e o valor real capturado em runtime.
- **Mutações:** é leitura ou escrita? `INSERT/UPDATE/DELETE`/`Post` em quais tabelas?
- **Tabelas / SPs / triggers / sequences tocadas:** liste — **incluindo as que disparam por trigger** (efeito que a SQL não mostra; cruzar com [Efeitos](#6-efeitos-colaterais--estado-externo)).
- **SQL-alvo (Postgres, query builder):** a reconstrução (Kysely/Knex), já com os caminhos condicionais como branches do builder (ADR-011). Marque diferenças Oracle→Postgres (ex.: `NVL`→`COALESCE`, `ROWNUM`→`LIMIT`, `(+)`→`LEFT JOIN`, `SYSDATE`→`now()`, sequence).

> *Exemplo preenchido (Q2 — `qryProduto` montada em runtime):*
> *Origem: `[.pas:L131 montada]` confirmada por `[runtime]`. Dispara no `btnFiltrar.OnClick`. SQL base: `SELECT P.COD, P.DESCRICAO, P.PRECOVENDA FROM PRODUTO P WHERE P.EMPRESA=:emp`. Fragmentos: (a) `if not cbInativos.Checked → + AND P.ATIVO='S'`; (b) `if edBusca.Text<>'' → + AND UPPER(P.DESCRICAO) LIKE :busca` com `:busca := '%'+UpperCase(edBusca.Text)+'%'`; (c) `if cbComEstoque.Checked → + AND EXISTS (SELECT 1 FROM ESTOQUE E WHERE E.COD=P.COD AND E.QTD>0)`; (d) `ORDER BY` por `rgOrdem.ItemIndex`. Params: `:emp` (sessão, `[DM dmGlobal].EmpresaAtual`), `:busca`. Leitura. Tabelas: `PRODUTO`, `ESTOQUE` (via EXISTS). Postgres: `ROWNUM<=200` do legado vira `.limit(200)`; `UPPER+LIKE` mantém, mas avaliar `ILIKE`/índice. Golden capturado nos 4 caminhos (ver [Casos de teste](#8-casos-de-teste-golden)).*

> **Regra de ouro:** se uma query não foi vista **rodando** (runtime), marque-a `[inferido]` e abra risco. SQL dinâmica reconstruída só por leitura estática é hipótese, não fato ([../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md)).

---

## 5. Regras de negócio (o *porquê*, não só o *o quê*)

Toda **validação**, **cálculo** e **condicional** com significado de negócio. Para cada uma: o gatilho, a lógica exata, e o **motivo** (legal/fiscal/operacional). Procedência obrigatória.

| ID | Regra | Gatilho | Lógica (verbatim do legado) | *Porquê* | Procedência |
|---|---|---|---|---|---|
| BR-01 | … | … | … | … | `[.pas:L…]` |

Para cálculos, registre a **fórmula exata** e a ordem de operações (arredondamento importa em fiscal/financeiro):

> *Exemplo preenchido:*
> *BR-07 — Cálculo de preço de venda por margem. Gatilho: `edCusto.OnChange`/`edMargem.OnChange`. Lógica `[.pas:L298]`: `PrecoVenda := RoundTo(Custo / (1 - Margem/100), -2)` (arredonda a 2 casas, banker's? **não** — `RoundTo` do Delphi é round-half-to-even; CONFIRMAR no runtime, divergência de 1 centavo reprova paridade). Porquê: margem é sobre o **preço** (markup divisor), não sobre o custo — erro clássico que muda o preço final; é regra comercial da rede. Risco fiscal: este preço entra no cupom. Procedência: `[.pas:L298]` + `[runtime]` (golden com custo=10,00 margem=30% → 14,29).*

> Regras que dependem de **estado deixado por outra tela** (ex.: empresa/filial ativa, parâmetro carregado no datamodule global) **têm de** apontar para [Efeitos colaterais + estado externo](#6-efeitos-colaterais--estado-externo) — é onde a armadilha de acoplamento se esconde.

---

## 6. Efeitos colaterais + estado externo

> **A seção que salva da armadilha de acoplamento** ([../03-legacy-analysis/hidden-coupling-traps.md](../03-legacy-analysis/hidden-coupling-traps.md)).

Em Delphi, `TDataModule` e variáveis/singletons globais são compartilhados entre forms: esta tela **lê** estado que outra deixou e **escreve** estado que outra vai ler. Se o dossiê não mapear isso, a refatoração quebra de formas invisíveis. Documente **tudo**:

- **O que esta tela GRAVA** (além do óbvio): tabelas, mas também **triggers** que disparam, **sequences** consumidas, arquivos/INI, log, geração de evento/fila, impressão, integração externa (TEF, fiscal).
- **Qual datamodule/global esta tela LÊ:** `DM.<x>`, variáveis de unit, `Application.`, parâmetros de sessão (empresa/filial/usuário/turno de caixa). De onde vem, quem setou.
- **Qual datamodule/global esta tela ESCREVE:** o que ela deixa setado para a próxima tela — o acoplamento de saída.
- **Conexão/transação:** usa a conexão do datamodule compartilhado? Abre transação própria? Faz `Commit`/`Rollback` que **outra** tela depende?
- **Ordem de abertura assumida:** esta tela presume que outra rodou antes (ex.: login carregou `dmGlobal.Empresa`)? Liste a precondição.

| Item | Tipo (lê/grava) | Alvo | Quem setou / quem consome | Mapeamento alvo |
|---|---|---|---|---|
| `dmGlobal.EmpresaAtual` | lê | global DM | setado no login | tenant/request context (NestJS) |
| trigger `TRG_PRODUTO_AUD` | grava (indireto) | tabela `AUDITORIA` | dispara no UPDATE de `PRODUTO` | replicar via interceptor/audit log |
| … | … | … | … | … |

> *Exemplo preenchido:*
> *Lê `dmVenda.SessaoCaixa` `[DM dmVenda]` — turno de caixa aberto setado pela tela de abertura de caixa; sem ele, `Post` da venda viola FK. Grava: ao salvar produto, a trigger `TRG_PRODUTO_PRECO_HIST` `[runtime]` insere em `PRODUTO_PRECO_HIST` (a tela "não sabe", a SQL não mostra) — paridade tem de validar esse insert-fantasma. Escreve em `dmGlobal.UltimoProdutoEditado` que a tela de etiquetas consome depois — acoplamento de saída: no alvo vira retorno explícito do endpoint, não estado global.*

---

## 7. Dependências

Outros forms, frames, datamodules, units e SPs que esta tela chama ou da qual herda.

| Dependência | Tipo | Como é usada | Vira (alvo) |
|---|---|---|---|
| `TfrmCadBase` | herança | botões/validação base | componente/HOC base ou layout compartilhado |
| `frmBuscaNCM` | form modal | F4 abre busca de NCM, devolve código | modal de busca + retorno |
| `dmFiscal` | datamodule | regras de tributação | módulo `fiscal` (NestJS) |
| `pkgPreco.CalculaPreco` | SP/package | cálculo central de preço | service compartilhado |

> *Exemplo preenchido:*
> *`frmBuscaNCM` (modal) `[.pas:L260]`: chamado por F4 em `edNCM`; retorna `ModalResult=mrOk` + `NCM selecionado` via property pública. No alvo: `<NcmSearchModal>` com focus-trap (camada de teclado §4), F4 registrado no escopo da tela, retorno por callback — **não** por estado global.*

---

## 8. TabOrder + mapa de atalhos/mnemônicos

Extraído do `.dfm` pelo parser ([../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) §6). É **dado**, não digitado à mão. A memória muscular do operador é critério de aceite (ADR-010) — replicar **idêntico**.

**TabOrder (sequência exata):**

| Ordem | Controle | Tipo | Enter faz | Foco condicional (`OnExit`/`OnEnter`) |
|---|---|---|---|---|
| 0 | `edCodigo` | `TEdit` | avança | se vazio, não sai |
| 1 | `edDescricao` | `TEdit` | avança | — |
| … | … | … | … | … |

**Mnemônicos `&` (Alt+letra):**

| Controle | Caption | Letra | Papel (`action`/`focus`) | `FocusControl` |
|---|---|---|---|---|
| `btnSalvar` | `&Salvar` | S | action | — |
| `lblNome` | `&Nome` | N | focus | `edNome` |

**Atalhos (F-keys / Ctrl — `TActionList`/`KeyPreview`):**

| Atalho | Ação | Origem | Escopo | Reservado pelo browser? (→ Electron) |
|---|---|---|---|---|
| `F2` | busca produto | `actBuscar.ShortCut` | tela | não |
| `F5` | atualizar grid | `KeyPreview` | tela | **sim** → casca Electron |
| `Ctrl+S` | salvar | `actSalvar` | tela | não |
| `Esc` | cancelar (`Cancel=True`) | botão | modal/form | não |

> *Exemplo preenchido:*
> *Botão `Default=True` é `btnSalvar` `[.dfm]` → Enter no form confirma Salvar; `Cancel=True` é `btnFechar` → Esc fecha. `F5` (atualizar) é reservado pelo Chromium ⇒ esta tela, quando usada por power-user, roda em **Electron** ([Identidade](#1-identidade), casca). O mapa completo é o output do `extract-dfm-mnemonics.ts`.*

---

## 9. Casos de teste (golden) — capturados do legado

Inputs → outputs **capturados do legado rodando** ([../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md)), virando os golden do harness de paridade ([../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)). **Cobertura derivada das seções 4 e 5:** cada caminho condicional de SQL e cada regra de negócio precisa de ≥1 caso. Verde que não exercita o caminho real é falsa confiança.

| ID | Cobre (BR/Q + caminho) | Input (estado + campos) | Ação | Output esperado (capturado) | SQL real observada |
|---|---|---|---|---|---|
| G-01 | BR-07 (margem) | custo=10,00; margem=30 | calcular | preço=14,29 | — |
| G-02 | Q2 caminho (b)+(c) | busca="arroz", comEstoque=✓ | filtrar | 12 linhas, IDs […] | `…AND UPPER… AND EXISTS…` |
| G-03 | BR-03 (EAN dup) | EAN já existente | sair do campo | erro "EAN já usado por X" | `qryDupEAN` retornou 1 |
| … | … | … | … | … | … |

> *Exemplo preenchido:*
> *G-08 cobre o caminho fiscal de BR-12: produto com NCM de ST → ao salvar, o cupom-teste no PDV calcula ICMS-ST != 0. Input: NCM `2202.10.00`, UF `SP`. Output capturado do legado: base ST `R$ …`, ICMS-ST `R$ …` (valores verbatim). Esse golden roda contra o motor fiscal novo no harness; divergência de 1 centavo = reprova (risco-coroa).*

---

## 10. Alvo (a especificação de implementação)

O que a equipe constrói a partir deste dossiê — backend, frontend e decisões offline. Esta seção **alimenta** os três entregáveis ([dossier-process.md](dossier-process.md)).

**Backend (NestJS — [../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md)):**
- Módulo de domínio: `<modulo>`
- Endpoints (derivados de [Dados](#4-dados)/[Eventos](#3-eventos)):
  | Método+rota | Origem (Q/BR) | DTO (zod) | Mutação? |
  |---|---|---|---|
  | `GET /produtos` | Q2 | `ProdutoFilterDto` | leitura |
  | `PUT /produtos/:id` | btnSalvar, BR-07/12 | `ProdutoUpsertDto` | escrita + trigger |
- Regras que vão para o **service** (não para o controller): BR-…; validações que vão para o **DTO/zod**: …
- Tenant/transação: como o estado global ([Efeitos](#6-efeitos-colaterais--estado-externo)) vira tenant context / transação explícita.

**Frontend (React — [../02-stack-and-standards/frontend-react-standards.md](../02-stack-and-standards/frontend-react-standards.md)):**
- Componente/rota: `<rota>` + componentes do design system (mapa da seção 2).
- Estado/data-fetching (React Query), forms (react-hook-form+zod), grid (DataGrid teclado-first).
- Mapa de teclado (seção 8) consumido via `label="&…"`, `ShortcutScope`, `useEnterAdvances`.

**Decisões offline (PDV/Electron — ADR-008, [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md)):**
- Esta tela/funcionalidade roda **local no Electron**? O que precisa estar na **carga inicial** do PDV (cadastro/preço/parâmetro fiscal)?
- Há **escrita offline** (venda/cupom)? Então: identidade estável na origem, idempotência no sync, política de conflito (regra de negócio, não last-write-wins).
- Toca **contingência fiscal**? Numeração/série local, transmissão diferida.

> *Exemplo preenchido (decisão offline):*
> *Tela de cadastro de produto roda **na nuvem** (retaguarda), não no PDV. Mas seu output (NCM/CST/alíquotas/preço) **alimenta a carga inicial** do PDV: ao salvar, gera delta que o edge publica aos caixas (ADR-001, fluxo nuvem→edge→PDV). Logo, o contrato do delta é backward-compatible (ADR-009) e o teste de paridade fiscal (G-08) tem de rodar **no motor que o PDV usa offline**, não só na API.*

---

## Checklist de fechamento (todas verdes para `concluído`)

- [ ] Seções 1–10 preenchidas; nenhum campo em branco (só valor ou `N/A — motivo`).
- [ ] **Toda** SQL reconstruída com **todos** os caminhos condicionais (seção 4) e confirmada em **runtime**.
- [ ] Cada regra de negócio (seção 5) tem o *porquê* e procedência.
- [ ] Estado externo/datamodules mapeados (seção 6) — incluindo triggers/escritas-fantasma.
- [ ] Mapa de teclado extraído do `.dfm` (seção 8).
- [ ] Golden capturados cobrindo **cada** condicional e regra (seção 9).
- [ ] Dossiê **revisado** por agente independente ([../08-agents/review-loop.md](../08-agents/review-loop.md)).
- [ ] **Paridade verde** que exercita o caminho real ([../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)).
- [ ] Dossiê versionado junto do código-alvo.

---

## Ver também

- [dossier-process.md](dossier-process.md) — o processo que preenche e fecha este template.
- [README.md](README.md) — índice da seção 04.
- [../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md) — capturar SQL/golden em runtime (alimenta as seções 4 e 9).
- [../03-legacy-analysis/business-rule-extraction.md](../03-legacy-analysis/business-rule-extraction.md) — extrair regra com profundidade (seção 5).
- [../03-legacy-analysis/hidden-coupling-traps.md](../03-legacy-analysis/hidden-coupling-traps.md) — a armadilha de estado global (seção 6).
- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) — mapa de teclado do `.dfm` (seção 8).
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — onde os golden viram teste de paridade (seção 9).
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-012, ADR-010, ADR-008, ADR-011.
