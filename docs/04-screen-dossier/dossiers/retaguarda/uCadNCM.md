# Dossiê — `frmCadNCM` (Cadastro de NCM)

| Campo | Valor |
|---|---|
| **Status** | **`rascunho` (recon estática + dicionário Oracle read-only)** — fontes `.pas`/`.dfm` lidas integralmente; estrutura/constraints/triggers/`GET_NCM` confirmadas contra homologação (`pinheirao@apollo`, read-only). **Não há golden de runtime capturado** (V$SQL não exercitado para esta tela). Paridade do novo é **fiel-por-construção** (engine declarativo), **não certificada** por harness. |
| **Autor / Revisor** | Analista de Legado (Claude) / *pendente — revisor independente ([../../08-agents/review-loop.md](../../08-agents/review-loop.md))* |
| **Versão do dossiê** | v0 (recon — chave natural / fiscal) |
| **Data** | 2026-06-25 |
| **Commit do legado analisado** | `/Library/SicomGit/retaguarda-master` (branch `*-master`, sem hash versionado) |

> **Por que esta tela importa (ênfase fiscal):** NCM é a **classificação fiscal** (Nomenclatura Comum do Mercosul / SH) que os produtos referenciam para determinar tributação. É **catálogo de referência** (11.215 linhas em homologação, base federal), com **vigência** (`VIGENCIA_INICIO`/`FIM`) — eixo direto da **reforma tributária** (NCMs entram/saem de vigência) e do cálculo de IPI. Diferentemente do piloto [uCadBancos](uCadBancos.md), esta tela tem **CHAVE NATURAL** (`CODIGO` digitado pelo operador, `tcManual`), 3 colunas **CLOB** (memo), datas de vigência, e **não tem replicação** (sem trigger `REM_NCM`) — três contrastes que mudam o desenho do alvo.
>
> ⚠️ **Limite desta versão:** feita por **leitura estática** de `.pas`/`.dfm` + **inspeção do dicionário Oracle** (read-only, `pinheirao@apollo`). O playbook exige **captura de runtime** (V$SQL) para fechar §4/§9 ([../../03-legacy-analysis/dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md)). O que não foi visto rodando está marcado `[estático]`/`[inferido]` e listado em [Lacunas](#lacunas--pendências-para-sair-de-rascunho).

---

## 1. Identidade

| Campo | Valor |
|---|---|
| **Form (`.pas` / `.dfm`)** | `retaguarda-master/fonte/Units/uCadNCM.pas` (112 linhas) + `uCadNCM.dfm` (284 linhas) `[.dfm]` |
| **Classe do form** | `TfrmCadNCM` — **herda `TfrmCadMaster`** (`uCadMaster.pas`, 1.806 linhas) via herança visual (`inherited frmCadNCM`) `[.dfm:L1]` |
| **Módulo de domínio** | `cadastro` (fiscal — classificação tributária; alimenta tributação de produtos e IPI) |
| **Função no negócio** | Cadastrar/editar a tabela NCM (código fiscal SH, descrição, categoria, IPI, **vigência**, unidade tributada). O operador digita o **código NCM** e a tela deriva o `NCMSH` (8 dígitos zero-padded). |
| **Frequência / criticidade** | **baixa** frequência (catálogo de referência, atualizado por carga/exceção). **Criticidade média-alta (fiscal):** o NCM cadastrado é referenciado por produtos no cálculo tributário; vigência conecta-se à reforma. Não é caminho de PDV interativo, mas é **insumo fiscal** que chega ao PDV pela carga inicial. |
| **Rota-alvo (web)** | `/cadastro/ncm` (lista) · `/cadastro/ncm/:codigo` (edição) — *proposta* |
| **Casca-alvo** | `browser` — tela de retaguarda/nuvem (ADR-001), sem device, sem tecla reservada crítica. (Electron só se entrar no pacote power-user.) |

---

## 2. UI — inventário de componentes (`.dfm` → React)

Herança visual de `TfrmCadMaster`: o `.dfm` herda cabeçalho (`pnlCabecalho` com `edtCodigo`+`btnPesquisa`+`DBNavigator1`), rodapé (`pnlRodapeMaster` com botões de ação), `stbHints` (status bar) e os ClientDataSets do form-base ([form-base-cadmaster.md](../../03-legacy-analysis/recon/form-base-cadmaster.md)). Abaixo, só os controles **próprios** desta tela, todos em `pnlGeral`, bind `DataSource = dtsPrincipal` (herdado → `cdsPrincipal`, que é `RDMCadNCM.cdsNCM`).

| Controle (`.dfm`) | Tipo VCL | Left,Top,W,H | Caption/label | DataField | → React (DS) | Nota de reflow |
|---|---|---|---|---|---|---|
| `edtNCMSH` | `TDBEdit` | 8,29,158,21 | `NCM SH` (`lbl1`) | `NCMSH` | `<Field>` (read-only/derivado) | linha 1, col 1 |
| `edtDtInicioVigencia` | `TJvDBDateEdit` | 172,29,101,21 | `Data início vigência` (`lbl3`) | `VIGENCIA_INICIO` | `<DateField>` | linha 1, col 2 · `DefaultToday=True`, `ShowNullDate=True` |
| `edtDtFimVigencia` | `TJvDBDateEdit` | 279,29,101,21 | `Data fim vigência` (`lbl4`) | `VIGENCIA_FIM` | `<DateField>` | linha 1, col 3 · `ShowNullDate=False` (nulo = vigência aberta) |
| `cbbUnidadeTributada` | `TJvDBComboBox` | 386,29,145,21 | `Unidade tributada` (`lbl5`) | `UN_TRIBUTADA` | `<Select>` (13 itens fixos) | linha 1, col 4 · enum Items/Values |
| `dbmmoDescricao` | `TDBMemo` | 8,68,701,58 | `Descricao` (`lblDescricao`) | `DESCRICAO` | `<TextArea>` *(obrigatório, CLOB)* | linha 2 (largo) |
| `dbmmoCategoria` | `TDBMemo` | 8,148,701,58 | `Categoria` (`lbl2`) | `CATEGORIA` | `<TextArea>` (CLOB) | linha 3 (largo) |
| `dbmmoObservacao` | `TDBMemo` | 8,229,701,35 | `Observação` (`lbl6`) | `OBSERVACAO` | `<TextArea>` (CLOB) | linha 4 (largo) |
| `edtCodigo` (herdado) | `TEdit` | (pnlCabecalho) | código/lookup PK | — (params, não bind) | `<Field>` do código | **`MaxLength=8`** `[.dfm:L277]` — chave natural digitada |

**`cbbUnidadeTributada` — enum fixo (Items → Values)** `[.dfm:L206-234]`:

| Item (label) | Value (gravado) | Item | Value |
|---|---|---|---|
| UNIDADE | `UN` | METRO | `METRO` |
| DUZIA | `DUZIA` | GRAMA | `G` |
| TONEL METR LIQUIDA | `TON` | METRO CUBICO | `M3` |
| METRO QUADRADO | `M2` | QUILOGRAMA | `KG` |
| QUILATE | `QUILAT` | MIL UNIDADES | `1000UN` |
| LITRO | `LT` | PARES | `PARES` |
| | | MEGAWATT HORA | `MWHORA` |

**Notas de reflow:** layout absoluto `Left/Top` → grid fluido (linha 1 com 4 controles curtos; 3 memos largos em linhas próprias) preservando ordem de leitura **e a taborder** (seção 8) — **não** copiar pixels. Os 3 `TDBMemo` (CLOB) viram `<TextArea>`; o combo vira `<Select>` com as 13 opções; os dois `TJvDBDateEdit` viram `<DateField>` (com semântica de **nulo = vigência aberta** no fim).

> **Achado (gaps de UI — fiscalmente relevantes):**
> 1. **`IPI`** existe na tabela (`VARCHAR2(3)`, nullable) e no dataset (`aqqNCMIPI`/`cdsNCMIPI`, `Size=3`), mas **não há controle de IPI no `.dfm`** — a tela legada **não permite editar IPI** por aqui. `[.dfm]` + `[uRDMCadNCM.dfm:L57-62]` + `[DB]`. Decidir no alvo (o novo **expôs** IPI — divergência, ver §10).
> 2. **`UN_TRIBUTADA_DESCRICAO`** (`VARCHAR2(50)`) existe na tabela e no dataset mas **não tem controle** (o combo grava só `UN_TRIBUTADA`). Provável preenchimento por carga/derivação. `[uRDMCadNCM.dfm:L79-84]`.
> 3. **`NCMSH` é editável no `.dfm`** (`edtNCMSH` bind `NCMSH`), porém em gravação é **sobrescrito** por `ConcatenaLeft(CODIGO,8,'0')` (§3/BR-02) — ou seja, o operador digita o **código** em `edtCodigo`, e `NCMSH` é **derivado**, não digitado de fato.

---

## 3. Eventos

Handlers próprios de `uCadNCM.pas`. O grosso do ciclo de vida é **herdado** de `TfrmCadMaster` (ver seção 7 + [form-base-cadmaster.md §3](../../03-legacy-analysis/recon/form-base-cadmaster.md)).

| Componente.Evento | `.pas` | O que faz (passo a passo) | Toca SQL? | Toca estado externo? | Vira (alvo) |
|---|---|---|---|---|---|
| `FormCreate` | `[.pas:L95]` | `inherited`; `RDMCadNCM := TRDMCadNCM.Create(nil)`; **`SetaDataset(edtDtInicioVigencia, RDMCadNCM.cdsNCM, 'CODIGO', 'NCM', tcManual)`** — wira o cds da tabela NCM, define PK=`CODIGO`, tabela=`NCM`, **tipo de chave = `tcManual` (digitada)** e foco inicial em `edtDtInicioVigencia` | indireto (prepara dataset) | cria datamodule; usa conn global | montagem do form + bind do recurso `/cadastro/ncm` com `pkGerada:false` |
| `btnAdicionarRegistroClick` | `[.pas:L48]` | `inherited` (cria o registro, ver §7) → **`NovoRegistro`** | indireto | — | "novo" no engine + defaults de vigência |
| `NovoRegistro` (privado) | `[.pas:L102]` | se `cdsPrincipal.State = dsInsert`: `DTCADASTRO := Now()`; **`VIGENCIA_INICIO := Now()`** (default hoje); **`VIGENCIA_FIM.Clear`** (vigência aberta) | — | — | defaults no DTO/create (data de cadastro server-side; vigência início = hoje; fim nulo) |
| `edtCodigoExit` | `[.pas:L82]` | `inherited` (o form-base resolve a chave: carrega se existe, prepara inclusão se não — ver §7) → **`NovoRegistro`** | sim (via `AbreDataset`) | — | `onBlur` no campo-código: GET por código; se 404, modo inclusão + defaults |
| `btnGravarClick` | `[.pas:L54]` | **(1)** se `dbmmoDescricao.Text=''` → `Mensagem('Informe a descrição do NCM!', tmAlerta)` + foco + `Exit` (bloqueia). **(2)** se `edtDtFimVigencia.Date>0` e `InicioVigencia > FimVigencia` → `Mensagem(...)` + foco + `Exit` (bloqueia). **(3)** carimba `USULTALTERACAO := DMPrincipal.Sessao.Usuario` e `DTULTIMALTERACAO := Now()`. **(4)** `NCMSH := ConcatenaLeft(CODIGO,8,'0')` (deriva o SH de 8 dígitos). **(5)** `ValorChavePrimaria := NCMSH`. **(6)** `inherited` (todo o pipeline de gravação do form-base: RBAC→obrigatórios→`ApplyUpdates`→histórico→carimbo→log) | sim (via `ApplyUpdates`) | sim (ver §6) | `POST`/`PUT /cadastro/ncm` + validações no DTO/service |
| `FormClose` | `[.pas:L88]` | `inherited`; `FreeAndNil(RDMCadNCM)` | — | libera datamodule | desmontagem/cleanup |

> Observação: ao contrário de uCadBancos (cujo `btnGravarClick` só convertia um inteiro), aqui o handler próprio **carrega regras**: validação de descrição obrigatória **antes** do form-base, validação de coerência de vigência, **derivação do NCMSH** e set de `ValorChavePrimaria`. "Migrar o que o sistema faz": a tela parece um CRUD simples, mas tem regra fiscal embutida.

---

## 4. Dados — TODA query

### Q1 — `aqqNCM` (leitura de 1 registro por código) — `[.dfm SQL.Strings]`
- **Origem:** `retaguarda-master/fonte/Units/uRDMCadNCM.dfm` — `TFDQuery aqqNCM`, `Connection = dmPrincipal.FDConexao` (global), via `dspNCM` (`TDataSetProvider`, `ResolveToDataSet=True`, **`UpdateMode = upWhereKeyOnly`**) → `cdsNCM` (`TClientDataSet`).
- **Quando dispara:** ao abrir/editar um NCM pelo código (via `SetaDataset`/`AbreDataset` do form-base; `edtCodigoExit`).
- **SQL base (Oracle, verbatim)** `[uRDMCadNCM.dfm:L7-22]`:
  ```sql
  SELECT CODIGO,
         NCMSH,
         CATEGORIA,
         DESCRICAO,
         IPI,
         VIGENCIA_INICIO,
         VIGENCIA_FIM,
         UN_TRIBUTADA,
         UN_TRIBUTADA_DESCRICAO,
         OBSERVACAO,
         USULTALTERACAO,
         DTULTIMALTERACAO,
         DTCADASTRO
  FROM NCM
  WHERE CODIGO = :CODIGO
  ```
- **Params:** `:CODIGO` (`ftInteger`, `ptInput`) — origem: `edtCodigo.Text` (digitado pelo operador / chave selecionada na pesquisa).
- **Fragmentos condicionais:** nenhum (estática pura). **Sem filtro de soft-delete** (NCM não tem `INDR`).
- **ProviderFlags (definem a DML gerada pelo provider):** `CODIGO` = `[pfInUpdate, pfInWhere, pfInKey]` (chave do WHERE); todas as demais colunas = `[pfInUpdate]`. `UpdateMode=upWhereKeyOnly` → o UPDATE/DELETE usa **só a PK** no WHERE.
- **Pipeline de gravação — `[inferido]` (provider delta-based, padrão do form-base; NÃO capturado em runtime aqui).** Pelo contrato do provider ([form-base-cadmaster.md §2](../../03-legacy-analysis/recon/form-base-cadmaster.md)) e por analogia com uCadBancos (capturado lá), espera-se DML **bindada, só das colunas tocadas**:
  ```sql
  -- INSERT (chave natural CODIGO vem do edtCodigo; NCMSH derivado; só campos preenchidos)
  insert into "NCM" ("CODIGO","NCMSH","DESCRICAO", ...campos preenchidos...) values (:1,:2,:3, ...)
  -- UPDATE (só colunas alteradas; WHERE pela PK)
  update "NCM" set "DESCRICAO" = :1, ... where "CODIGO" = :2
  -- DELETE (físico — sem INDR)
  delete from "NCM" where "CODIGO" = :1
  ```
  ⚠️ **Diferença-chave vs uCadBancos:** `CODIGO` **não** é gerado por sequence app-side (`GetID`). Em `tcManual`, o form-base faz `cdsPrincipal.FieldByName('CODIGO').Value := edtCodigo.Text` `[uCadMaster.pas:L1301]` — **o operador digita o código** e ele entra no INSERT. (Em `tcAutomatica`, viria de `dmPrincipal.GetID` `[uCadMaster.pas:L1297]`.)
- **Mutações:** leitura (Q1) + escrita (INSERT/UPDATE/DELETE via provider) em `NCM`.
- **Tabelas / triggers / sequences tocadas:**
  - `NCM` (CRUD). PK `PK_NCM (CODIGO)` `[DB confirmado]`.
  - **NENHUMA trigger** `[DB confirmado — `all_triggers` vazio para NCM]`. **Não há `REM_NCM`** → **NCM não replica** (contraste forte com `REM_BANCOS`). NCM é catálogo de referência. → No alvo: **sem outbox/sync** para esta entidade (`replica:false`).
  - **NENHUMA sequence** de PK (chave é digitada).
  - Auditoria: `USULTALTERACAO`/`DTULTIMALTERACAO` carimbados **no handler próprio** (`btnGravarClick` L73-74), e `DTCADASTRO` em `NovoRegistro` (L106). (O `SetaOperadorAlteracao` herdado pode recarimbar — confirmar em runtime; mas aqui o carimbo já é feito explicitamente na subclasse.)
- **SQL-alvo (Postgres, Kysely):** `select <colunas> from ncm where codigo = $1`; writes = `insert/update/delete` explícitos no repository. Oracle→PG ([ADR-011](../../00-orientation/canonical-decisions.md)): `NUMBER(10,0)`→`integer`; **`CLOB`→`text`** (DESCRICAO/CATEGORIA/OBSERVACAO); `VARCHAR2`→`varchar`; `DATE`→`date` (vigências); `TIMESTAMP(6)`→`timestamptz` (auditoria). Sem `NVL/ROWNUM/(+)/SYSDATE` nesta query.

### Q2 — Pesquisa / listagem (`btnPesquisa` → `frmPesquisa` sobre `GET_NCM`) — `[estático]` (view confirmada; SQL final do grid a capturar)
- **Origem:** form-base `TfrmCadMaster.btnPesquisaClick` `[uCadMaster.pas:L516]` abre `frmPesquisa` (`uPesquisa.pas`) sobre a **VIEW `GET_NCM`** (não a tabela crua).
- **View `GET_NCM` — ✅ confirmada verbatim contra homologação (`pinheirao@apollo`):**
  ```sql
  SELECT CODIGO,
         CAST(DESCRICAO AS VARCHAR(500)) AS DESCRICAO,
         NCMSH,
         TRUNC(VIGENCIA_INICIO) VIGENCIA_INICIO,
         TRUNC(VIGENCIA_FIM)    VIGENCIA_FIM
  FROM NCM
  ```
  **Achados da view (fiscalmente úteis):**
  - **`CAST(DESCRICAO AS VARCHAR(500))`** — a pesquisa **trunca o CLOB** a 500 chars (CLOB não entra cru no grid de pesquisa). No alvo, a listagem projeta `descricao` como texto curto (≤500); o registro completo (CLOB inteiro) vem só no GET por id.
  - **`TRUNC(VIGENCIA_INICIO/FIM)`** — remove a parte de hora das datas (vigência é por **dia**). No alvo, `date` puro (sem hora) já equivale.
  - Projeta **5 colunas** (CODIGO, DESCRICAO, NCMSH, VIGENCIA_INICIO, VIGENCIA_FIM). **Omite** CATEGORIA, IPI, UN_TRIBUTADA, OBSERVACAO e auditoria. **Sem `INDR`/filtro de soft-delete.**
- **SQL final do grid `[inferido — capturar em runtime]`:** por analogia com uCadBancos, o `frmPesquisa` faz `select FORM from TABELA_CADASTRO where TABELA='GET_NCM'` e depois `select Cast('F'..)Selecionar, Cast('T'..)Sel, GET_NCM.* from GET_NCM` + `where`/`order` conforme o usuário filtra.
- **Alvo:** `GET /cadastro/ncm?filtro=...` (lista paginada sobre o equivalente da view; pesquisa por `codigo`/`ncmsh`/`descricao`).

> **Regra de ouro:** Q1 (SQL semente) e a definição de `GET_NCM` são **confiáveis** (estática + dicionário). O **pipeline de escrita** (provider) e a **SQL final da pesquisa** são `[inferido]` — **não declarar paridade** sem captura de runtime (V$SQL), como foi feito em uCadBancos.

---

## 5. Regras de negócio

| ID | Regra | Gatilho | Lógica (verbatim do legado) | *Porquê* | Procedência |
|---|---|---|---|---|---|
| BR-01 | **Chave natural digitada** (`tcManual`) | inclusão | `SetaDataset(..., 'CODIGO', 'NCM', tcManual)`; no `Inserir`: se `edtCodigo.Text=''` → erro `'O código deve ser informado'` + `Abort`; senão `cdsPrincipal.Append` e `CODIGO := edtCodigo.Text` | O código NCM **é** o dado fiscal (catálogo federal SH), não um id artificial — tem de ser **digitado**, nunca gerado por sequence. `MaxLength=8`. | `[.pas:L99]` + `[uCadMaster.pas:L1230,L1277-1290,L1300-1301]` + `[.dfm:L277]` |
| BR-02 | **Derivação do `NCMSH`** (zero-pad 8) | ao gravar | `NCMSH := ConcatenaLeft(CODIGO, 8, '0')` — left-pad com zeros até 8 dígitos | O SH oficial tem 8 dígitos; códigos curtos são normalizados (homologação: 11.202 linhas com 8 chars, 13 com 7 — dados legados pré-padding). `NCMSH` é `NOT NULL`. | `[.pas:L76]` + `[DB: length(NCMSH)]` |
| BR-03 | **`ValorChavePrimaria := NCMSH`** | ao gravar | após derivar, `ValorChavePrimaria := NCMSH` (sobrescreve o default; em `tcManual` o form-base **não** seta `ValorChavePrimaria`) | controla o valor de retorno da pesquisa / re-posicionamento pós-gravação pelo `NCMSH` | `[.pas:L77]` + `[uCadMaster.pas:L1300-1301]` (ramo tcManual não seta) |
| BR-04 | **Descrição obrigatória** (app-side) | ao gravar | se `dbmmoDescricao.Text=''` → `Mensagem('Informe a descrição do NCM!', tmAlerta)` + foco + `Exit` (bloqueia **antes** do form-base) | integridade do catálogo; `DESCRICAO` é `NOT NULL` no DB (backstop) | `[.pas:L56-61]` + `[DB NOT NULL]` |
| BR-05 | **Coerência de vigência** | ao gravar | se `FimVigencia>0` e `InicioVigencia > FimVigencia` → `Mensagem('A data fim da vigência não pode ser menor que a data de início...')` + foco + `Exit` | vigência é janela temporal fiscal; fim antes do início é inconsistente. Fim **nulo** = vigência **aberta** (permitido). | `[.pas:L63-71]` |
| BR-06 | **Defaults de inclusão** | novo registro | `DTCADASTRO := Now()`; `VIGENCIA_INICIO := Now()`; `VIGENCIA_FIM.Clear` (nulo) | NCM novo vale a partir de hoje, sem prazo final por padrão | `[.pas:L102-110]` |
| BR-07 | **Carimbo de operador/alteração** | ao gravar | `USULTALTERACAO := DMPrincipal.Sessao.Usuario`; `DTULTIMALTERACAO := Now()` | autoria/auditoria | `[.pas:L73-74]` |
| BR-08 | **Obrigatórios do dataset** (form-base) | ao gravar | `ValidaObrigatorios(cdsPrincipal)` → `Abort`. `Required=True` em `CODIGO`, `DESCRICAO`, `NCMSH` | integridade (espelha NOT NULL do DB) | `[uRDMCadNCM.dfm: Required]` + `[uCadMaster.pas:L446]` + `[DB NOT NULL: CODIGO/DESCRICAO/NCMSH]` |
| BR-09 | **Sem soft-delete** | ao excluir | NCM **não** tem `INDR` → exclusão **física** (DELETE), conforme convenção do form-base | catálogo de referência; sem necessidade de tombstone | `[DB: sem coluna INDR]` + `[.pas uCadMaster cabeçalho/§3]` |
| BR-10 | **Unidade tributada = enum fixo** | digitação | `UN_TRIBUTADA` aceita 1 de 13 valores (`UN`,`DUZIA`,`TON`,`M2`,`QUILAT`,`LT`,`METRO`,`G`,`M3`,`KG`,`1000UN`,`PARES`,`MWHORA`) | unidades de medida tributárias padronizadas (SH/Receita) | `[.dfm:L206-234]` |

> **Não há cálculo monetário** nesta tela. As regras fiscais são de **classificação e vigência**, não de alíquota — o cálculo de tributo vive em outro módulo (DET_ALIQUOTA / motor fiscal), que **referencia o NCM por código** (ver §6). O *porquê* de `IPI`/`CATEGORIA`/`UN_TRIBUTADA` é fiscal (parâmetros de tributação do produto classificado).

---

## 6. Efeitos colaterais + estado externo

> A seção que salva da armadilha de acoplamento ([../../03-legacy-analysis/hidden-coupling-traps.md](../../03-legacy-analysis/hidden-coupling-traps.md)).

| Item | Tipo (lê/grava) | Alvo | Quem setou / quem consome | Mapeamento alvo |
|---|---|---|---|---|
| `dmPrincipal.FDConexao` | usa | conexão Oracle **global** | datamodule principal (boot) | conexão **por tenant** request-scoped |
| `DMPrincipal.Sessao.Usuario` | lê | operador logado | login | usuário no request context (fail-closed) |
| `dmPrincipal.PossuiAcessoForm('frmCadNCM', ...)` | lê | RBAC (form-base) | tabela de permissões | guard/policy por rota+ação (`rbacForm:'FRMCADNCM'`) |
| `HISTORICO_DINAMICO` | grava (indireto) | histórico genérico | `SetaHistorico_Dinamico` no `btnGravarClick` herdado | audit log / interceptor |
| `USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO` | grava | colunas da própria `NCM` | carimbo na subclasse (`btnGravarClick`/`NovoRegistro`) + `SetaOperadorAlteracao` herdado | colunas de auditoria no service |
| `MENUEXPRESS` | grava (provável) | telemetria de uso | ao abrir a tela (padrão do form-base): `ACESSOS+1 WHERE FORMULARIO='FRMCADNCM'` | métrica de uso (opcional no alvo) |
| **replicação `REM_NCM`** | **N/A — NÃO EXISTE** | — | — | **sem outbox/sync** (`replica:false`) |
| `NCM` (catálogo) — consumido por | (saída lógica) | produtos / motor fiscal | quem classifica produto referencia o **código NCM** (por valor, **não FK**) | NCM é tabela de referência da carga inicial fiscal |

- **Conexão/transação:** usa a conexão **global** do `dmPrincipal`; no alvo, transação **escopada** ao caso de uso (gravação do NCM numa só transação — sem outbox, pois não há replicação).
- **Ordem de abertura assumida:** presume login feito (operador/permissões em `dmPrincipal`).
- **Acoplamento fiscal de SAÍDA (o mais importante aqui):** a tela **não** dispara replicação, mas o **dado** que ela grava (código NCM, IPI, unidade tributada, **vigência**) é **insumo fiscal** referenciado por produtos no cálculo de tributo. Confirmado no dicionário: **não existe FK do `PRODUTO`/`DET_ALIQUOTA` para `NCM.CODIGO`** — a ligação é **por valor (o código NCM como string)**, não enforced pelo banco. `DET_ALIQUOTA` é uma matriz separada (chave `ALIQUOTA`/`UF`/`CST`), não chaveada por NCM. → No alvo: o NCM e sua **vigência** entram na **carga inicial fiscal** do edge/PDV (ADR-001/008); paridade fiscal não é cálculo *nesta* tela, mas a **fidelidade do catálogo + vigência** que o motor consome.

> **Contraste-chave com o piloto:** uCadBancos tinha replicação `REM_BANCOS` com fan-out por terminal (15 linhas/operação). **NCM não tem nada disso** — é catálogo. O risco fiscal aqui não é o efeito-fantasma de trigger; é **derivação do NCMSH** (BR-02), **vigência** (BR-05/06) e **classificação correta** (o código digitado).

---

## 7. Dependências

| Dependência | Tipo | Como é usada | Vira (alvo) |
|---|---|---|---|
| `TfrmCadMaster` (`uCadMaster.pas`) | **herança** | todo o CRUD: inserir/editar/excluir/pesquisar/navegar, RBAC, obrigatórios, histórico, log, teclado, **lógica `tcManual`/`tcAutomatica` da PK** | **engine CRUD declarativo** (o pilar do alvo; `/ds-create-crud`, [ADR-014](../../00-orientation/canonical-decisions.md)) |
| `TRDMCadNCM` (`uRDMCadNCM`) | datamodule (**ativo**) | `aqqNCM`→`dspNCM`→`cdsNCM` da tabela NCM (13 colunas; 3 `ftOraClob`) | `NcmRepository` (Kysely) sem estado |
| `udmPrincipal` (`dmPrincipal`/`DMPrincipal`) | datamodule global | conexão, sessão (operador), RBAC, histórico | tenant context + providers |
| `ConcatenaLeft` (`FuncoesApollo`) | função util | left-pad zero (deriva NCMSH 8 dígitos; usada também em SPED/SINTEGRA/NFCe) | helper `padStart(8,'0')` no service |
| `FuncoesApollo` | unit util | `Mensagem(...)`, `SetaFoco`, `SetaDataset`, helpers | utils/serviços compartilhados |
| `uPesquisa` (`frmPesquisa`) + view `GET_NCM` | form modal + view | pesquisa/listagem | listagem/filtro paginado do recurso |
| FastReport (`frx*`), JVCL (`Jv*`) | libs | export/UI (combo, date edit) | export server-side / DS |

> **Datamodule duplicado (legado-do-legado):** existe `uDMCadNCM.pas` (`TDMCadNCM`, em `Units/` e `DmOld/`) com **só 3 campos** e `DESCRICAO` como `TStringField(150)` (não CLOB). **A tela ativa usa `uRDMCadNCM`** (`TRDMCadNCM`, criado no `FormCreate` L98), com as 13 colunas e os memos `ftOraClob`. **Ignorar `uDMCadNCM`** na migração (morto). · **`uCadGeneroNCM`/`udmCadGeneroNCM`** (gênero NCM, tabela `GENERO_NCM` confirmada no DB) e **`uAtualizaNCM`** (ferramenta de **re-classificação em massa** do NCM de produtos a partir do XML da nota) são **telas separadas** — fora deste dossiê.

---

## 8. TabOrder + mapa de atalhos/mnemônicos

**TabOrder (campos próprios, sequência exata `[.dfm]`):**

| Ordem | Controle | Campo | Tipo | Nota |
|---|---|---|---|---|
| 0 | `edtNCMSH` | NCMSH | `TDBEdit` | foco inicial é `edtDtInicioVigencia` (via `SetaDataset` no FormCreate); a TabOrder do `.dfm` começa em NCMSH |
| 1 | `edtDtInicioVigencia` | VIGENCIA_INICIO | `TJvDBDateEdit` | `DefaultToday=True` |
| 2 | `edtDtFimVigencia` | VIGENCIA_FIM | `TJvDBDateEdit` | `ShowNullDate=False` (nulo=aberta) |
| 3 | `cbbUnidadeTributada` | UN_TRIBUTADA | `TJvDBComboBox` | enum 13 valores |
| 4 | `dbmmoDescricao` | DESCRICAO | `TDBMemo` (CLOB) | obrigatório |
| 5 | `dbmmoCategoria` | CATEGORIA | `TDBMemo` (CLOB) | |
| 6 | `dbmmoObservacao` | OBSERVACAO | `TDBMemo` (CLOB) | |

> Antes destes, o foco real é o **código** (`edtCodigo`, herdado, `MaxLength=8`) — onde o operador **digita a chave natural** (BR-01). A **ordem visual** (linha 1 = NCMSH/datas/unidade; linhas 2-4 = memos) e a **taborder** coincidem aqui. Replicar a taborder exata (ADR-010).

**Mnemônicos `&` (Alt+letra):** **nenhum nos labels desta tela** — captions sem `&` (`NCM SH`, `Descricao`, `Categoria`, `Data início vigência`, `Data fim vigência`, `Unidade tributada`, `Observação`). Os mnemônicos vivem nos **botões herdados** do rodapé ([form-base-cadmaster.md §4](../../03-legacy-analysis/recon/form-base-cadmaster.md)): `&Gravar` (Alt+G), `&Editar` (Alt+E), `E&xcluir` (Alt+X), `&Adicionar` (Alt+A), `&Sair`/`&Cancelar` (Alt+S/C), `&Outros` (Alt+O), `Ati&vo [F6]`. *(O novo app re-introduziu mnemônicos próprios nos labels — divergência cosmética, ver §10.)*

**Atalhos (F-keys/Enter/Esc) — herdados do form-base** ([form-base-cadmaster.md §4](../../03-legacy-analysis/recon/form-base-cadmaster.md)): **F6** cicla filtro ativo (sem efeito em NCM, que não tem INDR/ATIVO), **Alt+O** abre "Outros", **←/→** registro anterior/próximo e **↑/↓** primeiro/último (em `edtCodigo`), **Enter** em `edtCodigo` carrega pelo código (dispara `edtCodigoExit`→`NovoRegistro`), **Esc** protegida durante edição, `edtCodigo` só aceita dígitos (PK inteira) com `MaxLength=8`.

---

## 9. Casos de teste (golden) — capturados do legado

> ⚠️ **NENHUM golden de runtime capturado nesta passada** — esta seção lista os casos **a capturar** (V$SQL ligado + exercício da tela em homologação, mesma técnica de uCadBancos: [runtime-capture-uCadBancos.md](../../03-legacy-analysis/recon/runtime-capture-uCadBancos.md)). Cada caminho de §4/§5 precisa de ≥1 caso. Os valores "esperados" abaixo são `[inferido]` da leitura estática + dicionário, **não** régua de paridade certificada.

| ID | Cobre (BR/Q) | Input (estado + campos) | Ação | Output esperado `[inferido]` | SQL a capturar |
|---|---|---|---|---|---|
| G-01 | Q1 leitura | abrir CODIGO existente (ex.: 34021300) | carregar | registro com NCMSH='34021300', DESCRICAO (CLOB), IPI='5', UN='KG', VIGENCIA_INICIO=2016-01-01, FIM=null | `SELECT ... FROM NCM WHERE CODIGO=:CODIGO` |
| G-02 | BR-01+BR-02, INSERT | CODIGO digitado (ex.: 1234567), descrição preenchida | gravar novo | INSERT com `CODIGO=1234567`, **`NCMSH='01234567'`** (zero-pad 8) | `insert into "NCM" (...)` (provider delta) |
| G-03 | BR-04 (descrição vazia) | descrição em branco | gravar | **bloqueado** `'Informe a descrição do NCM!'`, zero DML | nenhuma SQL emitida |
| G-04 | BR-05 (vigência incoerente) | início > fim | gravar | **bloqueado** `'A data fim... não pode ser menor...'`, zero DML | nenhuma SQL emitida |
| G-05 | BR-06 (defaults) | adicionar registro | novo | `VIGENCIA_INICIO=hoje`, `VIGENCIA_FIM=null`, `DTCADASTRO=hoje` | — (estado do cds) |
| G-06 | UPDATE (delta) | editar DESCRICAO de um NCM | gravar | `update "NCM" set "DESCRICAO"=:1, "USULTALTERACAO"=..., "DTULTIMALTERACAO"=... where "CODIGO"=:n` | provider UPDATE |
| G-07 | BR-09 (hard-delete) | excluir NCM sem dependentes | excluir | `delete from "NCM" where "CODIGO"=:1` (físico, sem soft-delete) | provider DELETE |
| G-08 | Q2 pesquisa | abrir pesquisa | pesquisar | grid sobre `GET_NCM` (DESCRICAO truncada 500, vigências TRUNC) | `select FORM from TABELA_CADASTRO where TABELA='GET_NCM'` → `select ...,GET_NCM.* from GET_NCM` |
| G-09 | replicação (negativo) | gravar/excluir | qualquer | **zero linhas** em `REMESSA_SERVER` (NCM não replica) | confirmar `REMESSA_SERVER` sem evento NCM |
| G-10 | BR-10 (enum) | selecionar unidade | gravar | `UN_TRIBUTADA` ∈ {UN,DUZIA,TON,...,MWHORA} | — |

---

## 10. Alvo (especificação de implementação)

**Backend (NestJS):**
- Módulo: `cadastro/ncm`.
- Endpoints:
  | Método+rota | Origem | DTO (zod) | Mutação? |
  |---|---|---|---|
  | `GET /cadastro/ncm` | Q2 | `NcmFilterDto` | leitura |
  | `GET /cadastro/ncm/:codigo` | Q1 | — | leitura |
  | `POST /cadastro/ncm` | btnGravar (insert) | `NcmUpsertDto` | escrita (**sem outbox** — `replica:false`) |
  | `PUT /cadastro/ncm/:codigo` | btnGravar (update) | `NcmUpsertDto` | escrita |
  | `DELETE /cadastro/ncm/:codigo` | btnExcluir | — | escrita (hard-delete) |
- Para o **service**: RBAC (`rbacForm:'FRMCADNCM'`) via guard; **derivação de `NCMSH = codigo.padStart(8,'0')`** (BR-02) server-side; carimbo de operador/data (BR-07); `DTCADASTRO`/vigência default na criação (BR-06); **transação escopada sem outbox** (não há `REM_NCM`).
- Para o **DTO/zod**: `codigo` obrigatório e numérico (chave natural, BR-01); `descricao` obrigatória (BR-04); coerência de vigência início≤fim quando fim presente (BR-05); `un_tributada` ∈ enum de 13 (BR-10).
- Tenant: conexão global → conexão por tenant; operador do request context (fail-closed, **sem default**).

**Frontend (React — via o pilar `<CadMaster>` / `/ds-create-crud`, ADR-014):**
- Rota `/cadastro/ncm` (lista) + `/cadastro/ncm/:codigo` (form); campos/ordem = §2 + taborder = §8.
- Chave natural: **`pkGerada={false}`** (operador digita o código).
- Palette: `<Field>` (NCMSH), `<DateField>×2` (vigências), `<Select>` (un_tributada, 13 opções), `<TextArea>×3` (DESCRICAO/CATEGORIA/OBSERVACAO CLOB).

**Decisões offline (PDV/Electron):** tela roda na **retaguarda/nuvem**. Mas o **catálogo NCM + vigência** é **insumo fiscal** da carga inicial do edge/PDV (ADR-001/008): o motor fiscal offline classifica produtos pelo código NCM. Contrato backward-compatible (ADR-009).

---

### Paridade com o novo (estado atual da implementação)

Implementado via **engine CRUD declarativo** (não manual), espelhando o contrato do form-base:

- **Backend:** `/Library/Apollo/apps/api/src/modules/cadastro/ncm.crud.ts` — `CrudConfig` declarativo: `tabela:'ncm'`, `pk:'codigo'`, **`pkGerada:false`** (chave natural — o create insere o `codigo` do DTO, não gera sequence), `view:'get_ncm'`, `replica:false` (sem `REM_NCM`), **sem `softDelete` → hard-delete** (NCM não tem `INDR`), `rbacForm:'FRMCADNCM'`, `colunasPesquisa:['codigo','ncmsh','descricao']`. Controller via `createCrudController` + schemas `ncmSchema`/`atualizarNcmSchema` (`@apollo/shared`).
- **Frontend:** `/Library/Apollo/apps/web/src/features/ncm/NcmCadMaster.tsx` — pilar `<CadMaster>` com `pkGerada={false}`, `<DateField>` para as duas vigências (Controller RHF), `<TextArea>` para descrição/observação, `<Field>` para NCMSH e IPI; `colunasPesquisa` codigo/ncmsh/descricao.
- **Veredito:** **fiel-por-construção** (reusa o engine que o piloto certificou), **sem golden de runtime certificado** para NCM. Status = `rascunho`.

**Divergências legado × novo a resolver (entram nas Lacunas):**
1. **`NCMSH` digitado vs derivado:** o legado **deriva** `NCMSH=ConcatenaLeft(CODIGO,8,'0')` na gravação (operador digita só o `CODIGO`); o novo expõe `<Field>` "NCM (formatado)" como **campo editável** (`ncmsh` no DTO) e **não deriva** de `codigo`. Risco fiscal de divergência — alinhar: derivar `NCMSH` no service a partir de `codigo` (BR-02), `NCMSH` não deve ser entrada livre.
2. **IPI exposto no novo, ausente no legado:** a tela legada **não tem** controle de IPI (`.dfm`); o novo adicionou `<Field>` "&IPI". Decidir (expor é melhora funcional, mas não é paridade estrita).
3. **`CATEGORIA` (CLOB) omitida no novo:** o legado tem `dbmmoCategoria`; o `NcmCadMaster.tsx` **não** renderiza CATEGORIA (e `ncm.crud.ts` não a lista em `colunas`). Reintroduzir para paridade de dados.
4. **`UN_TRIBUTADA` (combo 13 valores) ausente no novo:** o form novo não tem o `<Select>` de unidade tributada. Reintroduzir (BR-10).
5. **Mnemônicos:** o novo introduziu `&` nos labels (`&NCM`, `&Descrição`, `&IPI`, `&Observação`, `Vigência &Início/&Fim`); o legado **não** tem mnemônicos nesses labels (só nos botões herdados). Divergência cosmética de teclado — alinhar com ADR-010 (replicar idêntico).

---

## Lacunas — pendências (para sair de `rascunho`)

**✅ Validado contra homologação (`pinheirao@apollo`, read-only, 2026-06-25):**
- Estrutura de `NCM` (13 colunas): `CODIGO` NUMBER(10,0) PK (`PK_NCM`), `NCMSH` VARCHAR2(20) NOT NULL, **`CATEGORIA`/`DESCRICAO`/`OBSERVACAO` = CLOB** (DESCRICAO NOT NULL), `IPI` VARCHAR2(3), `VIGENCIA_INICIO`/`FIM` DATE, `UN_TRIBUTADA` VARCHAR2(10), `UN_TRIBUTADA_DESCRICAO` VARCHAR2(50), auditoria TIMESTAMP(6).
- NOT NULL (constraints): `CODIGO`, `NCMSH`, `DESCRICAO`.
- **Sem trigger** em NCM (sem `REM_NCM` → **não replica**).
- **`GET_NCM`** verbatim (`CAST(DESCRICAO AS VARCHAR(500))` + `TRUNC` das vigências, 5 colunas).
- **Sem FK** apontando para `NCM.CODIGO` (coupling fiscal por valor, não enforced). `GENERO_NCM` existe (tela separada). 11.215 linhas; `length(NCMSH)`: 11.202×8, 13×7 (confirma zero-pad 8).

**✅ Fechado por leitura estática (`.pas`/`.dfm`):** `tcManual` (chave natural digitada) vs `tcAutomatica` (sequence `GetID`) `[uCadMaster.pas:L44,L1230,L1277-1301]`; derivação NCMSH (BR-02); validações de descrição/vigência (BR-04/05); defaults (BR-06); carimbo (BR-07); enum de unidade (BR-10); mapa de teclado do form-base.

**🔲 Pendente de captura de runtime (V$SQL) — obrigatório para fechar §4/§9:**
- DML real do provider (INSERT/UPDATE/DELETE delta-based) confirmando que `CODIGO` digitado entra no INSERT e `NCMSH` derivado é gravado.
- SQL final da pesquisa (`TABELA_CADASTRO`→`GET_NCM` + where/order dinâmicos).
- Confirmar **zero replicação** em `REMESSA_SERVER` (G-09) e telemetria `MENUEXPRESS`.
- Golden negativos (G-03 descrição vazia, G-04 vigência incoerente) = bloqueio com zero DML.

**🔲 Divergências legado×novo (ver Paridade com o novo):** NCMSH derivado vs digitado; IPI exposto; CATEGORIA/UN_TRIBUTADA omitidas no novo; mnemônicos.

**🔲 Processo:** revisão independente ([../../08-agents/review-loop.md](../../08-agents/review-loop.md)) + paridade verde no harness exercitando o caminho real ([../../06-testing-quality/parity-harness.md](../../06-testing-quality/parity-harness.md)).

## Ver também

- [dossier-template.md](../dossier-template.md) · [dossier-process.md](../dossier-process.md)
- [uCadBancos.md](uCadBancos.md) — piloto/referência-ouro (contraste: chave por sequence + replicação).
- [../../03-legacy-analysis/recon/form-base-cadmaster.md](../../03-legacy-analysis/recon/form-base-cadmaster.md) — o contrato `TfrmCadMaster` (engine CRUD), `tcManual`/`tcAutomatica`, teclado.
- [../../03-legacy-analysis/dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md) — como fechar §4/§9 (runtime).
- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — ADR-008/010/011/012/014.
</content>
</invoke>
