# Dossiê — `frmCadOperacoesConta` (Cadastro de Operações de Conta)

| Campo | Valor |
|---|---|
| **Status** | **`rascunho` (recon estática + dicionário Oracle read-only)** — leitura fiel do `.pas`/`.dfm`/datamodule + estrutura de `OPERACOES_CONTA` confirmada contra homologação (`pinheirao@dbhomologacao`). Implementação Fase 0 existe (engine declarativo) e é **fiel-por-construção**, **sem golden de runtime certificado** (≠ piloto Bancos, que tem captura V$SQL). |
| **Autor / Revisor** | agente Analista de Legado (Claude) / *pendente — revisor independente ([../../08-agents/review-loop.md](../../08-agents/review-loop.md))* |
| **Versão do dossiê** | v0 (recon — 2ª tela herdeira do form-base) |
| **Data** | 2026-06-25 |
| **Commit do legado analisado** | `/Library/SicomGit/retaguarda-master` (branch `*-master`, sem hash versionado) |

> **Por que esta tela:** é a **2ª herdeira** documentada de `TfrmCadMaster` (depois do piloto [uCadBancos](uCadBancos.md)). Valor de recon: prova a **generalização** do contrato do form-base num caso **ainda mais magro** que Bancos — só 2 campos próprios — mas que introduz um **campo de lista fixa** (`TIPO`, combo `TJvDBComboBox` com mapa `Values`/`Items`) e **duas divergências deliberadas** vs. Bancos: (a) `DESCRICAO` **sem `CharCase`** (não força maiúsculas) e (b) a tabela **não tem trigger de replicação** (`REM_*`). Confirmadas contra o banco — ver [Dados](#4-dados) e [Efeitos](#6-efeitos-colaterais--estado-externo).
>
> ⚠️ **Limite desta versão:** recon por leitura estática de `.pas`/`.dfm` + inspeção do dicionário Oracle (read-only). O playbook exige **captura de runtime** para fechar as seções 4 e 9 ([../../03-legacy-analysis/dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md)). O **pipeline de escrita** (provider/`ApplyUpdates`) e a **pesquisa com filtro** estão marcados `[estático]`/`[inferido]` — herdam o comportamento já capturado em Bancos (mesmo form-base), mas **não foram vistos rodando** para esta tela.

---

## 1. Identidade

| Campo | Valor |
|---|---|
| **Form (`.pas` / `.dfm`)** | `retaguarda-master/fonte/Units/uCadOperacoesConta.pas` (49 linhas) + `uCadOperacoesConta.dfm` (114 linhas) `[.dfm]` |
| **Classe do form** | `TfrmCadOperacoesConta` — **herda `TfrmCadMaster`** (`uCadMaster.pas`, 1.806 linhas) via herança visual (`inherited frmCadOperacoesConta`) `[.dfm:L1]`, `[.pas:L13]` |
| **Módulo de domínio** | `cadastro` (financeiro — alimenta lançamentos de caixa / movimento de conta) |
| **Função no negócio** | CRUD do cadastro de **operações de conta**: uma descrição livre + um **tipo** (`C`=Crédito / `D`=Débito) que classifica se a operação **entra** ou **sai** de uma conta. Usado por telas de tesouraria/caixa/movimento de contas (`uLanCaixa`, `uMovCaixa`, `uCadMovContasBancarias`, baixas a pagar/receber — todas referenciam `OPERACOES_CONTA`, ver [Dependências](#7-dependências)). |
| **Frequência / criticidade** | **baixa** frequência (cadastro estável — homolog tem **1 linha**: `TRANSFERENCIA`/`C` `[runtime DB]`), **baixa** criticidade. Não é caminho de PDV. **Não toca fiscal** (sem cálculo, sem alíquota). |
| **Rota-alvo (web)** | `/cadastro/operacoes-conta` (lista) · `/cadastro/operacoes-conta/:cod` (edição) — **já implementada** (ver [Paridade com o novo](#paridade-com-o-novo)). |
| **Casca-alvo** | `browser` — tela de retaguarda, sem device, sem teclas reservadas críticas. (Electron só se entrar no pacote power-user; não há requisito próprio.) |

---

## 2. UI — inventário de componentes (`.dfm` → React)

Herança visual: o `.dfm` herda do form-base (`imgCabecalho`, `lblTitulo`, `pnlGeral`, `pnlCabecalho` com `edtCodigo`+`btnPesquisa`+`DBNavigator1`, `pnlRodapeMaster` com os botões de ação, `stbHints`, os ClientDataSets herdados). Abaixo, só os controles **próprios** desta tela (todos em `pnlGeral`, bind `DataSource = dtsPrincipal` herdado → `cdsPrincipal`/`cdsOperacoesConta`). Caption do título: `'Operações da conta'` `[.dfm:L17]`.

| Controle (`.dfm`) | Tipo VCL | Left,Top,W,H | Caption/label | DataField | → React (DS) | Nota de reflow |
|---|---|---|---|---|---|---|
| `lblDESCRICAO` | `TLabel` | 8,2,46,13 | `Descrição` (sem `&`) · `FocusControl=edtDESCRICAO` | — | `<label>` do `<Field>` | linha 1, label |
| `edtDESCRICAO` | `TDBEdit` | 8,18,375,21 | Hint `Descrição de identificação da conta` | `DESCRICAO` | `<Field>` *(obrigatório)* | linha 1 (largo, 375px) |
| `lblTIPO` | `TLabel` | 8,42,20,13 | `Tipo` (sem `&`) · `FocusControl=cbbTIPO` | — | `<label>` do `<Select>` | linha 2, label |
| `cbbTIPO` | `TJvDBComboBox` | 8,58,89,21 | Hint `Tipo de operação realizada pela conta` | `TIPO` | `<Select>` / `<SelectField>` *(obrigatório, lista fixa)* | linha 2, col 1 |

**O combo `TIPO` (o achado de UI desta tela)** `[.dfm:L94-112]`:
- `TJvDBComboBox` data-bound a `TIPO` (CHAR(1)), com **`Style` de lista fechada** (combo, não edit livre).
- **Mapa `Items` ↔ `Values` (verbatim do `.dfm`):**

  | Posição | `Items.Strings` (mostrado) | `Values.Strings` (gravado) |
  |---|---|---|
  | 0 | `1 - CREDITO` | `C` |
  | 1 | `2 - DEBITO` | `D` |

  Ou seja: o operador vê `"1 - CREDITO"`/`"2 - DEBITO"`, mas o banco grava **`C`/`D`** (CHAR(1)). O prefixo `"1 -"`/`"2 -"` é só rótulo de exibição — **não** é o valor persistido. `[.dfm:L104-111]`
- `UpdateFieldImmediatelly = True` `[.dfm:L108]` — a seleção atualiza o campo do dataset **na hora** (sem esperar sair do controle).
- `Anchors = [akLeft, akTop, akRight]` `[.dfm:L102]` — o combo estica na largura; irrelevante no alvo (reflow fluido).

> **No alvo:** o combo vira `<SelectField>` com as opções `[{value:'C', label:'1 - CREDITO'}, {value:'D', label:'2 - DEBITO'}]` — preservando **valor gravado** (`C`/`D`) e **rótulo exibido** (`1 - CREDITO`…). Ver [Regras BR-04](#5-regras-de-negócio) e [Paridade](#paridade-com-o-novo).

**Herdados (do form-base, reaproveitados pelo engine CRUD do alvo):** `edtCodigo` (código/lookup da PK `CODOPCONTA`), `btnPesquisa` (`TSpeedButton`, abre `frmPesquisa`), `DBNavigator1` (navegação), botões de ação no rodapé (Gravar/Cancelar/Editar/Excluir/Adicionar + `btnOutros`), `stbHints` (status bar "Cadastrado/Alteração"). Detalhe em [form-base-cadmaster.md](../../03-legacy-analysis/recon/form-base-cadmaster.md).

**Notas de reflow:** layout absoluto `Left/Top` → grid fluido de 1 coluna (Descrição larga) + combo estreito, preservando ordem de leitura e taborder (seção 8); **não** copiar pixels.

> **Divergência vs. Bancos (UI):** em `edtDESCRICAO` **não há `CharCase=ecUpperCase`** `[.dfm:L84-93]` — confira: o bloco do `TDBEdit` não tem a propriedade. Em Bancos quase todos os campos forçavam maiúsculas (BR-04 de lá). Aqui a descrição é gravada **como digitada**. Paridade = **preservar caixa do operador** (sem `.toUpperCase()`). `[.dfm]`
>
> **Divergência vs. Bancos (gap inverso):** Bancos tinha colunas no DB sem campo na tela (UF). Aqui **não há gap** — as 3 colunas de negócio (`CODOPCONTA` herdado no cabeçalho, `DESCRICAO`, `TIPO`) estão todas na tela; as colunas de auditoria (`USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO`) **não aparecem** no `.dfm` por design (são carimbadas pelo form-base, não editáveis) — ver [Dados](#4-dados) e [Efeitos](#6-efeitos-colaterais--estado-externo).

---

## 3. Eventos

Handlers próprios de `uCadOperacoesConta.pas` (o resto do comportamento é herdado de `TfrmCadMaster` — ver seção 7). Esta tela é ainda mais fina que Bancos: **não** sobrescreve nem `btnGravarClick`.

| Componente.Evento | `.pas` | O que faz | Toca SQL? | Toca estado externo? | Vira (alvo) |
|---|---|---|---|---|---|
| `FormCreate` | `[.pas:L42-47]` | `inherited`; cria `DmOperacoesConta := TDmOperacoesConta.Create(nil)`; `SetaDataset(edtDescricao, DmOperacoesConta.cdsOperacoesConta, 'CODOPCONTA', 'OPERACOES_CONTA')` — wira o cds da tabela ao form-base, define PK `CODOPCONTA`, tabela `OPERACOES_CONTA` e **foco inicial em `edtDescricao`** | indireto (abre dataset) | cria datamodule; usa conn global | montagem do form + bind do recurso `/cadastro/operacoes-conta` |
| `FormClose` | `[.pas:L35-40]` | `FreeAndNil(DmOperacoesConta)`; `inherited` | — | libera datamodule | desmontagem/cleanup |
| `cdsOperacoesConta.OnNewRecord` | `[udmCadOperacoesConta.pas:L39-42]` | `cdsOperacoesContaTIPO.AsString := 'D'` — ao **inserir** novo registro, default do tipo = **'D' (Débito)** | — | seta default no dataset | default `tipo='D'` no form de inclusão |

> **Achados (a leitura "olhando a tela" perderia):**
> 1. **Não há `btnGravarClick` próprio.** Toda a gravação é 100% `inherited` (`TfrmCadMaster.btnGravarClick`, ver [seção 6](#6-efeitos-colaterais--estado-externo)) — RBAC → obrigatórios → `ApplyUpdates` → histórico → carimbo → log. Esta tela **não tem nem a conversão defensiva** que Bancos tinha (`StrToInt` de CODBCOBLT), porque não tem campo numérico próprio digitável.
> 2. **Default `TIPO='D'` no `OnNewRecord`** `[udmCadOperacoesConta.pas:L41]` — **regra escondida no datamodule**, não no form. Ao adicionar um registro novo, o combo já vem em **Débito**. Paridade tem de pré-selecionar `'D'` no formulário de inclusão (ver [BR-05](#5-regras-de-negócio)).

---

## 4. Dados — TODA query

### Q1 — `sqqOperacoesConta` (leitura de 1 registro por código) — `[.dfm SQL.Strings]`
- **Origem:** `retaguarda-master/fonte/Units/udmCadOperacoesConta.dfm` `[.dfm:L44-82]` — `TFDQuery sqqOperacoesConta`, `Connection = dmPrincipal.FDConexao` (global), via `dspOperacoesConta` (`TDataSetProvider`) → `cdsOperacoesConta` (`TClientDataSet`).
- **Quando dispara:** ao abrir/editar uma operação pelo código (via `SetaDataset`/`AbreDataset` do form-base, com `cdsOperacoesConta.Params['CODIGO']`).
- **SQL base (Oracle, verbatim do `.dfm`):**
  ```sql
  SELECT C.CODOPCONTA, C.DESCRICAO,
         C.TIPO
  FROM  OPERACOES_CONTA C
  WHERE C.CODOPCONTA =:Codigo
  ```
- **Params:** `:Codigo` (`CODIGO`, `ftInteger`, `ptInput`) — origem: `edtCodigo` / chave selecionada na pesquisa. `[.dfm:L54-60]`
- **Fragmentos condicionais:** nenhum nesta query (estática pura). Projeção explícita das **3 colunas de negócio** — **não** traz as colunas de auditoria (`USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO`), que existem na tabela mas são lidas à parte pelo form-base (`SetaUltimaAlteracao`, ver [seção 6](#6-efeitos-colaterais--estado-externo)).
- **Campos/ProviderFlags (definem a DML do provider):** `[.dfm:L61-81]`
  | Campo | Tipo | ProviderFlags | Required |
  |---|---|---|---|
  | `CODOPCONTA` | `TIntegerField` | `pfInUpdate, pfInWhere, pfInKey` | True |
  | `DESCRICAO` | `TStringField` (Size 100) | `pfInUpdate` | True |
  | `TIPO` | `TStringField` (Size 1, **FixedChar=True**) | `pfInUpdate` | True |
- **Pipeline de gravação — `[estático/inferido]` (mesmo contrato do form-base já capturado em Bancos).** O provider gera DML **delta-based** (só colunas tocadas), bindada. **Não capturado em runtime para esta tela**; herda a forma de [uCadBancos §4 (G-02..G-04)](uCadBancos.md). Reconstrução esperada:
  ```sql
  -- INSERT (só os campos preenchidos; CODOPCONTA gerado app-side por sequence — ver abaixo)
  insert into "OPERACOES_CONTA" ("CODOPCONTA","DESCRICAO","TIPO") values (:1,:2,:3)
  -- UPDATE (só a(s) coluna(s) alterada(s); WHERE pela chave)
  update "OPERACOES_CONTA" set "DESCRICAO" = :1 where "CODOPCONTA" = :2
  -- DELETE (físico — tabela sem INDR, ver BR-06)
  delete from "OPERACOES_CONTA" where "CODOPCONTA" = :1
  ```
- **⚠️ Carimbo de auditoria = 2º statement SEPARADO `[inferido — herdado do form-base]`.** Após o insert/update, o form-base (`SetaOperadorAlteracao`) emite um `UPDATE` literal carimbando `USULTALTERACAO`/`DTULTIMALTERACAO` (e `DTCADASTRO` no insert) — as 3 colunas **existem na tabela** `[runtime DB confirmado]`, então o carimbo se aplica (≠ Bancos onde também se aplicava). Forma esperada:
  ```sql
  -- após INSERT:
  UPDATE OPERACOES_CONTA SET USULTALTERACAO=<op>, DTULTIMALTERACAO='<ts>', DTCADASTRO='<ts>' WHERE CODOPCONTA='<chave>'
  -- após UPDATE:
  UPDATE OPERACOES_CONTA SET USULTALTERACAO=<op>, DTULTIMALTERACAO='<ts>' WHERE CODOPCONTA='<chave>'
  ```
- **Leitura do "Cadastrado/Alteração" (status bar, `SetaUltimaAlteracao`) `[inferido]`** — forma análoga a Bancos (join em `OPERADORES`):
  ```sql
  select T.USULTALTERACAO, O.LOGIN, T.DTULTIMALTERACAO, T.DTCADASTRO
  from OPERACOES_CONTA T LEFT JOIN OPERADORES O ON (O.CODOPERADOR = T.USULTALTERACAO) where T.CODOPCONTA = '<chave>'
  ```
- **Mutações:** leitura (Q1) + escrita (INSERT/UPDATE/DELETE via provider) em `OPERACOES_CONTA`.
- **Tabelas / triggers / sequences tocadas:**
  - `OPERACOES_CONTA` (CRUD). Estrutura confirmada `[runtime DB]`: `CODOPCONTA NUMBER(10) NOT NULL` (PK `PK_OPERACOES_CONTA`), `DESCRICAO VARCHAR2(100) NOT NULL`, `TIPO CHAR(1) NOT NULL`, + auditoria nullable (`USULTALTERACAO NUMBER(10)`, `DTULTIMALTERACAO TIMESTAMP(6)`, `DTCADASTRO TIMESTAMP(6)`). Check-constraints `NOT NULL` em CODOPCONTA/DESCRICAO/TIPO (`SYS_C00974xx`).
  - **🟢 NENHUMA TRIGGER** `[runtime DB confirmado]` — `all_triggers` para `OPERACOES_CONTA` = vazio. **Não existe `REM_OPERACOES_CONTA`** → **esta tabela NÃO replica** (≠ Bancos, que tinha `REM_BANCOS`→`REMESSA_SERVER`). É a divergência-chave desta tela. Ver [seção 6](#6-efeitos-colaterais--estado-externo).
  - **PK `CODOPCONTA` por SEQUENCE app-side** `[runtime DB — sequence existe]`: o banco tem a sequence **`ID_CODOPCONTA`** (schema PINHEIRAO) e **não tem trigger** que a aplique → o **aplicativo** busca o próximo valor e o insere explicitamente (mesmo padrão capturado em Bancos). → **No alvo:** sequence/`nextval` no Postgres (paridade de resultado: código sequencial auto-gerado, não digitado).
- **SQL-alvo (Postgres, Kysely):** `select codopconta, descricao, tipo from operacoes_conta where codopconta = $1`; writes viram `insert/update/delete` explícitos no engine CRUD. Oracle→PG: `NUMBER(10)`→`integer`, `VARCHAR2(100)`→`varchar(100)`, `CHAR(1)`→`char(1)`, `TIMESTAMP(6)`→`timestamptz`. Sem `NVL/ROWNUM/(+)/SYSDATE` nesta query.

### Q2 — Pesquisa / listagem (`btnPesquisa` → `frmPesquisa`) — `[estático]` (view confirmada no DB; valores finais em runtime)
- **Origem:** form-base `TfrmCadMaster.btnPesquisaClick` `[uCadMaster.pas:L516]` abre `frmPesquisa` (`uPesquisa.pas`) sobre a **VIEW `GET_OPERACOES_CONTA`** (não a tabela crua) — ver [form-base-cadmaster.md §2](../../03-legacy-analysis/recon/form-base-cadmaster.md).
- **View `GET_OPERACOES_CONTA` (✅ definição capturada do dicionário — `pinheirao@dbhomologacao`):**
  ```sql
  SELECT DESCRICAO, CODOPCONTA, CASE TIPO WHEN 'C' THEN 'CREDITO' ELSE 'DEBITO' END TIPO
  FROM OPERACOES_CONTA
  ```
  Colunas da view (renomeadas para o grid): **`DESCRICAO`, `CODIGO`(=CODOPCONTA), `TIPO`(decodificado)** `[runtime DB — all_tab_columns]`.
  - **Achado-chave (decode na pesquisa):** a view **decodifica** `TIPO` para texto: `C`→`CREDITO`, e **`ELSE`→`DEBITO`** (qualquer valor ≠ `'C'` mostra `DEBITO`). Logo a **leitura** (Q1, tabela crua) traz `C`/`D` para o combo, mas a **pesquisa/listagem** (view) mostra `CREDITO`/`DEBITO` — split fiel a replicar (READ lê a tabela; lista lê a view). Note o **quirk**: a view não distingue `'D'` de lixo — tudo que não é `'C'` vira `DEBITO`.
  - Renomeia `CODOPCONTA`→`CODIGO` (alias do grid, como `GET_BANCOS` fazia). **Omite** as colunas de auditoria. Sem `INDR`/`ATIVO` → sem filtro de soft-delete (coerente com BR-06).
- **Metadados de pesquisa (`TABELA_CADASTRO`) — ✅ verificado: ENTRADA AUSENTE.** `select tabela,form from TABELA_CADASTRO where upper(tabela) like '%OPERAC%'` retorna **só** `('GET_MOTIVOS_OPERACAO','FrmCadMotivoOperacoes')` — **não há linha para `GET_OPERACOES_CONTA`** `[runtime DB]`. Em Bancos o `frmPesquisa` fazia `select FORM from TABELA_CADASTRO where TABELA='GET_BANCOS'`; aqui essa consulta **volta vazia** → o `frmPesquisa` cai no comportamento default (form de pesquisa genérico, sem layout custom). A SQL final do grid (`select Cast('F'..)Selecionar, Cast('T'..)Sel, GET_OPERACOES_CONTA.* from GET_OPERACOES_CONTA` + where/order do usuário) é `[inferido]` por analogia com Bancos.
- **Alvo:** `GET /cadastro/operacoes-conta` (lista) sobre o equivalente da view (com decode de TIPO).

> **Regra de ouro:** Q1 é estática e confiável (e idêntica à semente do `.dfm`); o **pipeline de escrita** (provider), o **carimbo de auditoria** e a **SQL final da pesquisa** são `[inferido]` — herdam a forma já **capturada em runtime no piloto Bancos** (mesmo form-base), mas **não foram vistos rodando para esta tela**. Não declarar paridade certificada sem a captura V$SQL desta tela. ✅ Já **confirmado do banco** (não inferido): estrutura da tabela, ausência de trigger, definição da view `GET_OPERACOES_CONTA`, ausência em `TABELA_CADASTRO`, existência da sequence `ID_CODOPCONTA`.

---

## 5. Regras de negócio

| ID | Regra | Gatilho | Lógica (verbatim do legado) | *Porquê* | Procedência |
|---|---|---|---|---|---|
| BR-01 | **Permissão de gravar** por form+ação | ao gravar | `dmPrincipal.PossuiAcessoForm('frmCadOperacoesConta','BTNGRAVAR')`; sem permissão → cancela + exceção (idem `BTNEXCLUIR` ao excluir) | RBAC data-driven por tela/ação | `[.pas TfrmCadMaster:L430]` (herdado) |
| BR-02 | **Campos obrigatórios** | ao gravar | `ValidaObrigatorios(cdsPrincipal)` → `Abort` se faltar. Obrigatórios: `DESCRICAO`, `TIPO`, `CODOPCONTA` (todos `Required=True` no dataset **e** `NOT NULL` no DB) | integridade do cadastro | `[.pas TfrmCadMaster:L446]` + `[udmCadOperacoesConta.dfm: Required=True]` + `[runtime DB: NOT NULL]` |
| BR-03 | **Carimbo de operador/data** | ao gravar | form-base `SetaOperadorAlteracao` preenche `USULTALTERACAO`/`DTULTIMALTERACAO` (+`DTCADASTRO` no insert) — colunas **existem** na tabela `[runtime DB]` | autoria/auditoria | `[.pas TfrmCadMaster:L449-453]` + `[runtime DB: colunas presentes]` |
| BR-04 | **`TIPO` é lista fixa `C`/`D`** | digitação/seleção | combo `cbbTIPO`: `Values=['C','D']` ↔ `Items=['1 - CREDITO','2 - DEBITO']`. Grava **`C`/`D`** (CHAR(1), `FixedChar=True`); `UpdateFieldImmediatelly=True` | classificar crédito (entra) vs. débito (sai) na conta | `[.dfm:L94-112]` |
| BR-05 | **Default `TIPO='D'` ao inserir** | novo registro | `cdsOperacoesContaNewRecord`: `cdsOperacoesContaTIPO.AsString := 'D'` | conveniência: maioria das operações de conta lançadas é débito (saída) — *confirmar com domínio* | `[udmCadOperacoesConta.pas:L39-42]` |
| BR-06 | **Sem soft-delete (DELETE físico)** | ao excluir | `OPERACOES_CONTA` **não tem `INDR`** `[runtime DB]` → exclusão **física** (`DELETE`), conforme convenção do form-base (soft-delete só com `INDR`) | tabela simples, sem necessidade de histórico de exclusão | `[runtime DB: sem INDR]` + `[.pas uCadMaster: ExcluirRegistro]` |
| BR-07 | **`DESCRICAO` NÃO força maiúsculas** | digitação | `edtDESCRICAO` **sem** `CharCase` no `.dfm` (≠ Bancos, que tinha `ecUpperCase`) → grava como digitado | preserva a grafia do operador | `[.dfm:L84-93]` (ausência de `CharCase`) |

> Não há cálculo nem regra fiscal nesta tela. As "regras" são o contrato do form-base (BR-01/02/03/06) + integridade + as **duas particularidades** desta tela: o combo `C`/`D` (BR-04), o default `D` (BR-05) e a ausência de uppercase (BR-07). O *porquê* de `TIPO` (crédito/débito) é a semântica contábil de conta: crédito = recurso que **entra**, débito = recurso que **sai** — consumida pelas telas de caixa/tesouraria que referenciam esta tabela ([Dependências](#7-dependências)).

---

## 6. Efeitos colaterais + estado externo

> A seção que salva da armadilha de acoplamento. Aqui a notícia boa é uma **ausência** confirmada: **sem replicação**.

| Item | Tipo | Alvo | Quem setou / consome | Mapeamento alvo |
|---|---|---|---|---|
| `dmPrincipal.FDConexao` | usa | conexão Oracle **global** | datamodule principal (boot) | conexão **por tenant** request-scoped ([../../03-legacy-analysis/hidden-coupling-traps.md](../../03-legacy-analysis/hidden-coupling-traps.md)) |
| `dmPrincipal.OperadorCODOPERADOR` | lê | operador logado | login | usuário no request context (fail-closed) |
| `dmPrincipal.PossuiAcessoForm` | lê | RBAC | tabela `PERMISSOES` | guard/policy por rota+ação (`@RequerAcesso`) |
| **trigger `REM_*`** | **N/A — NÃO EXISTE** | — | — | **sem outbox de sync** para esta entidade `[runtime DB confirmado]` |
| `MENUEXPRESS` | grava | telemetria de uso | ao abrir a tela: `ACESSOS=ACESSOS+1 WHERE FORMULARIO='FRMCADOPERACOESCONTA'` (padrão do form-base) `[inferido]` | métrica de uso (opcional no alvo) |
| `HISTORICO_DINAMICO` | grava (indireto) | tabela de histórico | `SetaHistorico_Dinamico` no `btnGravarClick` herdado `[inferido]` | audit log / histórico por campo (engine `historico`) |
| `USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO` | grava | colunas da `OPERACOES_CONTA` | `SetaOperadorAlteracao` herdado | colunas de auditoria preenchidas no service/engine |
| `TLog.GravaLog` | grava | log de aplicação | `btnGravarClick` herdado `[inferido]` | logging estruturado |

- **Conexão/transação:** usa a conexão **global** do `dmPrincipal`; transação é a global do legado. No alvo: transação **escopada** ao caso de uso (gravação numa só transação; sem outbox, pois não replica).
- **Ordem de abertura assumida:** presume login feito (operador/permissões em `dmPrincipal`). Precondição a virar contexto explícito.

> **A diferença que mais importa vs. Bancos: NÃO há escrita-fantasma de replicação.** Confirmado no dicionário (`all_triggers` para `OPERACOES_CONTA` = vazio; **não existe `REM_OPERACOES_CONTA`**) `[runtime DB]`. Enquanto Bancos gerava **15 linhas em `REMESSA_SERVER`** num ciclo criar+editar+excluir (fan-out por terminal + carimbo), **esta tela gera ZERO eventos de replicação**. → No alvo, o repositório/engine desta entidade roda **sem outbox** (`replica: false`). Isso é fidelidade, não simplificação: a entidade simplesmente não era replicada no legado. (As demais escritas-sombra — `HISTORICO_DINAMICO`, telemetria `MENUEXPRESS`, carimbo de auditoria — seguem o padrão do form-base, marcadas `[inferido]` até captura de runtime desta tela.)

---

## 7. Dependências

| Dependência | Tipo | Como é usada | Vira (alvo) |
|---|---|---|---|
| `TfrmCadMaster` (`uCadMaster.pas`) | **herança** | todo o CRUD: gravar/editar/excluir/pesquisar/navegar, validação, carimbo, histórico, log, RBAC, teclado | **engine CRUD reutilizável** ([form-base-cadmaster.md](../../03-legacy-analysis/recon/form-base-cadmaster.md), ADR-014) |
| `TDmOperacoesConta` (`udmCadOperacoesConta`) | datamodule | `sqqOperacoesConta`→`dspOperacoesConta`→`cdsOperacoesConta` da tabela `OPERACOES_CONTA`; hospeda o `OnNewRecord` (default `TIPO='D'`) | `CrudConfig` + engine (sem estado) |
| `udmPrincipal` (`dmPrincipal`) | datamodule global | conexão, operador, RBAC, histórico | tenant context + providers |
| `JvDBCombobox` (`TJvDBComboBox`) | lib JVCL | o combo `TIPO` (Values/Items) | `<SelectField>` do DS / palette CRUD |
| **Consumidores de `OPERACOES_CONTA`** | tabelas/telas | `uLanCaixa`, `uMovCaixa`, `uCadMovContasBancarias`, baixas a pagar/receber, tesouraria — todas referenciam a tabela `[grep legado]` | módulos financeiros do alvo consomem o cadastro |
| FastReport (`frx*`), AppEvnts | libs | export/UI (herdado, `uses`) | export server-side / DS |

> Diferente de Bancos, **não há cópias `DmOld`/variantes** ativas para esta tela — o datamodule é único (`udmCadOperacoesConta`). A unit homônima de outro domínio (`uCadOperacoesContabeis`/`OPERACOES_CONTABEIS`) é **outra tela** (operações **contábeis**, plano de contas), **não** confundir.

---

## 8. TabOrder + mapa de atalhos/mnemônicos

**TabOrder (campos próprios, sequência exata `[.dfm]`):**

| Ordem | Controle | Campo | Tipo | TabOrder |
|---|---|---|---|---|
| 0 | `edtDESCRICAO` | DESCRICAO | TDBEdit | `TabOrder=0` `[.dfm:L92]` |
| 1 | `cbbTIPO` | TIPO | TJvDBComboBox | `TabOrder=1` `[.dfm:L107]` |

> Foco inicial: `edtDESCRICAO` (definido por `SetaDataset(edtDescricao, ...)` no `FormCreate` `[.pas:L46]`). Antes destes, no fluxo de carga, o foco passa por `edtCodigo` (código, herdado). A **ordem visual** (Descrição em cima, Tipo embaixo) coincide com a taborder aqui (≠ Bancos, onde divergiam). Replicar a taborder exata (ADR-010).

**Mnemônicos `&` (Alt+letra):** **nenhum nos labels desta tela** — `lblDESCRICAO` é `'Descrição'` e `lblTIPO` é `'Tipo'`, **sem `&`** `[.dfm:L73,L81]`. Ambos têm `FocusControl` (`lblDESCRICAO→edtDESCRICAO`, `lblTIPO→cbbTIPO`), mas sem letra de atalho. Os mnemônicos/atalhos vivem nos **botões herdados** do rodapé ([form-base-cadmaster.md §4](../../03-legacy-analysis/recon/form-base-cadmaster.md)): `&Gravar` (Alt+G), `&Editar` (Alt+E), `E&xcluir` (Alt+X), `&Adicionar` (Alt+A), `&Sair`/`&Cancelar` (Alt+S/C), `&Outros` (Alt+O).

> Nota de paridade no alvo: o app **adiciona** mnemônicos aos campos (`label="&Descrição"`, `label="&Tipo"`) que o legado **não tinha** — melhoria de teclado consistente com ADR-010, divergência benigna (não remove memória muscular, adiciona). Ver [Paridade](#paridade-com-o-novo).

**Atalhos (F-keys/Enter/Esc) — herdados do form-base** ([form-base-cadmaster.md §4](../../03-legacy-analysis/recon/form-base-cadmaster.md)): **F6** cicla filtro ativo (N/A aqui — sem `INDR`/`ATIVO`), **Alt+O** abre "Outros", **←/→** registro anterior/próximo e **↑/↓** primeiro/último (em `edtCodigo`), **Enter** em `edtCodigo` carrega pelo código, **Esc** protegida durante edição, `edtCodigo` só aceita dígitos (PK inteira). Mapa comum a todas as ~101 herdeiras → config-padrão do engine CRUD.

---

## 9. Casos de teste (golden) — capturados do legado

> ⚠️ **Sem golden de runtime certificado para esta tela.** Diferente do piloto Bancos (V$SQL/REMESSA_SERVER capturados com CODBCO=740), esta tela **não foi exercitada no ERP com log de SQL ligado**. Os casos abaixo são: ✅ **confirmados do dicionário Oracle** (estrutura/view/triggers/sequence), e 🟡 **inferidos do contrato do form-base** já capturado em Bancos. Vira golden certificado quando a tela for exercitada (mesma técnica de [dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md)).

| ID | Cobre | Ação | SQL esperada | Procedência | Efeito-fantasma |
|---|---|---|---|---|---|
| G-01 | Q1 leitura | abrir registro | `SELECT C.CODOPCONTA, C.DESCRICAO, C.TIPO FROM OPERACOES_CONTA C WHERE C.CODOPCONTA =:Codigo` | ✅ idêntico à semente `.dfm` | + `SetaUltimaAlteracao` (join OPERADORES) `[inferido]` |
| G-02 | INSERT (delta) + BR-05 | gravar novo (tipo default 'D') | `insert into "OPERACOES_CONTA" ("CODOPCONTA","DESCRICAO","TIPO") values (:1,:2,:3)` | 🟡 inferido (form-base) | carimbo `UPDATE ... DTCADASTRO,DTULTIMALTERACAO`; **SEM replicação** |
| G-03 | UPDATE (delta) | editar DESCRICAO | `update "OPERACOES_CONTA" set "DESCRICAO"=:1 where "CODOPCONTA"=:2` | 🟡 inferido | carimbo `UPDATE ... USULTALTERACAO`; **SEM replicação** |
| G-04 | DELETE (físico, BR-06) | excluir | `delete from "OPERACOES_CONTA" where "CODOPCONTA"=:1` | 🟡 inferido | **SEM replicação** (sem trigger) |
| G-05 | Q2 pesquisa + decode | pesquisar | `select FORM from TABELA_CADASTRO where TABELA='GET_OPERACOES_CONTA'` → **vazio** → fallback genérico → `... GET_OPERACOES_CONTA.* from GET_OPERACOES_CONTA` (TIPO já vem `CREDITO`/`DEBITO`) | ✅ view + ausência em TABELA_CADASTRO confirmadas no DB | — |
| G-06 | BR-04 combo | salvar com Tipo=Crédito | grava `TIPO='C'` (não `'1 - CREDITO'`); na lista mostra `CREDITO` | ✅ view decode confirmado | — |

**Caminhos negativos / regras:**
- **G-07 obrigatórios (DESCRICAO/TIPO)** — `ValidaObrigatorios → Abort` **antes** do `ApplyUpdates` → **nenhuma SQL emitida** quando faltam. DB tem `NOT NULL` como backstop. → **Alvo:** validar no DTO/zod (bloquear antes do banco). 🟡 inferido (mesmo fluxo de Bancos G-07, lá confirmado).
- **G-08 RBAC sem permissão (BR-01)** — bloqueia antes do banco (zero DML). 🟡 inferido.
- **G-09 caixa preservada (BR-07)** — gravar `descricao="Conta Movimento"` (caixa mista) → persiste **sem** uppercase (≠ Bancos). ✅ verificável (ausência de CharCase no `.dfm`).
- **A capturar para certificar (V$SQL):** todos os G-02..G-04 reais, o carimbo de auditoria desta tabela, e a pesquisa com filtro/ordenação.

---

## 10. Alvo (especificação de implementação)

**Backend (NestJS + Kysely — via engine CRUD declarativo):**
- Módulo: `cadastro` (config `operacoes-conta.crud.ts`).
- Endpoints (gerados pela `createCrudController`):
  | Método+rota | Origem | DTO (zod) | Mutação? |
  |---|---|---|---|
  | `GET /cadastro/operacoes-conta` | Q2 (view) | — | leitura |
  | `GET /cadastro/operacoes-conta/:cod` | Q1 | — | leitura |
  | `POST /cadastro/operacoes-conta` | btnGravar (insert) | `operacaoContaSchema` | escrita (**sem outbox**) |
  | `PUT /cadastro/operacoes-conta/:cod` | btnGravar (update) | `atualizarOperacaoContaSchema` | escrita (sem outbox) |
  | `DELETE /cadastro/operacoes-conta/:cod` | btnExcluir | — | escrita física (BR-06) |
- Para o **service/engine**: RBAC (BR-01) via guard `@RequerAcesso('FRMCADOPERACOESCONTA',...)`; carimbo de operador/data (BR-03); `historico` (HISTORICO_DINAMICO); **sem outbox** (`replica: false`, fiel à ausência de trigger).
- Para o **DTO/zod**: obrigatórios `descricao`, `tipo` (BR-02); `tipo` ∈ `{C,D}` (BR-04); `descricao` **sem** `.toUpperCase()` (BR-07); PK por sequence.

**Frontend (React):**
- Rota `/cadastro/operacoes-conta` (lista) + `/cadastro/operacoes-conta/:cod` (form).
- Campos/ordem = seção 2 + taborder = seção 8; `<Field>` (descrição) + `<SelectField>` (tipo, opções `C`/`D`); Enter-avança e atalhos do engine.

**Decisões offline (PDV/Electron):** N/A direto — cadastro roda na **retaguarda/nuvem**. **Sem replicação** (a entidade não tinha trigger `REM_*`), então **não há delta de sync** a propagar — ao contrário de Bancos.

---

## Paridade com o novo

> **Implementação Fase 0 existente** em `/Library/Apollo` (monorepo `sicom`: NestJS+Kysely+React). Construída via **engine CRUD declarativo** (a 2ª tela herdeira, que provou a generalização do form-base sem tocar infra). **Fiel-por-construção, SEM golden de runtime certificado** (≠ piloto Bancos).

**Backend — `apps/api/src/modules/cadastro/operacoes-conta.crud.ts`** (config declarativa de ~26 linhas):
```ts
export const operacoesContaCrudConfig: CrudConfig = {
  tabela: 'operacoes_conta',
  pk: 'codopconta',
  view: 'get_operacoes_conta',
  colunas: ['descricao', 'tipo'],
  rbacForm: 'FRMCADOPERACOESCONTA',
  colunasPesquisa: ['codopconta', 'descricao', 'tipo'],
  softDelete: false,   // BR-06: DELETE físico (tabela sem INDR)
  replica: false,      // sem trigger REM_* → sem outbox (fiel ao legado)
};
```
- `softDelete: false` ↔ BR-06 (DELETE físico). `replica: false` ↔ ausência de `REM_OPERACOES_CONTA` confirmada no DB. RBAC `FRMCADOPERACOESCONTA` ↔ BR-01. Auditoria/histórico herdados do engine ↔ BR-03.
- O engine (`shared/crud/`) herda de Bancos o padrão delta/carimbo/RBAC/view — a tela vira **config**, não vertical.

**Schema compartilhado — `packages/shared/src/schema/operacao-conta.schema.ts`:**
- `TIPO_OPERACAO_CONTA = [{value:'C',label:'1 - CREDITO'},{value:'D',label:'2 - DEBITO'}]` ↔ mapa `Values`/`Items` do combo legado (BR-04, fiel ao `.dfm`).
- `descricao: z.string().trim().min(1).max(100)` — **sem** `.toUpperCase()` (BR-07, ≠ Bancos); `tipo: z.enum(['C','D'])` (BR-04). O comentário do schema documenta as duas divergências vs. Bancos.

**Frontend — `apps/web/src/features/operacoes-conta/`** (`OperacoesContaFormPage.tsx`, `OperacoesContaListPage.tsx`, `api.ts`, `hooks.ts`):
- `<Field label="&Descrição">` + `<SelectField label="&Tipo" options={TIPO_OPERACAO_CONTA}>` — combo C/D fiel.
- Mnemônicos `&Descrição`/`&Tipo`/`&Gravar`/`&Sair` via camada de teclado (ADR-010) — **adição** benigna sobre o legado (que não tinha `&` nos labels, seção 8).

**Divergências conhecidas / pendências:**
1. **Sem golden de runtime certificado** — fiel por estática + SQL-shape; só Bancos é runtime-golden. Capturar V$SQL desta tela para certificar G-02..G-04 e o carimbo de auditoria.
2. **Default `TIPO='D'` ao inserir (BR-05)** — o `OnNewRecord` do legado pré-seleciona Débito; conferir se o form de inclusão do alvo (`OperacoesContaFormPage`, modo `isNew`) **pré-seleciona `'D'`** (hoje o `SelectField` abre com `placeholder="Selecione…"`). **Lacuna a fechar** para paridade exata de inclusão.
3. **`HISTORICO_DINAMICO` / telemetria `MENUEXPRESS`** — herdados do engine `historico`; telemetria de acesso não implementada (decidir manter/descartar).
4. **`x-operador-id` fixo no `api.ts`** (`'7'`) — placeholder de dev; identidade real vem do contexto de sessão/login no alvo.

---

## Lacunas (para sair de `rascunho`)

**✅ Confirmado do dicionário Oracle (`pinheirao@dbhomologacao`, read-only, 2026-06-25):**
- Estrutura de `OPERACOES_CONTA` (6 colunas: 3 de negócio + 3 de auditoria; PK `PK_OPERACOES_CONTA`; `NOT NULL` em CODOPCONTA/DESCRICAO/TIPO).
- **NENHUMA trigger** (`all_triggers` vazio) → **sem replicação** (não há `REM_OPERACOES_CONTA`).
- View **`GET_OPERACOES_CONTA`** existe e **decodifica** `TIPO` (`CASE WHEN 'C' THEN 'CREDITO' ELSE 'DEBITO'`), renomeia CODOPCONTA→CODIGO.
- **`TABELA_CADASTRO` SEM entrada** para `GET_OPERACOES_CONTA` (só `GET_MOTIVOS_OPERACAO`) → pesquisa usa form genérico default.
- Sequence **`ID_CODOPCONTA`** existe → PK app-side por sequence.

**✅ Confirmado do `.pas`/`.dfm` (estática):**
- Herança `TfrmCadMaster`; combo `TIPO` Values `C`/`D` ↔ Items `1 - CREDITO`/`2 - DEBITO`; `DESCRICAO` **sem** `CharCase`; default `TIPO='D'` no `OnNewRecord`; Q1 estática; sem `btnGravarClick` próprio; taborder Descrição(0)→Tipo(1); labels sem `&`.

**🟡 Inferido (herdado do form-base, capturado em Bancos mas NÃO nesta tela):**
- Pipeline de escrita delta-based do provider; carimbo de auditoria como 2º statement; `SetaUltimaAlteracao`; SQL final da pesquisa; telemetria `MENUEXPRESS`; `HISTORICO_DINAMICO`; `TLog.GravaLog`.

**Pendências (não marcar `concluído` sem elas):**
1. **Captura de runtime (V$SQL)** desta tela exercitando o ERP — fecha as seções 4 e 9 com golden certificado (hoje 🟡).
2. **BR-05 (default `TIPO='D'` ao inserir)** — verificar/garantir no `OperacoesContaFormPage` modo inclusão.
3. **Revisão independente** ([../../08-agents/review-loop.md](../../08-agents/review-loop.md)) — etapa 2 do loop (autor ≠ revisor).
4. **Paridade verde que exercita o caminho real** ([../../06-testing-quality/parity-harness.md](../../06-testing-quality/parity-harness.md)) — etapa 3, incluindo teclado (taborder, Enter, mnemônicos via Playwright).

## Ver também

- [dossier-template.md](../../dossier-template.md) · [dossier-process.md](../../dossier-process.md)
- [uCadBancos.md](uCadBancos.md) — o piloto (1ª herdeira); este dossiê espelha sua profundidade e reusa o contrato do form-base.
- [form-base-cadmaster.md](../../03-legacy-analysis/recon/form-base-cadmaster.md) — o contrato de `TfrmCadMaster` (ciclo de vida, teclado, efeitos comuns).
- [../../03-legacy-analysis/dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md) — como fechar as seções 4 e 9 (runtime).
- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — ADR-008/010/011/012/014.
