# Dossiê — `frmCadTabelaPreco` (Cadastro de Tabela de Preço — Reajuste de Preço)

| Campo | Valor |
|---|---|
| **Status** | **`em-revisão`** — tela **corrigida e fiel** ao legado (análise estática `.pas`/`.dfm` integral + **dicionário Oracle confirmado read-only**); implementação já no app (`preco.crud.ts` + `PrecosCadMaster.tsx` + migração `011_preco.sql` + zod `tabela-preco.schema.ts`), **fiel-por-construção** e verde nos smokes. **NÃO `concluído`/`paridade-verde`**: falta **golden de runtime certificado do legado** (V$SQL não exercitado para esta tela; só [uCadBancos](uCadBancos.md) tem) e a **2ª revisão independente** ([../../08-agents/review-loop.md](../../08-agents/review-loop.md)). |
| **Autor / Revisor** | Analista de Legado (Claude) / *pendente — revisor independente* |
| **Versão do dossiê** | v0 (recon — herdeira do form-base com **DataModule próprio** carregando `BeforePost`/`OnNewRecord`) |
| **Data** | 2026-06-25 |
| **Commit do legado analisado** | `/Library/SicomGit/retaguarda-master` (branch `*-master`, sem hash versionado) |

> **O que define esta tela:** é herdeira do `TfrmCadMaster` (engine CRUD — [form-base-cadmaster.md](../../03-legacy-analysis/recon/form-base-cadmaster.md)) **completando o palette de campos** do app: **texto** (`DESCRICAO`) + **percentual** (`VALOR_REAJUSTE`, 0–100, **NÃO moeda**) + **2 flags S/N** (`REAJUSTE`, `ATIVO`) como checkbox. O **diferencial** em relação a [Marcas](uCadMarcas.md)/[NCM](uCadNCM.md): aqui o **DataModule próprio** (`UDmCadTabelaPreco`) carrega lógica — `CdsTabelaPrecoBeforePost` (PK por generator `ID_PRECO`) e `CdsTabelaPrecoNewRecord` (defaults `ATIVO='S'`/`REAJUSTE='S'`/`VALOR_REAJUSTE=0`/`INDR='I'`) — e o `.pas` do form tem **validação própria** (`ValidaCadastro`) + um **handler de UI condicional** (`CkbReajusteClick` habilita/zera o valor). Soft-delete **com `INDR` E `ATIVO`** (≠ Marcas, que só tem INDR). Sem trigger de replicação.
>
> ⚠️ **Limite desta versão:** análise **estática** de `.pas`/`.dfm` (form + DataModule + form-base `uCadMaster.pas` lido via `iconv` LATIN1→UTF-8, 1.806 linhas) + **dicionário Oracle confirmado read-only** (`pinheirao@dbhomologacao`). O playbook exige **captura de runtime** (`V$SQL`) para fechar §4/§9 ([dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md)). O pipeline de escrita do provider é `[inferido — herda Bancos]` (mesmo motor `TfrmCadMaster`/FireDAC; provado em runtime no piloto). Tudo não visto rodando está rotulado `[estático]`/`[inferido]`.

> **⚠️ Distinção de recurso (ler antes de tudo):** existe `/Library/Apollo/packages/shared/src/schema/**preco.schema.ts**` que é **OUTRO recurso** — precificação/cálculo de preço (motor de cálculo), **NÃO esta tela**. **Esta tela** é a **Tabela de Reajuste de Preço** (tabela `PRECO`, percentual de reajuste) e seus artefatos usam o prefixo `tabelaPreco*` / caminho `precos` justamente para **não colidir**: zod `tabela-preco.schema.ts` (tipos `tabelaPrecoSchema`/`atualizarTabelaPrecoSchema`), config `preco.crud.ts`, tela `PrecosCadMaster.tsx`, migração `011_preco.sql`. Não confundir os dois.

---

## 1. Identidade

| Campo | Valor |
|---|---|
| **Form (`.pas` / `.dfm`)** | `retaguarda-master/fonte/Units/UCadTabelaPreco.pas` (85 linhas) + `UCadTabelaPreco.dfm` (119 linhas) `[.dfm]` — datamodule próprio: `UDmCadTabelaPreco.pas` (69 linhas) + `.dfm` (164 linhas) |
| **Classe do form** | `TFrmCadTabelaPreco` — **herda `TfrmCadMaster`** (`uCadMaster.pas`, 1.806 linhas) via herança visual (`inherited frmCadTabelaPreco`) `[.dfm:L1]` `[.pas:L14]` |
| **Módulo de domínio** | `cadastro` (apoio comercial — tabela de **percentual de reajuste de preço**; cadastro de referência usado na precificação) |
| **Função no negócio** | CRUD de **tabelas de reajuste**: o operador cria/edita/exclui uma tabela com **descrição**, um **percentual de reajuste** (0–100%), um flag **Reajuste (S/N)** (se a tabela aplica reajuste) e um flag **Ativo (S/N)**. É cadastro de apoio (amostra de homologação: `PIZZARIA 10%`, `TESTE 5,5%`). |
| **Frequência / criticidade** | **baixa** frequência (cadastro estável, 2 linhas em homologação), **baixa-média** criticidade. **Não** é caminho de PDV interativo. **Não** toca fiscal (é percentual comercial, não tributo). |
| **Rota-alvo (web)** | `/cadastro/precos` (lista) · `/cadastro/precos/:id_preco` (edição) — recurso `cadastro/precos` (já implementado, ver [Paridade com o novo](#paridade-com-o-novo)) |
| **Casca-alvo** | `browser` — tela de retaguarda/nuvem (ADR-001), sem device, sem tecla reservada crítica. (Electron só se entrar no pacote power-user; sem requisito próprio.) |

---

## 2. UI — inventário de componentes (`.dfm` → React)

Herança visual de `TfrmCadMaster`: o `.dfm` herda **todo** o chrome do form-base — `imgCabecalho`, `lblTitulo` (Caption sobrescrito = `Tabela de preço`), `pnlGeral` (container dos campos próprios), `pnlCabecalho` (com `edtCodigo`+`btnPesquisa`+`DBNavigator1` — este **`Visible=False`** aqui `[.dfm:L113-117]`), `pnlRodapeMaster` (botões de ação), `stbHints` (status bar) e os ClientDataSets/engine herdados. Abaixo, **os controles próprios** desta tela (todos em `pnlGeral`, bind `DataSource = dtsPrincipal` herdado → `cdsPrincipal` = `DM.CdsTabelaPreco`).

| Controle (`.dfm`) | Tipo VCL | Left,Top,W,H | Caption/label (com `&`) | Bind (DataField) | → Componente React (DS) | Nota de reflow |
|---|---|---|---|---|---|---|
| `LblDescricao` | `TLabel` | 9,10,46,13 | `Descrição` (**sem `&`**; `FocusControl=EdtDescricao`) | — | `<label>` | linha 1, label do campo |
| `EdtDescricao` | `TDBEdit` | 9,27,376,21 | (rótulo via `LblDescricao`) | `DESCRICAO` | `<Field>` (Size=60) | linha 1, campo largo · `TabOrder=0` |
| `CkbAtivo` | `TDBCheckBox` | 400,29,70,17 | `Ativo` (**sem `&`**) | `ATIVO` | `<CheckboxField>` | linha 1, à direita · `ValueChecked='S'`/`ValueUnchecked='N'` · `TabOrder=1` |
| `GpbReajuste` | `TGroupBox` | 8,58,137,63 | (sem caption) | — | `<FieldGroup>` (container) | linha 3, agrupa o valor do reajuste · `TabOrder=3` |
| `LblValorReajuste` | `TLabel` | 8,14,82,13 (rel. ao group) | `Valor do reajuste` (**sem `&`**; `FocusControl=CedValorReajuste`) | — | `<label>` | dentro do group |
| `CedValorReajuste` | `TJvDBCalcEdit` | 8,31,121,21 (rel. ao group) | (rótulo via `LblValorReajuste`) | `VALOR_REAJUSTE` | `<NumberField>` **percentual** | dentro do group · **`DisplayFormat='0.00'`, `MaxValue=100`, `ShowButton=False`** · `TabOrder=0` |
| `CkbReajuste` | `TDBCheckBox` | 8,53,70,17 | `Reajuste` (**sem `&`**) | `REAJUSTE` | `<CheckboxField>` | linha 2 · `ValueChecked='S'`/`ValueUnchecked='N'` · `OnClick=CkbReajusteClick` · `TabOrder=2` |

`[.dfm:L23-92]`

**Herdados (do form-base, reusados pelo engine CRUD do alvo):** `edtCodigo` (campo de código/lookup da PK `ID_PRECO`), `btnPesquisa` (abre pesquisa sobre `GET_PRECO`), `DBNavigator1` (**oculto** aqui), botões de ação do rodapé (Gravar/Cancelar/Editar/Excluir/Adicionar + `btnOutros`), `rdgAtivo` (filtro Ativo `[F6]`), `stbHints`.

> **Achado-chave (percentual, NÃO moeda):** `CedValorReajuste` é um `TJvDBCalcEdit` com **`DisplayFormat='0.00'`, `MaxValue=100.0`, `ShowButton=False`** `[.dfm:L50-53]`. Os três juntos provam que `VALOR_REAJUSTE` é um **percentual 0–100** (duas casas, teto 100, sem botão de calculadora popup), **não** um valor monetário. Confirmado pelo Oracle (amostras 10 e 5,5; ≤100) e pelas amostras de homologação. O alvo renderiza como `<NumberField>` com sufixo `%`, `max=100`, `min=0`, `decimais=2`, sem spinner — **não** `<MoneyField>`. Registrar esta leitura como decisão consciente (um leitor desavisado migraria como moeda).

> **Achado (`GpbReajuste` agrupa só o valor, não o checkbox):** o `TGroupBox` `[.dfm:L31-58]` contém **apenas** `LblValorReajuste`+`CedValorReajuste`; o `CkbReajuste` fica **fora** do group, logo acima dele `[.dfm:L80-92]`. No reflow, manter o vínculo lógico Reajuste→Valor (o checkbox controla o campo do group via `CkbReajusteClick`, §3/BR-04), mas não copiar a fronteira de pixel do group.

> **Achado (labels sem mnemônico no legado):** `LblDescricao`/`LblValorReajuste`/`CkbAtivo`/`CkbReajuste` **não têm `&`** `[.dfm]`. Logo, **não há Alt+letra próprio** no legado (os `FocusControl` apenas ligam label→campo). O app novo introduziu `&Descrição`/`&Valor do Reajuste (%)`/`&Reajuste`/`&Ativo` — **melhoria consciente** (ADR-010: mnemônico é piso, adicionar não quebra memória muscular). Registrar como divergência aceitável (igual a [Marcas](uCadMarcas.md)).

**Notas de reflow:** layout absoluto `Left/Top` → grid fluido. No alvo: `Descrição` ocupa a linha cheia (`col-span-2`), `Valor do Reajuste (%)` numa coluna, e `Reajuste`+`Ativo` lado a lado numa linha de checkboxes. Preservar **ordem de leitura e taborder** (§8), não o pixel. `TJvDBCalcEdit`→`<NumberField>`; `TDBCheckBox`→`<CheckboxField>`; `TGroupBox`→`<FieldGroup>`/container.

---

## 3. Eventos

Handlers do `.pas` do form (próprios) + handlers do **DataModule** (`UDmCadTabelaPreco.pas`) + o ciclo herdado de `TfrmCadMaster` (§7). **Esta tela é mais "gorda" que Marcas/Bancos**: tem validação própria, UI condicional e defaults/PK no DataModule.

| Componente.Evento | `.pas` | O que faz (passo a passo) | Toca SQL? | Toca estado externo? | Vira (alvo) |
|---|---|---|---|---|---|
| `FormCreate` | `[.pas:L64-68]` | `inherited`; chama **`SetaDataset(EdtDescricao, DM.CdsTabelaPreco, 'ID_PRECO', 'PRECO')`** — wira o cds da tabela `PRECO` ao form-base, PK=`ID_PRECO`, tabela=`PRECO`, foco inicial=`EdtDescricao`, **`TipoChave` omitido ⇒ default `tcAutomatica`** (PK gerada por app, BR-03). `DM` é lazy via `GetDM` `[.pas:L70-75]` (cria `TDMCadTabelaPreco` sob demanda) | indireto (prepara dataset) | cria datamodule; usa conn global `dmPrincipal.FDConexao` | montagem do form + bind do recurso `/cadastro/precos` |
| `btnGravarClick` | `[.pas:L39-54]` | **(1)** `try ValidaCadastro` (BR-01/BR-02). **(2)** `except on TValidacaoException`: `Mensagem(E.Message)`; se `E.Campo` setado → `SetaFoco(E.Campo)`; `Exit` (**bloqueia gravação**, devolve foco ao campo culpado). **(3)** se passou: `inherited` (todo o pipeline de gravação do form-base: RBAC→obrigatórios→`ApplyUpdates`→histórico→carimbo→log; ver §6/§7) | sim (via `ApplyUpdates`, herdado) | sim (ver §6) | `POST`/`PUT /cadastro/precos` + validações no DTO/service |
| `CkbReajusteClick` | `[.pas:L56-62]` | `inherited` (toggle do `TDBCheckBox` herdado → grava `REAJUSTE` 'S'/'N' no field). Depois: **`CedValorReajuste.Enabled := CkbReajuste.Checked`** (habilita/desabilita o campo de valor). Se **desmarcou** (`not Checked`) **E** `DtsPrincipal.State in dsEditModes` → **zera** `VALOR_REAJUSTE := 0` (`AsCurrency := 0`) | — | — (estado de UI/form) | `onChange` do checkbox Reajuste: desabilita+zera `valor_reajuste` quando 'N' (ver Paridade §10) |
| `CdsTabelaPrecoNewRecord` (DM) | `[DM .pas:L59-67]` | `OnNewRecord` do cds: defaults na inclusão → **`ATIVO:='S'`**, **`REAJUSTE:='S'`**, **`VALOR_REAJUSTE:=0`** (`AsCurrency`), **`INDR:='I'`**, `INDR_USUARIO := dmPrincipal.OperadorCODOPERADOR`, `INDR_DATA := Now` | — | lê operador logado | `defaultValues` do create (BR-05) |
| `CdsTabelaPrecoBeforePost` (DM) | `[DM .pas:L53-57]` | `BeforePost` do cds: **se `ID_PRECO = 0`** → `ID_PRECO := TDB.GetId(dmPrincipal.FDConexao, 'ID_PRECO')` (gera PK pelo generator). **Guarda defensiva**: o form-base já setou `ID_PRECO` no `Inserir` (`tcAutomatica`, BR-03), então aqui `ID_PRECO<>0` e a linha é **no-op** na prática; só dispara se o caminho do form-base não tiver gerado (cinto+suspensório) | indireto (consome generator) | consome generator `ID_PRECO` | PK por sequence (engine) |
| `FreeAndNil(fDM)` | `[inferido]` | a tela não tem `FormClose` próprio; o `DM` é criado com `Owner=Self` (`TDMCadTabelaPreco.Create(Self)` `[.pas:L73]`) ⇒ liberado junto com o form (≠ Marcas, que dava `FreeAndNil` manual) | — | libera datamodule | cleanup automático |

> Observação ("migre o que o sistema faz"): olhando só a tela, ela parece um CRUD de 4 campos. Mas o **DataModule** carrega 2 regras invisíveis na UI (defaults de inclusão + PK por generator) e o **form** carrega validação própria + UI condicional. A leitura "olhando a tela" perderia tudo isso. Note ainda a `TValidacaoException` com `Campo` embutido `[.pas:L80-82]` — é um mecanismo de validação-com-foco (a mensagem **e** o controle a focar viajam juntos), que no alvo vira erro de campo do `react-hook-form` (mensagem + `path`).

---

## 4. Dados — TODA query

> A tela tem **uma** query estática própria (Q1) no DataModule + o **pipeline de escrita** gerado pelo provider (herdado, `[inferido]`) + a **pesquisa** sobre a view `GET_PRECO` (herdada) + a **geração de PK** via generator `ID_PRECO`. Estrutura/colunas **confirmadas read-only** no dicionário Oracle (`pinheirao@dbhomologacao`, 2026-06-25).

### Estrutura da tabela `PRECO` — ✅ CONFIRMADA (Oracle `ALL_TAB_COLUMNS`, read-only) `[Oracle-dict]`

| Coluna | Tipo Oracle | Papel | → Postgres (alvo) |
|---|---|---|---|
| `ID_PRECO` | `NUMBER(10)` **NOT NULL** | PK (generator `ID_PRECO`) | `integer PRIMARY KEY DEFAULT nextval('seq_preco_id_preco')` |
| `DESCRICAO` | `VARCHAR2(60)` | descrição da tabela de reajuste | `varchar(60)` |
| `VALOR_REAJUSTE` | `NUMBER(13,2)` | **PERCENTUAL** de reajuste (amostras 5,5 / 10; ≤100; **NÃO moeda**) | `numeric(13,2)` |
| `REAJUSTE` | `CHAR(1)` | flag S/N (tabela aplica reajuste?) | `char(1)` |
| `ATIVO` | `CHAR(1)` | flag S/N (registro ativo) | `varchar(1)` / `char(1)` |
| `INDR` | `CHAR(1)` | soft-delete (`'E'`=excluído; `'I'`/null=ativo) | `char(1)` |
| `INDR_USUARIO` | `NUMBER` | operador que excluiu | `integer` |
| `INDR_DATA` | `TIMESTAMP` | data da exclusão (servidor) | `timestamptz` |
| `USUCADASTRO` | `NUMBER` | operador do cadastro (carimbo no insert) | `integer` |
| `DTCADASTRO` | `TIMESTAMP` | data de cadastro (carimbo no insert) | `timestamptz` |
| `USULTALTERACAO` | `NUMBER` | operador da última alteração (carimbo) | `integer` |
| `DTULTIMALTERACAO` | `TIMESTAMP` | data da última alteração (carimbo) | `timestamptz` |

- **Constraints:** PK em `ID_PRECO`. **Sem CHECK/DEFAULT** além de NOT NULL básicos `[Oracle-dict]` — os defaults de inclusão (`ATIVO='S'`, `REAJUSTE='S'`, `VALOR_REAJUSTE=0`, `INDR='I'`) vêm do **`OnNewRecord` do app** (BR-05), **não** do banco.
- **Triggers:** **NENHUMA de replicação** — não existe `REM_PRECO`. **PRECO não replica** (igual a [Marcas](uCadMarcas.md)/[NCM](uCadNCM.md), ≠ Bancos). Ver §6.
- **Generator/sequence:** generator **`ID_PRECO`** consumido por `dmPrincipal.GetID('ID_PRECO')` (form-base, `tcAutomatica`) e pela guarda `TDB.GetId(...,'ID_PRECO')` no `BeforePost` do DM (BR-03). PK **gerada pelo app antes do INSERT**; INSERT a lista explicitamente.
- **Amostras de homologação (2 linhas):** `PIZZARIA` (`VALOR_REAJUSTE=10`) e `TESTE` (`VALOR_REAJUSTE=5,5`) `[Oracle-dict]` — confirmam percentual ≤100 com 1–2 casas (corroboram a leitura de §2).

### Q1 — `QryTabelaPreco` (leitura de 1 registro por código) — `[.dfm SQL.Strings]` ✅

- **Origem:** `UDmCadTabelaPreco.dfm` `[DM .dfm:L5-88]` — `TFDQuery QryTabelaPreco`, `Connection = dmPrincipal.FDConexao` (global), feeding `DspTabelaPreco` (`TDataSetProvider`, **`UpdateMode = upWhereKeyOnly`** `[DM .dfm:L91]`) → `CdsTabelaPreco` (`TClientDataSet`).
- **Quando dispara:** ao abrir/editar uma tabela de preço pelo código (via `SetaDataset`→`AbreDataset` do form-base).
- **SQL base (Oracle, verbatim do `.dfm`)** `[DM .dfm:L7-11]`:
  ```sql
  SELECT *
  FROM PRECO
  WHERE ID_PRECO = :CODIGO
    AND COALESCE(INDR,'I') <> 'E'
  ```
- **Fragmentos condicionais:** **nenhum** (estática pura). **Filtro embutido:** `COALESCE(INDR,'I') <> 'E'` — a query **já esconde os excluídos** (soft-delete, BR-06). Carregar por código um registro já excluído **retorna vazio** (não dá para reabrir um excluído pelo código).
- **Params:** `:CODIGO` (`ftInteger`, `ptInput`) `[DM .dfm:L14-20]` — origem: `edtCodigo` / chave selecionada na pesquisa. (O `CdsTabelaPreco` também declara o param `CODIGO ftInteger` `[DM .dfm:L97-102]`.)
- **Campos do dataset / `ProviderFlags`:** `SELECT *` traz **12 colunas**, todas materializadas como `TField` no cds `[DM .dfm:L21-87, L108-162]`. `ID_PRECO` = `[pfInUpdate, pfInWhere, pfInKey]` + **`Required=True`** (única Required); todas as demais = `[pfInUpdate]` e **não-Required**. → **alimenta BR-02 (camada form-base):** a `ValidaObrigatorios` do form-base só cobraria `ID_PRECO` (auto-gerado) — por isso a **descrição-obrigatória vem do `ValidaCadastro` próprio** (BR-01), não do mecanismo de Required. `VALOR_REAJUSTE` é `TFloatField` no cds (mapeado de `NUMBER(13,2)`).
- **Mutações:** leitura (Q1) + escrita (pipeline do provider, abaixo).
- **Tabelas / triggers / sequences tocadas:** `PRECO` (CRUD). **Sem trigger.** PK via generator `ID_PRECO` (app-side).
- **SQL-alvo (Postgres, Kysely):**
  ```sql
  select id_preco, descricao, valor_reajuste, reajuste, ativo, indr,
         indr_usuario, indr_data, usucadastro, dtcadastro, usultalteracao, dtultimalteracao
  from preco
  where id_preco = $1 and coalesce(indr,'I') <> 'E'
  ```
  Oracle→PG: `COALESCE` igual (padrão SQL; o `.dfm` já usa `COALESCE`, não `NVL`). `NUMBER(13,2)`→`numeric(13,2)`, `CHAR(1)`→`char(1)`, `TIMESTAMP`→`timestamptz`, `NUMBER(10)`→`integer`. O `SELECT *` vira projeção explícita das colunas. ⚠️ A migração `011_preco.sql` projeta **menos** colunas na `get_preco` (ver Q2) — a leitura por id no engine recupera a linha pela tabela, não pela view.

### Q-PK — geração do `ID_PRECO` (app-side generator) — `[.pas form-base:L1296]` + `[DM .pas:L55-56]` ✅ (generator confirmado)

- Caminho **principal** (form-base, `tcAutomatica`): no `Inserir`, ao entrar em `dsInsert`, `[uCadMaster.pas:L1295-1297]`:
  ```pascal
  cdsPrincipal.FieldByName('ID_PRECO').Value := dmPrincipal.GetID('ID_PRECO');
  ValorChavePrimaria := cdsPrincipal.FieldByName('ID_PRECO').AsString;
  ```
- Caminho **guarda** (DataModule, `BeforePost`) `[DM .pas:L53-57]`:
  ```pascal
  if CdsTabelaPrecoID_PRECO.AsInteger = 0 then
    CdsTabelaPrecoID_PRECO.AsInteger := TDB.GetId(dmPrincipal.FDConexao, 'ID_PRECO');
  ```
  Como o form-base já preencheu `ID_PRECO` (não-zero) **antes** do Post, a guarda é **no-op** no fluxo normal. Os dois consomem o **mesmo generator `ID_PRECO`** ⇒ sem risco de pulo duplo no caminho feliz.
- **No alvo:** `seq_preco_id_preco` no Postgres (`DEFAULT nextval`) — **paridade de resultado** (código sequencial auto-gerado, não digitado). Já implementado assim na migração (ver [Paridade](#paridade-com-o-novo)).

### Q-WRITE — pipeline de gravação/exclusão (provider FireDAC) — `[inferido — herda Bancos]`

- O provider gera **DML delta-based bindada** a partir do delta do `CdsTabelaPreco` em `ApplyUpdates(0)` (`UpdateMode=upWhereKeyOnly` → WHERE só pela PK). Por analogia direta com o piloto [Bancos](uCadBancos.md) (mesmo motor, capturado em runtime lá), o esperado:
  ```sql
  -- INSERT (só colunas tocadas; ID_PRECO vem do generator; defaults do OnNewRecord viajam no delta)
  insert into "PRECO" ("ID_PRECO","DESCRICAO","VALOR_REAJUSTE","REAJUSTE","ATIVO","INDR","INDR_USUARIO","INDR_DATA")
    values (:1,:2,:3,:4,:5,:6,:7,:8)
  -- UPDATE de edição (só colunas alteradas; WHERE pela PK)
  update "PRECO" set "DESCRICAO"=:1, "VALOR_REAJUSTE"=:2, "REAJUSTE"=:3, "ATIVO"=:4 where "ID_PRECO"=:5
  -- exclusão = SOFT-DELETE (não DELETE físico — ver BR-06/§6); seta INDR E ATIVO:
  update "PRECO" set "INDR"='E', "INDR_USUARIO"=:1, "INDR_DATA"=:2, "ATIVO"='N' where "ID_PRECO"=:3
  ```
  ⚠️ **A exclusão seta `ATIVO='N'` além do `INDR`:** o `ExcluirRegistro` do form-base `[uCadMaster.pas:L901-907]` faz `INDR:='E'`+`INDR_USUARIO`+`INDR_DATA` e, **como `PRECO` tem a coluna `ATIVO`**, executa também `Cds.FieldByName('ATIVO').AsString := 'N'`. Diferente de Marcas (sem `ATIVO`) — aqui o soft-delete mexe em **duas** colunas.
- **Carimbo de auditoria = 2º statement separado** (literal, herdado de `SetaOperadorAlteracao` `[uCadMaster.pas:L472/479]`), emitido **após** o insert/update:
  ```sql
  -- após INSERT (Status=dsInsert ⇒ seta também DTCADASTRO/USUCADASTRO):
  UPDATE PRECO SET USULTALTERACAO=<op>, DTULTIMALTERACAO=<now>, USUCADASTRO=<op>, DTCADASTRO=<now> WHERE ID_PRECO=<id>
  -- após UPDATE de edição:
  UPDATE PRECO SET USULTALTERACAO=<op>, DTULTIMALTERACAO=<now> WHERE ID_PRECO=<id>
  ```
  ⚠️ Esse UPDATE de carimbo **NÃO dispara replicação** (sem `REM_PRECO`). As colunas `USULTALTERACAO`/`DTULTIMALTERACAO`/`USUCADASTRO`/`DTCADASTRO` existem (confirmado), então o carimbo **roda**.
- **Tabelas/triggers:** só `PRECO`. **Zero trigger** → **zero escrita-fantasma de replicação**.
- **SQL-alvo (Postgres):** `insert/update` explícitos no engine repository; exclusão = `update preco set indr='E', indr_usuario=$, indr_data=now(), ativo='N' where id_preco=$`; carimbo de auditoria preenchido **no service** (mesma transação).

### Q2 — Pesquisa / listagem (`btnPesquisa` → `frmPesquisa` sobre `GET_PRECO`) — `[estático]` + view real confirmada

- **Origem:** form-base `TfrmCadMaster.btnPesquisaClick` abre `frmPesquisa` (`uPesquisa.pas`) sobre a **VIEW `GET_PRECO`** (`FViewPesquisa = 'GET_' + FTabela = 'GET_PRECO'`).
- **View `GET_PRECO` real (legado):** projeta `ID_PRECO`/`DESCRICAO`/`VALOR_REAJUSTE`/`REAJUSTE`/`ATIVO` e **pré-filtra `INDR='I'`** (esconde excluídos na própria view) `[Oracle-dict]`. O form-base ainda pode acrescentar filtro ao WHERE do grid.
- **SQL final esperada (por analogia com Bancos, `[inferido]`):**
  ```sql
  select FORM from TABELA_CADASTRO where TABELA = 'GET_PRECO'        -- config do form de pesquisa
  select Cast('F' as CHAR(1)) as Selecionar, Cast('T' as CHAR(1)) as Sel, GET_PRECO.*
  from GET_PRECO [ + (COALESCE(INDR,'I')='I') / filtro / ordem do usuário ]
  ```
- **Alvo:** `GET /cadastro/precos?...` — lista paginada sobre `get_preco`, **com a situação (ativos/inativos/todos) aplicada na query** pelo engine. **Nota de divergência (consciente):** a `get_preco` da migração `011_preco.sql` **expõe `INDR` e NÃO pré-filtra** (`SELECT id_preco, descricao, valor_reajuste, reajuste, ativo, indr FROM preco`), deixando o engine aplicar o filtro de situação — **resultado idêntico** ao da view real que pré-filtra `INDR='I'` quando a situação pedida é "ativos". Documentado no próprio SQL da migração.

> **Regra de ouro:** Q1 (leitura) e a estrutura/`GET_PRECO`/generator estão **confirmadas** (dicionário Oracle + `.dfm`). O **pipeline de escrita** (Q-WRITE) e a **SQL final da pesquisa** (Q2 com filtro/ordem) ainda são `[inferido]` (herdados do motor de Bancos) **até captura de runtime** (`V$SQL`) específica de PRECO. **Não declarar paridade-verde sem isso** — ver [Lacunas](#lacunas--pendências).

---

## 5. Regras de negócio (o *porquê*, não só o *o quê*)

| ID | Regra | Gatilho | Lógica (verbatim do legado) | *Porquê* | Procedência |
|---|---|---|---|---|---|
| BR-01 | **Descrição obrigatória** | ao gravar (antes do `inherited`) | `ValidaCadastro`: `if EdtDescricao.Field.AsString = '' then raise TValidacaoException.Create('Informe a descrição da tabela de preço.', EdtDescricao)` → `btnGravarClick` captura, `Mensagem`, `SetaFoco(EdtDescricao)`, `Exit` (**bloqueia**) | toda tabela de reajuste precisa de um nome legível para seleção/relatório | `[.pas:L77-83]` + `[.pas:L39-54]` |
| BR-02 | **Valor do reajuste > 0 quando Reajuste='S'** | ao gravar (antes do `inherited`) | `ValidaCadastro`: `if (CkbReajuste.Field.AsString = 'S') and (CedValorReajuste.Field.AsCurrency = 0) then raise TValidacaoException.Create('Informe o valor do reajuste.', CedValorReajuste)` → bloqueia + foca o campo | se a tabela **aplica** reajuste, um percentual zero não faz sentido (seria reajuste nulo); se `REAJUSTE='N'`, o valor é irrelevante (e fica zerado, BR-04) | `[.pas:L77-83]` |
| BR-03 | **PK automática por generator** | ao inserir | form-base (`tcAutomatica`): `ID_PRECO := dmPrincipal.GetID('ID_PRECO')` `[uCadMaster.pas:L1296]`; guarda no DM: `if ID_PRECO=0 then ID_PRECO := TDB.GetId(...,'ID_PRECO')` `[DM .pas:L55-56]` (no-op no caminho feliz) | identidade sequencial estável, não digitada | `[.pas:L67]` (sem 4º param ⇒ `tcAutomatica`) + `[Oracle-dict: generator ID_PRECO]` |
| BR-04 | **Desmarcar Reajuste desabilita E zera o valor** | `CkbReajuste.OnClick` | `CedValorReajuste.Enabled := CkbReajuste.Checked`; se `not Checked` **e** `State in dsEditModes` → `VALOR_REAJUSTE := 0` | coerência de UI/dado: tabela sem reajuste não carrega percentual residual (e casa com BR-02, que só exige valor quando `REAJUSTE='S'`) | `[.pas:L56-62]` |
| BR-05 | **Defaults na inclusão (`OnNewRecord`)** | ao inserir novo registro | `CdsTabelaPrecoNewRecord`: `ATIVO:='S'`, `REAJUSTE:='S'`, `VALOR_REAJUSTE:=0`, `INDR:='I'`, `INDR_USUARIO:=operador`, `INDR_DATA:=Now` | novo cadastro nasce **ativo** e **com reajuste ligado** (combinado com BR-02, força o operador a informar o percentual antes de gravar) | `[DM .pas:L59-67]` |
| BR-06 | **Exclusão = SOFT-DELETE (INDR + ATIVO); leitura/pesquisa escondem excluídos** | ao excluir / ao listar / carregar por código | `ExcluirRegistro`: `INDR:='E'`, `INDR_USUARIO:=op`, `INDR_DATA:=data servidor`, **e `ATIVO:='N'`** (coluna existe) → `Post`→`ApplyUpdates` (UPDATE, não DELETE) `[uCadMaster.pas:L901-907]`. Leitura (Q1) filtra `COALESCE(INDR,'I')<>'E'`; view `GET_PRECO` pré-filtra `INDR='I'` | preservar histórico / não quebrar referências; excluído não reaparece nem por código nem por busca | `[uCadMaster.pas:L886-909]` + `[DM .dfm:L11]` + `[Oracle-dict: INDR e ATIVO existem]` |
| BR-07 | **Permissão por form+ação (RBAC)** | ao gravar / editar / excluir | `dmPrincipal.PossuiAcessoForm('FrmCadTabelaPreco','BTNGRAVAR')` (e `'BTNEXCLUIR'`/`'BTNEDITAR'`); sem permissão → cancela + alerta, **zero DML** | RBAC data-driven por tela/ação | `[uCadMaster.pas:L430, L392, L348]` |
| BR-08 | **Carimbo de operador/data** | ao gravar | `SetaOperadorAlteracao(...)`: `USULTALTERACAO`=operador, `DTULTIMALTERACAO`=now; no **insert** também `USUCADASTRO`/`DTCADASTRO`=now (flag `Status=dsInsert`) | autoria/auditoria | `[uCadMaster.pas:L472/479]` + `[Oracle-dict: colunas existem]` |
| BR-09 | **Sem empresa/operador como FK** | ao gravar | `SetaDataset` chamado **sem** `PreencheEmpresa`/`PreencheOperador` (defaults `False` `[uCadMaster.pas:L139]`); `PRECO` não tem `CODEMPRESA`/`CODOPERADOR` | tabela de reajuste é global ao tenant, não por empresa/filial | `[.pas:L67]` + `[Oracle-dict: sem CODEMPRESA/CODOPERADOR]` |

> **Cálculo:** esta tela **não calcula** nada (não aplica o reajuste; só **cadastra o percentual**). A aplicação do percentual a preços é de **outro recurso** (precificação — `preco.schema.ts`, ver aviso no topo). Aqui `VALOR_REAJUSTE` é um **dado de entrada** percentual (0–100, 2 casas), validado por BR-02. **Sem regra fiscal, sem CharCase** (o `TDBEdit`/`TJvDBCalcEdit` não normalizam caixa). O *porquê* canônico do soft-delete: a tabela de reajuste pode ser referenciada; apagar fisicamente quebraria a referência histórica.

---

## 6. Efeitos colaterais + estado externo

> A seção que salva da armadilha de acoplamento ([hidden-coupling-traps.md](../../03-legacy-analysis/hidden-coupling-traps.md)).

| Item | Tipo (lê/grava) | Alvo | Quem setou / quem consome | Mapeamento alvo |
|---|---|---|---|---|
| `dmPrincipal.FDConexao` | usa | conexão Oracle **global** | datamodule principal (boot) | conexão **por tenant** request-scoped |
| `dmPrincipal.OperadorCODOPERADOR` | lê | operador logado | login | usuário no request context (fail-closed) |
| `dmPrincipal.PossuiAcessoForm` | lê | RBAC (tabela de permissões) | login/permissões | guard/policy por rota+ação (`FRMCADPRECO`) |
| `dmPrincipal.GetID('ID_PRECO')` / `TDB.GetId(...,'ID_PRECO')` | lê+consome | generator `ID_PRECO` | sequence Oracle | `nextval('seq_preco_id_preco')` |
| `BancoExecutando.GetDataServidor` | lê | relógio do servidor Oracle | — | `now()` do Postgres (no service) |
| `USUCADASTRO`/`DTCADASTRO`/`USULTALTERACAO`/`DTULTIMALTERACAO` | grava | colunas da própria `PRECO` | `SetaOperadorAlteracao` (herdado) | colunas de auditoria preenchidas no service |
| `INDR`/`INDR_USUARIO`/`INDR_DATA`/**`ATIVO`** | grava | colunas da própria `PRECO` | `ExcluirRegistro` (herdado) na exclusão | soft-delete no service (seta **INDR + ATIVO='N'**) |
| `HISTORICO_DINAMICO` | grava (indireto) | tabela de histórico genérica | `SetaHistorico_Dinamico` no gravar/excluir herdado **se `cdsHistorico_dinamico.Active`** | audit log / interceptor (decidir manter) |
| `TLog.GravaLog` | grava | log de aplicação | gravação herdada (try/except, best-effort; `{$IFDEF SICOM-MP}` desliga `uLog` `[uCadMaster.pas:L207]`) | logging estruturado |
| **trigger `REM_PRECO`** | **N/A — NÃO EXISTE** | — | — | **sem replicação** (≠ Bancos) `[Oracle-dict: sem trigger de replicação]` |

- **Conexão/transação:** usa a conexão **global** do `dmPrincipal`. No alvo: transação **escopada** ao caso de uso (write de preço + carimbo numa só transação).
- **Ordem de abertura assumida:** presume login feito (operador/permissões em `dmPrincipal`). Precondição → contexto explícito no alvo.

> **Diferença para [Bancos](uCadBancos.md):** Bancos tem `REM_BANCOS` → escrita-fantasma de replicação por terminal. **PRECO não tem trigger de replicação** — logo **não há outbox/replicação a replicar** (`replica:false` na config, [Paridade](#paridade-com-o-novo)). **Diferença para [Marcas](uCadMarcas.md):** PRECO tem coluna `ATIVO`, então o soft-delete mexe em **INDR + ATIVO** (Marcas só em INDR). O que sobra de efeito é o **carimbo de auditoria** (4 colunas) + histórico dinâmico + log — nenhum fiscal/crítico.

---

## 7. Dependências

| Dependência | Tipo | Como é usada | Vira (alvo) |
|---|---|---|---|
| `TfrmCadMaster` (`uCadMaster.pas`) | **herança** | todo o CRUD: gravar/editar/excluir/pesquisar/navegar, `ValidaObrigatorios`, soft-delete (`ExcluirRegistro`), carimbo (`SetaOperadorAlteracao`), histórico, log, RBAC, teclado, máquina de estados, geração de PK (`tcAutomatica`) | **engine CRUD reutilizável** (`createCrudController` + pilar `CadMaster`, ADR-014) |
| `TDMCadTabelaPreco` (`UDmCadTabelaPreco`) | datamodule **com lógica** | `QryTabelaPreco`→`DspTabelaPreco`→`CdsTabelaPreco` (Q1) + `BeforePost` (PK) + `OnNewRecord` (defaults) | config declarativa (`precoCrudConfig`) + defaults no `defaultValues` |
| `udmPrincipal` (`dmPrincipal`) | datamodule global | conexão, operador, RBAC, `GetID`, histórico | tenant context + providers |
| `uDBBase` (`TDB`) | unit util | `TDB.GetId(conexao, 'ID_PRECO')` (guarda de PK no `BeforePost`) | serviço de sequence |
| `FuncoesApollo` | unit util | `Mensagem`, `SetaFoco`, `TValidacaoException`/`SetaDataset` (via form-base) | utils/serviços + erro de campo do form |
| `uPesquisa` (`frmPesquisa`) | form modal | pesquisa sobre `GET_PRECO` (Q2) | serviço de listagem/filtro paginado |
| `JvBaseEdits` (`TJvDBCalcEdit`) / `JvDBControls` | lib JVCL | editor numérico do `VALOR_REAJUSTE` (percentual) | `<NumberField>` do DS |
| FastReport (`frx*`) | lib | export (herdado, não usado nesta tela) | export server-side |

> **DataModule com lógica** (≠ Marcas/NCM, cujos DMs eram puro dataset): aqui o `BeforePost`+`OnNewRecord` carregam BR-03/BR-05. No alvo, viram parte da config/`defaultValues`, não código por tela.

---

## 8. TabOrder + mapa de atalhos/mnemônicos

**TabOrder (campos próprios, sequência exata `[.dfm]`):**

| Ordem | Controle | Campo | Tipo | Enter faz | Observação |
|---|---|---|---|---|---|
| 0 | `EdtDescricao` | DESCRICAO | TDBEdit | avança | foco inicial (via `SetaDataset`) `[.dfm:L66]` |
| 1 | `CkbAtivo` | ATIVO | TDBCheckBox | avança/toggle | `[.dfm:L75]` |
| 2 | `CkbReajuste` | REAJUSTE | TDBCheckBox | toggle (dispara `CkbReajusteClick`, BR-04) | `[.dfm:L88]` |
| 3 | `GpbReajuste` (group) | — | TGroupBox | — (container) | contém `CedValorReajuste` `TabOrder=0` interno `[.dfm:L36, L53]` |

`[.dfm]`. Em inclusão `tcAutomatica`, `edtCodigo` (herdado) é limpo e o foco vai para `FControleFoco = EdtDescricao` (form-base). **Nota:** o `CedValorReajuste` fica **dentro** do group (`TabOrder=0` no escopo do group), então na navegação real entra após `CkbReajuste`.

**Mnemônicos `&` (Alt+letra) — campos próprios:** **NENHUM** no legado. Nenhum dos labels/checkboxes tem `&` `[.dfm]` (os labels só ligam `FocusControl`). *(O app novo adiciona `&Descrição`/`&Valor do Reajuste (%)`/`&Reajuste`/`&Ativo` — melhoria consciente, ADR-010 é piso; ver §2.)*

**Atalhos de botão (herdados do form-base — [form-base-cadmaster.md §4](../../03-legacy-analysis/recon/form-base-cadmaster.md)):**

| Botão | Caption | Mnemônico | Ação |
|---|---|---|---|
| `btnEditar` | `&Editar` | Alt+E | entra em edição (RBAC BR-07) |
| `btnExcluir` | `E&xcluir` | Alt+X | exclui (soft-delete, BR-06) |
| `btnGravar` | `&Gravar` | Alt+G | grava (valida BR-01/BR-02 → `inherited`) |
| `btnCancelar` | `&Sair` / `&Cancelar` | Alt+S / Alt+C | sai/cancela (caption alterna) |
| `btnAdicionarRegistro` | `&Adicionar` | Alt+A | novo registro (defaults BR-05) |
| `btnOutros` | `&Outros` | Alt+O | popup `ppmBotaoOutros` |
| `rdgAtivo` | `Ati&vo [F6]` | Alt+V / **F6** | cicla filtro de situação (aqui **aplicável**: `PRECO` tem coluna `ATIVO`) |

**Teclas funcionais/navegação (herdadas, `KeyPreview`/`FormKeyDown`):** **Esc** engolida durante insert/edit; **F6** cicla `rdgAtivo`; **Alt+O** abre "Outros"; **←/→** em `edtCodigo` = registro anterior/próximo; **↑/↓** = primeiro/último; **Enter** em `edtCodigo` = carrega pelo código; `edtCodigo` só aceita dígitos (PK inteira). `DBNavigator1` está **oculto** nesta tela `[.dfm:L115]`. Comum às ~101 herdeiras → config-padrão do engine CRUD (ADR-010).

---

## 9. Casos de teste (golden) — capturados do legado

> ⚠️ **Sem golden de runtime certificado para PRECO.** Diferente de [Bancos](uCadBancos.md) (captura `V$SQL`/`REMESSA_SERVER`), aqui há **leitura do dicionário Oracle** (estrutura/view/generator/amostras confirmadas) + **smoke do novo verde** (seed=2; POST decimal `9.99` relido com precisão) + o motor herdado provado em Bancos. Os casos abaixo são a **matriz a capturar** (mesma técnica do piloto — [dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md)) e o **resultado já verificado no novo** onde indicado.

| ID | Cobre (BR/Q + caminho) | Input (estado + campos) | Ação | Output esperado | Procedência |
|---|---|---|---|---|---|
| G-01 | Q1 leitura (com filtro INDR) | abrir `ID_PRECO` existente e ativo | carregar por código | retorna a linha; status bar com última alteração | ✅ SQL confirmada (`.dfm` + `[Oracle-dict]`) |
| G-02 | BR-03 + BR-05 + INSERT delta | adicionar; aceitar defaults; `descricao='TESTE2'`; `valor_reajuste=9,99` | gravar novo | `ID_PRECO` vem do generator; `INSERT ... ("ID_PRECO","DESCRICAO","VALOR_REAJUSTE","REAJUSTE"='S',"ATIVO"='S","INDR"='I',...)`; carimbo `UPDATE ... DTCADASTRO/USUCADASTRO`; **0 replicação**. **No novo: POST `9.99` relido com precisão (2 casas)** ✅ smoke verde | `[inferido]` write + ✅ generator/smoke |
| G-03 | UPDATE delta | editar `descricao`/`valor_reajuste` | gravar | `update "PRECO" set "DESCRICAO"=:1,"VALOR_REAJUSTE"=:2,... where "ID_PRECO"=:n`; carimbo `UPDATE ... USULTALTERACAO`; **0 replicação** | `[inferido]` (herda Bancos) |
| G-04 | BR-06 soft-delete (INDR + ATIVO) | excluir registro existente | excluir | `update "PRECO" set "INDR"='E',"INDR_USUARIO"=op,"INDR_DATA"=<servidor>,"ATIVO"='N' where "ID_PRECO"=:id` (**não** DELETE físico); **0 replicação** | ✅ lógica confirmada (`uCadMaster.pas:L901-907` + `[Oracle-dict]`: INDR **e** ATIVO existem) |
| G-05 | BR-06 esconde excluído | tentar carregar por código um `INDR='E'` | carregar | **vazio** (filtro `COALESCE(INDR,'I')<>'E'`) | ✅ SQL confirmada (`DM .dfm:L11`) |
| G-06 | Q2 pesquisa + view real | pesquisar | abrir pesquisa | `GET_PRECO` projeta `ID_PRECO/DESCRICAO/VALOR_REAJUSTE/REAJUSTE/ATIVO`, pré-filtra `INDR='I'`; grid lista ativos | view ✅ confirmada `[Oracle-dict]`; SQL do grid `[inferido]` |
| G-07 | BR-01 descrição obrigatória | adicionar; `descricao` **vazio** | gravar | **bloqueado**: `Mensagem('Informe a descrição da tabela de preço.')` + foco em `EdtDescricao`; **zero DML** | ✅ lógica confirmada (`.pas:L79-80`) |
| G-08 | BR-02 valor>0 quando reajuste='S' | adicionar; `reajuste='S'`; `valor_reajuste=0` | gravar | **bloqueado**: `Mensagem('Informe o valor do reajuste.')` + foco em `CedValorReajuste`; **zero DML** | ✅ lógica confirmada (`.pas:L81-82`) |
| G-09 | BR-02 negativo (reajuste='N') | adicionar; `reajuste='N'`; `valor_reajuste=0` | gravar | **grava** (com `descricao` preenchida): valor 0 é aceito quando `REAJUSTE<>'S'` | ✅ lógica confirmada (`.pas:L81`) |
| G-10 | BR-04 UI condicional | marcar e depois **desmarcar** Reajuste em edição | toggle | `CedValorReajuste` desabilita **e** `VALOR_REAJUSTE` zera | ✅ lógica confirmada (`.pas:L56-62`) |
| G-11 | BR-07 RBAC | operador sem `BTNGRAVAR` | gravar | bloqueado **antes do banco** (cancel + alerta), **zero DML** | ✅ lógica confirmada (`uCadMaster.pas:L430`) |
| G-12 | Homolog (resultado) | listar a base de homologação | listar | 2 linhas: `PIZZARIA` (10) e `TESTE` (5,5) — percentuais ≤100 | ✅ `[Oracle-dict]` (amostras reais; seed da migração as reproduz) |

**Negativos/zero-DML:** G-07 (descrição), G-08 (valor>0), G-11 (RBAC) — todos bloqueiam antes do banco. **Percentual:** G-02/G-12 fixam que `VALOR_REAJUSTE` é percentual com casas decimais (9,99 / 5,5 / 10), não moeda.

---

## 10. Alvo (a especificação de implementação)

**Backend (NestJS — engine CRUD declarativo):**
- Módulo: `cadastro/precos` (já implementado — **declarativo**, ver [Paridade](#paridade-com-o-novo)).
- Endpoints:
  | Método+rota | Origem (Q/BR) | DTO (zod) | Mutação? |
  |---|---|---|---|
  | `GET /cadastro/precos` | Q2 | filtro de situação | leitura (esconde excluídos) |
  | `GET /cadastro/precos/:id_preco` | Q1 | — | leitura (filtra `<>'E'`) |
  | `POST /cadastro/precos` | btnGravar (insert), BR-01/02/03/05 | `tabelaPrecoSchema` | escrita (sem outbox) |
  | `PUT /cadastro/precos/:id_preco` | btnGravar (update), BR-01/02 | `atualizarTabelaPrecoSchema` | escrita |
  | `DELETE /cadastro/precos/:id_preco` | btnExcluir, BR-06 | — | escrita = **soft-delete** (`indr='E'`, `ativo='N'`) |
- Para o **service**: RBAC (BR-07) via guard (`FRMCADPRECO`); carimbo operador/data (BR-08); soft-delete **INDR+ATIVO** (BR-06); **sem outbox** (sem trigger). PK por sequence (BR-03).
- Para o **DTO/zod** (`tabela-preco.schema.ts`): `descricao` **obrigatória** `min(1).max(60)` (BR-01); `valor_reajuste` `number().nonnegative().max(100).optional()` (**percentual**, BR-02 base); `reajuste`/`ativo` `enum(['S','N']).optional()`; **`superRefine`**: se `reajuste==='S'` exige `valor_reajuste>0` (BR-02 — mensagem `'Informe o valor do reajuste.'`). Tenant: conexão global → por tenant; operador do request context.

**Frontend (React — via `CadMaster`/engine, ADR-014):**
- Rota `/cadastro/precos` (lista) + `/cadastro/precos/:id_preco` (form). Componente `PrecosCadMaster.tsx`, título **"Tabela de Reajuste de Preço"**.
- Campos: `&Descrição` (`<Field>`, col-span 2) · `&Valor do Reajuste (%)` (`<NumberField>` `decimais=2 max=100 min=0 endAddon="%"`, **sem spinner** — paridade do `JvDBCalcEdit`, BR-02/§2) · `&Reajuste` + `&Ativo` (`<CheckboxField>`).
- `defaultValues={{ descricao:'', valor_reajuste:undefined, reajuste:'S', ativo:'S' }}` → paridade do `OnNewRecord` (BR-05; `valor_reajuste` nasce vazio/0).
- **UI condicional (BR-04):** `NumberField` de valor `disabled` quando `!reajusteAtivo` (`form.watch('reajuste')!=='S'`); ao desmarcar Reajuste, `form.setValue('valor_reajuste', 0)` — espelha `CkbReajusteClick` (desabilita **e** zera).
- Pesquisa: colunas `Código`/`Descrição`/`Valor (%)`.
- Mnemônicos `&` adicionados (melhoria consciente; legado não tinha — ADR-010 é piso).

**Decisões offline (PDV/Electron — ADR-008):** N/A direto — cadastro de tabela de reajuste roda na **retaguarda/nuvem**. **Sem replicação** (sem `REM_PRECO`), então não há delta de sync próprio a preservar. Se o percentual alimentar precificação que chega ao PDV, isso virá pelo recurso de **precificação/preço** (o `preco.schema.ts`, recurso distinto), não por esta entidade isolada.

---

## Paridade com o novo

A tela **já está implementada declarativamente** no app, espírito ADR-014 — uma `CrudConfig` + uma tela `CadMaster`:

- **Backend:** `/Library/Apollo/apps/api/src/modules/cadastro/preco.crud.ts` — `precoCrudConfig`:
  ```ts
  { tabela: 'preco', pk: 'id_preco', view: 'get_preco',
    colunas: ['descricao','valor_reajuste','reajuste','ativo'],
    rbacForm: 'FRMCADPRECO', softDelete: true, replica: false,
    colunasPesquisa: ['id_preco','descricao','valor_reajuste','reajuste','ativo'] }
  ```
  `createCrudController({ path: 'cadastro/precos', schema: tabelaPrecoSchema, updateSchema: atualizarTabelaPrecoSchema, ... })` herda do engine (auditoria, soft-delete, RBAC, view de listagem). ✅ `softDelete:true` (BR-06), `replica:false` (sem trigger) — fiel.
- **Schema:** `/Library/Apollo/packages/shared/src/schema/tabela-preco.schema.ts` — `descricao min(1).max(60)` (BR-01 ✅), `valor_reajuste number().nonnegative().max(100).optional()` (**percentual** ✅), `reajuste`/`ativo enum(['S','N']).optional()`, `superRefine` reajuste='S'⇒valor>0 (BR-02 ✅). Tipos prefixados `tabelaPreco*` para não colidir com `preco.schema.ts` (precificação) ✅.
- **Frontend:** `/Library/Apollo/apps/web/src/features/precos/PrecosCadMaster.tsx` — `<CadMaster titulo="Tabela de Reajuste de Preço" resourcePath="cadastro/precos" pk="id_preco" ...>`; `NumberField` percentual com `endAddon="%"` (✅ não-moeda), defaults `reajuste/ativo='S'` (BR-05 ✅), UI condicional `CkbReajusteClick` (BR-04 ✅).
- **Migração:** `/Library/Apollo/apps/api/migrations/011_preco.sql` — `seq_preco_id_preco` (BR-03 ✅), 12 colunas espelhando o Oracle com `valor_reajuste numeric(13,2)` comentado **"percentual 0–100, NÃO moeda"** (✅), defaults `reajuste/ativo='S'` (✅), `view get_preco` (expõe `indr`, não pré-filtra — divergência consciente equivalente em resultado, ✅ documentada), **seed** das 2 linhas reais (`PIZZARIA 10`, `TESTE 5.5`), e `permissoes` para `FRMCADPRECO`.

> 🟡 **Status de paridade: FIEL-POR-CONSTRUÇÃO + smokes verdes, não certificado em runtime do legado.** A implementação espelha os achados deste dossiê (percentual ≤100 não-moeda, descrição obrigatória, valor>0 quando reajuste='S', defaults de inclusão, UI condicional, soft-delete INDR+ATIVO, sem replicação, PK por generator). Smokes do novo passam (seed=2; POST `9.99` relido com precisão). **MAS não há golden de runtime do legado PRECO** rodando contra o novo — **só [Bancos](uCadBancos.md) tem golden certificado**. Logo PRECO **não pode** ser `paridade-verde`/`concluído` pelos critérios de [dossier-process.md](../dossier-process.md): falta a captura V$SQL e a 2ª revisão independente.

---

## Lacunas / pendências

1. **Golden de runtime de PRECO não capturado** — Q-WRITE (INSERT/UPDATE/soft-delete delta-based + carimbo) e a SQL final da pesquisa (Q2 com filtro/ordem) são `[inferido]` (herdados do motor de Bancos). Capturar via `V$SQL` exercitando a tela legada (criar+editar+excluir 1 preço; provar que a exclusão seta **ATIVO='N'** junto com INDR). **Bloqueia `paridade-verde`.**
2. **2ª revisão independente** pendente (etapa 2 do loop) — outro agente deve auditar dossiê + código contra `.pas`/`.dfm`/DM.
3. **Mnemônicos `&` adicionados** (`&Descrição`/`&Valor do Reajuste (%)`/`&Reajuste`/`&Ativo`) — ausentes no legado; melhoria consciente (ADR-010 é piso). Confirmar com produto.
4. **`get_preco` da migração expõe `INDR` e não pré-filtra**, enquanto a `GET_PRECO` real pré-filtra `INDR='I'` — resultado equivalente (engine aplica situação). Validar em runtime que o conjunto retornado bate (especialmente "todos/inativos").
5. **`HISTORICO_DINAMICO` e telemetria** (herdados do form-base, disparam em gravar/excluir **se ativos**) — não implementados no app. Decidir manter/descartar (mesma pendência de Marcas/Bancos).
6. **Carimbo de auditoria** (`USUCADASTRO`/`DTCADASTRO`/`USULTALTERACAO`/`DTULTIMALTERACAO`) — confirmar em runtime que `SetaOperadorAlteracao` roda igual em PRECO (esperado sim; colunas existem; sem replicação a reboque).
7. **Guarda de PK dupla** (form-base `GetID` + DM `BeforePost` `TDB.GetId`) — confirmar em runtime que **só um** valor do generator é consumido por inclusão (esperado: a guarda do DM é no-op porque o form-base já preencheu `ID_PRECO`). Sem isso, risco teórico de pulo de sequence.

## Ver também

- [dossier-template.md](../dossier-template.md) · [dossier-process.md](../dossier-process.md)
- [uCadMarcas.md](uCadMarcas.md) — herdeira "magra" (1 campo); PRECO é mais gorda (DM com lógica, validação própria, UI condicional) e tem **ATIVO** além de INDR no soft-delete.
- [uCadNCM.md](uCadNCM.md) — herdeira com chave natural/fiscal (contraste: PRECO é PK por generator, não-fiscal).
- [uCadBancos.md](uCadBancos.md) — o piloto (único com golden de runtime certificado).
- [../../03-legacy-analysis/recon/form-base-cadmaster.md](../../03-legacy-analysis/recon/form-base-cadmaster.md) — o contrato do `TfrmCadMaster` (engine CRUD) que esta tela herda.
- [../../03-legacy-analysis/dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md) — como fechar §4/§9 (capturar o runtime de PRECO).
- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — ADR-008/010/011/012/014.
