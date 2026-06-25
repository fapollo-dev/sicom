# Dossiê — `frmCadMarcas` (Cadastro de Marcas)

| Campo | Valor |
|---|---|
| **Status** | **`em-revisão`** — análise de legado (estática `.pas`/`.dfm` + **dicionário Oracle confirmado read-only**) feita e fechada; tela já implementada **declarativamente** no app (`marcas.crud.ts` + `MarcasCadMaster.tsx`), **fiel-por-construção**. **NÃO `concluído`**: sem golden de runtime certificado (só [Bancos](uCadBancos.md) tem) e sem 2ª revisão independente — ver [Lacunas](#lacunas--perguntas). |
| **Autor / Revisor** | Analista de Legado (Claude) / *pendente — revisor independente ([../../08-agents/review-loop.md](../../08-agents/review-loop.md))* |
| **Versão do dossiê** | v0 (recon — herdeira trivial do form-base) |
| **Data** | 2026-06-25 |
| **Commit do legado analisado** | `/Library/SicomGit/retaguarda-master` (branch `*-master`, sem hash versionado) |

> **O que torna esta tela barata:** é a **menor herdeira possível** do `TfrmCadMaster` — **um único campo** (`DESCRICAO`) sobre uma tabela de 8 colunas. Tudo o mais (máquina de estados, gravar/excluir/pesquisar/navegar, teclado, carimbo de auditoria) é **herdado** do form-base já documentado em [form-base-cadmaster.md](../../03-legacy-analysis/recon/form-base-cadmaster.md). O **diferencial** em relação ao piloto [Bancos](uCadBancos.md): MARCAS **tem soft-delete (`INDR`)** e **NÃO tem trigger de replicação** — o inverso de Bancos.
>
> ⚠️ **Limite desta versão:** análise **estática** de `.pas`/`.dfm` + **inspeção do dicionário Oracle** (`pinheirao@apollo`, read-only, 2026-06-25). O playbook exige **captura de runtime** (`V$SQL`) para fechar as seções 4 e 9 ([dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md)). O pipeline de escrita do provider é marcado `[inferido — herda Bancos]` (mesmo motor `TfrmCadMaster`/FireDAC; provado em runtime no piloto). Tudo não visto rodando está rotulado `[estático]`/`[inferido]`.

---

## 1. Identidade

| Campo | Valor |
|---|---|
| **Form (`.pas` / `.dfm`)** | `retaguarda-master/fonte/Units/uCadMarcas.pas` (53 linhas) + `uCadMarcas.dfm` (73 linhas) `[.dfm]` |
| **Classe do form** | `TfrmCadMarcas` — **herda `TfrmCadMaster`** (`uCadMaster.pas`, 1.806 linhas) via herança visual (`inherited frmCadMarcas`) `[.dfm:L1]` `[.pas:L13]` |
| **Módulo de domínio** | `cadastro` (marca de produto — usada na classificação/filtro de produtos) |
| **Função no negócio** | CRUD do cadastro de marcas de produto: o operador cria/edita/exclui uma **descrição de marca** (ex.: NESTLE, UNILEVER). É um cadastro de apoio referenciado por produto. |
| **Frequência / criticidade** | **baixa** frequência (cadastro estável; só **1 linha** na amostra de homologação), **baixa** criticidade. **Não** é caminho de PDV. **Não** toca fiscal. |
| **Rota-alvo (web)** | `/cadastro/marcas` (lista) · `/cadastro/marcas/:idmarca` (edição) — recurso `cadastro/marcas` (já implementado, ver [Paridade com o novo](#paridade-com-o-novo)) |
| **Casca-alvo** | `browser` — tela de retaguarda, sem device, sem teclas reservadas críticas. (Electron só se entrar no pacote power-user; sem requisito próprio.) |

---

## 2. UI — inventário de componentes (`.dfm` → React)

Herança visual: o `.dfm` herda **todo** o chrome do form-base (`imgCabecalho`, `lblTitulo`, `pnlGeral`, `pnlCabecalho` com `edtCodigo`+`btnPesquisa`+`DBNavigator1`, `pnlRodapeMaster` com os botões de ação, `stbHints`, e os ClientDataSets `cdsPrincipal`/`cdsNavegation`/`cdsFiltros`/`cdsHistorico_dinamico`). Abaixo, **os únicos controles próprios** desta tela (ambos dentro de `pnlGeral`, bind `DataSource = dtsPrincipal` herdado → `cdsPrincipal`).

| Controle (`.dfm`) | Tipo VCL | Left,Top,W,H | Caption/label (com `&`) | DataField | → React (DS) | Nota de reflow |
|---|---|---|---|---|---|---|
| `lblDescricao` | `TLabel` | 8,16,46,13 | `Descricao` (**sem `&`** no `.dfm`) | — | `<label>` | linha 1, label do campo |
| `edtDescricao` | `TDBEdit` | 9,32,424,21 | (rótulo via `lblDescricao`) | `DESCRICAO` | `<Field>` (largo, 100 chars) | linha 1, campo único `TabOrder=0` |

`[.dfm:L24-39]`

**Herdados (do form-base, reusados pelo engine CRUD do alvo):** `edtCodigo` (campo de código/lookup da PK = `IDMARCA`), `btnPesquisa` (`TSpeedButton`, abre pesquisa sobre `GET_MARCAS`), `DBNavigator1` (navegação de registros), botões de ação do rodapé (Gravar/Cancelar/Editar/Excluir/Adicionar + `btnOutros`), `rdgAtivo` (filtro Ativo `[F6]`), `stbHints` (status bar "Cadastrado/Alteração").

**Notas de reflow:** layout absoluto `Left/Top` → um único campo, sem agrupamento. Não há `TPanel`/`TGroupBox`/`TPageControl` próprios. `edtDescricao` é um `TDBEdit` simples **sem `CharCase`** definido (≠ Bancos, que era `ecUpperCase`) → **não normaliza maiúsculas no input**; a amostra do banco tem dados em caixa-alta (`NESTLE`), mas é **convenção do operador**, não regra de UI.

> **Achado (label sem mnemônico no legado):** `lblDescricao.Caption = 'Descricao'` **sem `&`** `[.dfm:L29]` (e sem acento — texto literal "Descricao"). Logo, **não há Alt+letra para focar o campo** no legado. O app novo introduziu `label="&Descrição"` (Alt+D) — é uma **melhoria**, não paridade estrita; aceitável por ADR-010 (mnemônicos são piso, adicionar não quebra memória muscular). Registrar como divergência consciente.

---

## 3. Eventos

Handlers **próprios** de `uCadMarcas.pas` (todo o resto é herdado de `TfrmCadMaster` — ver seção 7). São três, todos finos:

| Componente.Evento | `.pas` | O que faz (passo a passo) | Toca SQL? | Toca estado externo? | Vira (alvo) |
|---|---|---|---|---|---|
| `FormCreate` | `[.pas:L46-51]` | `inherited`; cria `DMCadMarcas := TDMCadMarcas.Create(nil)`; chama **`SetaDataset(edtDescricao, DMCadMarcas.cdsMarcas, 'IDMARCA', 'MARCAS', tcAutomatica)`** — wira o cds da tabela `MARCAS` ao form-base, define PK=`IDMARCA`, tabela=`MARCAS`, foco inicial=`edtDescricao`, e **tipo de chave automática** (PK gerada por app, ver BR-05/Q-PK) | indireto (prepara dataset) | cria datamodule; usa conn global `dmPrincipal.FDConexao` | montagem do form + bind do recurso `/cadastro/marcas` |
| `btnGravarClick` | `[.pas:L33-37]` | `ValorChavePrimaria := cdsPrincipal.FieldByName('IDMARCA').AsString;` depois `inherited` (todo o fluxo de gravação do form-base — RBAC, obrigatórios, ApplyUpdates, histórico, carimbo, log; ver seção 6) | sim (via `ApplyUpdates`, herdado) | sim (ver seção 6) | `POST`/`PUT /cadastro/marcas` |
| `FormClose` | `[.pas:L39-44]` | `inherited`; `if DMCadMarcas <> nil then FreeAndNil(DMCadMarcas)` | — | libera datamodule | desmontagem/cleanup |

> Observação: `btnGravarClick` próprio só **pré-seta `ValorChavePrimaria`** com o `IDMARCA` corrente **antes** do `inherited`. Detalhe: o `inherited` (`TfrmCadMaster.btnGravarClick`, [.pas:L441]) **re-atribui** `ValorChavePrimaria := cdsPrincipal.FieldByName(FChavePrincipal).Value` logo de início — com `FChavePrincipal='IDMARCA'`, é o **mesmo valor**. Ou seja, a linha própria é **redundante/defensiva** (garante o valor mesmo se algo no meio mexesse) — o grosso da gravação é `inherited`. A leitura "olhando a tela" perderia todo o pipeline; daí "migre o que o sistema faz".

---

## 4. Dados — TODA query

> A tela tem **uma** query estática própria (Q1) no datamodule + o **pipeline de escrita** gerado pelo provider (herdado) + a **pesquisa** sobre a view `GET_MARCAS` (herdada). Estrutura da tabela e view **confirmadas read-only** no dicionário Oracle (`pinheirao@apollo`, 2026-06-25).

### Estrutura da tabela `MARCAS` — ✅ CONFIRMADA (Oracle `ALL_TAB_COLUMNS`, read-only)

| Coluna | Tipo Oracle | Nulo? | Papel | → Postgres (alvo) |
|---|---|---|---|---|
| `IDMARCA` | `NUMBER` | **NOT NULL** | PK (`PKIDMARCA`) | `integer PRIMARY KEY` |
| `DESCRICAO` | `VARCHAR2(100)` | **NULL** | descrição da marca | `varchar(100)` (nullable) |
| `INDR` | `CHAR(1)` | NULL | soft-delete (`'E'`=excluído; null/`'I'`=ativo) | `char(1)` |
| `INDR_USUARIO` | `NUMBER` | NULL | operador que excluiu | `integer` |
| `INDR_DATA` | `TIMESTAMP(6)` | NULL | data da exclusão (servidor) | `timestamptz` |
| `USULTALTERACAO` | `NUMBER` | NULL | operador da última alteração (carimbo) | `integer` |
| `DTULTIMALTERACAO` | `TIMESTAMP(6)` | NULL | data da última alteração (carimbo) | `timestamptz` |
| `DTCADASTRO` | `TIMESTAMP(6)` | NULL | data de cadastro (carimbo no insert) | `timestamptz` |

- **PK:** constraint `PKIDMARCA` (P) sobre `IDMARCA`. ✅
- **Triggers:** **NENHUMA** `[Oracle ALL_TRIGGERS confirmado]`. Não existe `REM_MARCAS` — **MARCAS não replica** (≠ Bancos, que tem `REM_BANCOS`). Ver seção 6.
- **Generator/sequence:** existe **`ID_IDMARCA`** (`ALL_SEQUENCES`, schema PINHEIRAO) — é o que o `GetID('IDMARCA')` consome (ver Q-PK). **Sem** trigger de PK; o app insere o `IDMARCA` **explicitamente**.
- Apenas **1 linha** na tabela em homologação (`IDMARCA=1`, `DESCRICAO=NULL`, `USULTALTERACAO=2`, `DTCADASTRO=2020-09-05`). Confirma que **DESCRICAO aceita NULL** (a linha existente tem descrição nula) — corrobora BR-02.

### Q1 — `sqqMarcas` (leitura de 1 registro por código) — `[.dfm SQL.Strings]` ✅

- **Origem:** `uDMCadMarcas.dfm` `[.dfm:L42-88]` — `TFDQuery sqqMarcas`, `Connection = dmPrincipal.FDConexao` (global), feeding `dspMarcas` (`TDataSetProvider`, `UpdateMode = upWhereKeyOnly` `[.dfm:L7]`) → `cdsMarcas` (`TClientDataSet`).
- **Quando dispara:** ao abrir/editar uma marca pelo código (via `SetaDataset`→`AbreDataset` do form-base, [.pas form-base:L211]).
- **SQL base (Oracle, verbatim do `.dfm`):**
  ```sql
  SELECT
      M.IDMARCA,
      M.DESCRICAO,
      M.INDR,
      M.INDR_DATA,
      M.INDR_USUARIO
  FROM MARCAS M
  WHERE (COALESCE(M.INDR, 'I') <> 'E')
  AND M.IDMARCA = :CODIGO
  ```
- **Fragmentos condicionais:** **nenhum** (estática pura). **Mas atenção ao filtro embutido:** `COALESCE(M.INDR,'I') <> 'E'` — a query **já esconde os excluídos** (soft-delete). Diferente de Bancos (Q1 sem filtro de INDR, porque BANCOS não tem INDR). → Carregar por código **um registro já excluído retorna vazio** (não dá para reabrir um excluído pelo código).
- **Params:** `:CODIGO` (`ftInteger`, `ptInput`) `[.dfm:L57-63]` — origem: `edtCodigo` / chave selecionada na pesquisa. (O `cdsMarcas` também declara um param `CODIGO ftInteger` `[.dfm:L13-19]`.)
- **Campos do dataset (`Required`):** **só `IDMARCA` é `Required=True`** `[.dfm:L22-25 e L64-68]`; `DESCRICAO` (Size=100), `INDR` (FixedChar, Size=1), `INDR_DATA`, `INDR_USUARIO` **não** são Required. → **alimenta BR-02**: a validação de obrigatórios do form-base (`ValidaObrigatorios`, percorre `Fields[i].Required`) **só cobra `IDMARCA`** — que é auto-gerado — logo, **na prática nada bloqueia o save por obrigatório** (DESCRICAO pode ir vazia).
- **Mutações:** leitura (Q1) + escrita (pipeline do provider, abaixo).
- **Tabelas / triggers / sequences tocadas:** `MARCAS` (CRUD). **Sem trigger.** PK via generator `ID_IDMARCA` (app-side).
- **SQL-alvo (Postgres, Kysely):**
  ```sql
  select idmarca, descricao, indr, indr_data, indr_usuario
  from marcas
  where coalesce(indr, 'I') <> 'E' and idmarca = $1
  ```
  Oracle→PG: `COALESCE` igual (já é padrão SQL; Oracle aqui **não** usa `NVL`). `TIMESTAMP(6)`→`timestamptz`, `NUMBER`→`integer`, `CHAR(1)`→`char(1)`.

### Q-PK — geração do `IDMARCA` (app-side generator) — `[.pas form-base:L1297]` ✅ (generator confirmado no Oracle)

- Como `SetaDataset(...,'IDMARCA','MARCAS', tcAutomatica)`, o form-base, ao inserir, faz `[.pas:L1295-1298]`:
  ```pascal
  cdsPrincipal.FieldByName('IDMARCA').Value := dmPrincipal.GetID('IDMARCA');
  ValorChavePrimaria := cdsPrincipal.FieldByName('IDMARCA').AsString;
  ```
  `GetID('IDMARCA')` → `BancoExecutando.PegaGenerator('IDMARCA', 1, FDConexao)` `[.pas dmPrincipal:L2586-2589]`. O nome do generator/sequence é derivado do campo → **`ID_IDMARCA`** (confirmado em `ALL_SEQUENCES`). Logo a PK é **sequencial, gerada pelo app antes do INSERT**, e o INSERT a lista explicitamente.
- **No alvo:** `seq_marcas_idmarca` no Postgres (`DEFAULT nextval`) — **paridade de resultado** (código sequencial auto-gerado, não digitado). Já implementado assim na migração (ver [Paridade](#paridade-com-o-novo)).

### Q-WRITE — pipeline de gravação/exclusão (provider FireDAC) — `[inferido — herda Bancos]`

- O provider gera **DML delta-based bindada** a partir do delta do `cdsPrincipal` em `ApplyUpdates(0)` (`UpdateMode=upWhereKeyOnly` → WHERE só pela PK). Por analogia direta com o piloto Bancos (mesmo motor, capturado em runtime lá), o esperado:
  ```sql
  -- INSERT (só colunas tocadas; IDMARCA vem do generator)
  insert into "MARCAS" ("IDMARCA","DESCRICAO") values (:1,:2)
  -- UPDATE de edição (só a coluna alterada; WHERE pela PK)
  update "MARCAS" set "DESCRICAO" = :1 where "IDMARCA" = :2
  -- exclusão = SOFT-DELETE (não DELETE físico — ver BR-04/seção 6):
  update "MARCAS" set "INDR" = :1, "INDR_USUARIO" = :2, "INDR_DATA" = :3 where "IDMARCA" = :4
  ```
- **Carimbo de auditoria = 2º statement separado** (literal, herdado de `SetaOperadorAlteracao`, [.pas:L472/479]), emitido **após** o insert/update:
  ```sql
  -- após INSERT (seta DTCADASTRO também, pois é inclusão):
  UPDATE MARCAS SET USULTALTERACAO=<op>, DTULTIMALTERACAO='<now>', DTCADASTRO='<now>' WHERE IDMARCA='<id>'
  -- após UPDATE de edição:
  UPDATE MARCAS SET USULTALTERACAO=<op>, DTULTIMALTERACAO='<now>' WHERE IDMARCA='<id>'
  ```
  ⚠️ Diferente de Bancos: aqui **esse UPDATE de carimbo NÃO dispara replicação** (não há `REM_MARCAS`). Há `USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO` na tabela (confirmado), então o carimbo **roda**.
- **Tabelas/triggers:** só `MARCAS`. **Zero trigger** → **zero escrita-fantasma de replicação** (a grande diferença para o piloto).
- **SQL-alvo (Postgres):** `insert/update` explícitos no repository; exclusão = `update marcas set indr='E', indr_usuario=$, indr_data=now() where idmarca=$`; carimbo de auditoria preenchido **no service** (mesma transação).

> **Regra de ouro:** Q1 (leitura) e a estrutura/`GET_MARCAS` estão **confirmadas no dicionário Oracle**. O **pipeline de escrita** (Q-WRITE) e a **pesquisa com filtro** (Q2) ainda são `[inferido]` (herdados do motor de Bancos) **até captura de runtime** (`V$SQL`) específica de MARCAS. **Não declarar paridade-verde sem isso** — ver [Lacunas](#lacunas--perguntas).

### Q2 — Pesquisa / listagem (`btnPesquisa` → `frmPesquisa` sobre `GET_MARCAS`) — `[estático]` + view confirmada

- **Origem:** form-base `TfrmCadMaster.btnPesquisaClick` `[.pas:L516]` abre `frmPesquisa` (`uPesquisa.pas`) sobre a **VIEW `GET_MARCAS`** (não a tabela crua). `FViewPesquisa = 'GET_' + FTabela = 'GET_MARCAS'` `[.pas:L1479-1486]`.
- **View `GET_MARCAS` — ✅ CONFIRMADA verbatim no Oracle (`ALL_VIEWS`):**
  ```sql
  SELECT
      M.IDMARCA CODIGO,
      M.DESCRICAO,
      M.INDR,
      M.INDR_DATA,
      M.INDR_USUARIO
  FROM MARCAS M
  ```
  Renomeia `IDMARCA`→**`CODIGO`** (alias para o grid de pesquisa). **Inclui** `INDR`/`INDR_DATA`/`INDR_USUARIO`. **Omite** o carimbo (`USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO`). A própria view **não** filtra soft-delete.
- **Filtro de soft-delete na pesquisa:** aplicado **fora da view**, pelo form-base — como a view `GET_MARCAS` **tem** a coluna `INDR`, `btnPesquisaClick` adiciona `(COALESCE(INDR, 'I') = 'I')` ao WHERE do grid `[.pas:L540-544]`. Logo, **a pesquisa esconde os excluídos** (mostra só ativos, salvo se `rdgAtivo`/F6 mudar — mas `MARCAS` não tem coluna `ATIVO`, então o ciclo de `rdgAtivo` por `FCampoAtivo` provavelmente não se aplica; o filtro de INDR é o que vale).
- **SQL final esperada (por analogia com Bancos, `[inferido]`):**
  ```sql
  select FORM from TABELA_CADASTRO where TABELA = 'GET_MARCAS'        -- config do form de pesquisa
  select Cast('F' as CHAR(1)) as Selecionar, Cast('T' as CHAR(1)) as Sel, GET_MARCAS.*
  from GET_MARCAS where (COALESCE(INDR,'I')='I') [ + filtro/ordem do usuário ]
  ```
- **Alvo:** `GET /cadastro/marcas?filtro=...` — lista paginada sobre o equivalente da view, **com o filtro `coalesce(indr,'I')='I'` aplicado na query** (não na view), espelhando o form-base.

---

## 5. Regras de negócio

| ID | Regra | Gatilho | Lógica (verbatim do legado) | *Porquê* | Procedência |
|---|---|---|---|---|---|
| BR-01 | **Permissão por form+ação (RBAC)** | ao gravar / ao excluir | `dmPrincipal.PossuiAcessoForm('frmCadMarcas','BTNGRAVAR')` (e `'BTNEXCLUIR'`/`'BTNEDITAR'`); sem permissão → cancela + exceção/alerta | RBAC data-driven por tela/ação | `[.pas form-base:L430, L392, L348]` |
| BR-02 | **Obrigatórios (efetivamente nenhum bloqueante)** | ao gravar | `ValidaObrigatorios(cdsPrincipal)` percorre `Fields[i].Required`; **só `IDMARCA` é Required** (auto-gerado). `DESCRICAO` **não** é Required (nem na coluna — `VARCHAR2(100)` NULL) → **save com descrição vazia é permitido** | a tela não exige descrição (o DB confirma: há linha real com `DESCRICAO=NULL`) | `[.dfm uDMCadMarcas:L22-29]` + `[.pas:L1718-1739]` + `[Oracle: DESCRICAO nullable]` |
| BR-03 | **PK automática por generator** | ao inserir | `IDMARCA := dmPrincipal.GetID('IDMARCA')` → generator `ID_IDMARCA` (não digitada, não trigger) | identidade sequencial estável | `[.pas:L1297]` + `[Oracle ALL_SEQUENCES: ID_IDMARCA]` |
| BR-04 | **Exclusão = SOFT-DELETE** | ao excluir | `MARCAS` **tem `INDR`** → `ExcluirRegistro` faz `INDR:='E'`, `INDR_USUARIO:=operador`, `INDR_DATA:=data servidor`; **NÃO** seta `ATIVO` (coluna não existe); `Post`→`ApplyUpdates` (UPDATE, não DELETE) | preservar histórico / não quebrar FKs de produtos que apontam a marca | `[.pas:L886-909]` + `[Oracle: INDR/INDR_USUARIO/INDR_DATA existem, ATIVO não]` |
| BR-05 | **Listagem/leitura escondem excluídos** | ao listar / carregar por código | filtro `COALESCE(INDR,'I') <> 'E'` (Q1) e `COALESCE(INDR,'I')='I'` (pesquisa) | excluído não reaparece nem por busca nem por código | `[.dfm Q1:L53]` + `[.pas:L543]` |
| BR-06 | **Carimbo de operador/data** | ao gravar | `SetaOperadorAlteracao(...)`: `USULTALTERACAO`=operador, `DTULTIMALTERACAO`=now; no **insert** também `DTCADASTRO`=now (flag `Status=dsInsert`) | autoria/auditoria | `[.pas:L472/479]` + `[Oracle: colunas existem]` |
| BR-07 | **Sem empresa/operador como FK** | ao gravar | `SetaDataset` chamado **sem** `PreencheEmpresa`/`PreencheOperador` (default `False`); `MARCAS` não tem `CODEMPRESA`/`CODOPERADOR` → flags off | marca é global ao tenant, não por empresa/filial | `[.pas:L50]` + `[Oracle: sem colunas CODEMPRESA/CODOPERADOR]` |

> **Sem cálculo, sem regra fiscal, sem máscara, sem CharCase.** É um cadastro de descrição pura — por isso é a herdeira mais barata. As "regras" são todas o **contrato do form-base** + a **presença de `INDR`** (que liga o soft-delete) + a **ausência de trigger** (que desliga a replicação). O *porquê* canônico do soft-delete: a marca é referenciada por produtos; apagar fisicamente quebraria a referência histórica.

---

## 6. Efeitos colaterais + estado externo

> A seção que salva da armadilha de acoplamento. Mesmo um CRUD de um campo lê/escreve estado fora do `.pas` da tela.

| Item | Tipo (lê/grava) | Alvo | Quem setou / quem consome | Mapeamento alvo |
|---|---|---|---|---|
| `dmPrincipal.FDConexao` | usa | conexão Oracle **global** | datamodule principal (boot) | conexão **por tenant** request-scoped ([hidden-coupling-traps.md](../../03-legacy-analysis/hidden-coupling-traps.md)) |
| `dmPrincipal.OperadorCODOPERADOR` | lê | operador logado | login | usuário no request context (fail-closed) |
| `dmPrincipal.PossuiAcessoForm` | lê | RBAC (tabela de permissões) | login/permissões | guard/policy por rota+ação |
| `dmPrincipal.GetID('IDMARCA')` | lê+consome | generator `ID_IDMARCA` | sequence Oracle | `nextval('seq_marcas_idmarca')` |
| `BancoExecutando.GetDataServidor` | lê | relógio do servidor Oracle | — | `now()` do Postgres (no service) |
| `USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO` | grava | colunas da própria `MARCAS` | `SetaOperadorAlteracao` (herdado) | colunas de auditoria preenchidas no service |
| `INDR`/`INDR_USUARIO`/`INDR_DATA` | grava | colunas da própria `MARCAS` | `ExcluirRegistro` (herdado) na exclusão | soft-delete no service |
| `HISTORICO_DINAMICO` | grava (indireto) | tabela de histórico genérica | `SetaHistorico_Dinamico` no gravar/excluir herdado **se `cdsHistorico_dinamico.Active`** | audit log / interceptor (decidir manter) |
| `TLog.GravaLog` | grava | log de aplicação | `btnGravarClick` herdado (try/except, best-effort) | logging estruturado |
| `MENUEXPRESS` | grava | telemetria de uso | ao abrir a tela: `ACESSOS=ACESSOS+1 WHERE FORMULARIO='FRMCADMARCAS'` (padrão do form-base; `[inferido]`) | métrica de uso (opcional) |
| **trigger `REM_MARCAS`** | **N/A — NÃO EXISTE** | — | — | **sem replicação** (≠ Bancos) `[Oracle ALL_TRIGGERS: zero triggers]` |

- **Conexão/transação:** usa a conexão **global** do `dmPrincipal` (risco de [transação atravessando telas](../../03-legacy-analysis/hidden-coupling-traps.md)). No alvo: transação **escopada** ao caso de uso (write de marca + carimbo numa só transação).
- **Ordem de abertura assumida:** presume login feito (operador/permissões em `dmPrincipal`). Precondição → contexto explícito no alvo.

> **A grande diferença para o piloto [Bancos](uCadBancos.md):** Bancos tem `REM_BANCOS` → cada I/U/D gera **escrita-fantasma de replicação** (fan-out por terminal, 15 linhas no teste). **MARCAS não tem trigger nenhuma** — confirmado no dicionário (`ALL_TRIGGERS` retornou vazio) — logo **não há outbox/replicação a replicar**. Isso é o que o app codificou como `replica: false` ([Paridade](#paridade-com-o-novo)). O que **sobra** de efeito é o **carimbo de auditoria** (3 colunas) + histórico dinâmico + log + telemetria — nenhum deles fiscal/crítico.

---

## 7. Dependências

| Dependência | Tipo | Como é usada | Vira (alvo) |
|---|---|---|---|
| `TfrmCadMaster` (`uCadMaster.pas`) | **herança** | todo o CRUD: gravar/editar/excluir/pesquisar/navegar, validação, soft-delete, carimbo, histórico, log, RBAC, teclado, máquina de estados | **engine CRUD reutilizável** (`/ds-create-crud` do DS, [ADR-014](../../00-orientation/canonical-decisions.md)) — no app: o pilar `CadMaster` + factory `createCrudController` |
| `TDMCadMarcas` (`uDMCadMarcas`) | datamodule | `sqqMarcas`→`dspMarcas`→`cdsMarcas` da tabela `MARCAS` (Q1 estática) | `MarcasRepository`/`marcasCrudConfig` (declarativo) sem estado |
| `udmPrincipal` (`dmPrincipal`) | datamodule global | conexão, operador, RBAC, `GetID`, histórico | tenant context + providers |
| `uPesquisa` (`frmPesquisa`) | form modal | pesquisa sobre `GET_MARCAS` (Q2) | serviço de listagem/filtro paginado |
| `FuncoesApollo` / `BancoExecutando` | units util | `SetaDataset`, `PegaGenerator`, `GetDataServidor`, `Mensagem` | utils/serviços compartilhados |
| FastReport (`frx*`), JVCL (`Jv*`) | libs | export/UI (herdado, não usado nesta tela) | export server-side / DS |

> **Não há datamodule duplicado** aqui (≠ Bancos, que tinha `DmOld`/variantes). Só o `uDMCadMarcas` ativo. Limpo.

---

## 8. TabOrder + mapa de atalhos/mnemônicos

**TabOrder (campos próprios, sequência exata `[.dfm]`):**

| Ordem | Controle | Campo | Tipo | Enter faz |
|---|---|---|---|---|
| 0 | `edtDescricao` | DESCRICAO | TDBEdit | avança (campo único) |

`[.dfm:L38]`. Antes deste, o foco inicial em modo busca é `edtCodigo` (PK, herdado) via `SetaDataset`. Em inclusão `tcAutomatica`, `edtCodigo` é limpo e o foco vai para `FControleFoco = edtDescricao` `[.pas:L302-303, L313]`.

**Mnemônicos `&` (Alt+letra) — campos próprios:** **NENHUM** no legado. `lblDescricao.Caption='Descricao'` **sem `&`** `[.dfm:L29]` (e o `TLabel` não tem `FocusControl` ligado). Os mnemônicos/atalhos vivem nos **botões herdados** do rodapé (ver abaixo). *(O app novo adiciona `&Descrição` — melhoria consciente, ver §2.)*

**Atalhos de botão (herdados do form-base — [form-base-cadmaster.md §4](../../03-legacy-analysis/recon/form-base-cadmaster.md)):**

| Botão | Caption | Mnemônico | Ação |
|---|---|---|---|
| `btnEditar` | `&Editar` | Alt+E | entra em edição |
| `btnExcluir` | `E&xcluir` | Alt+X | exclui (soft-delete, BR-04) |
| `btnGravar` | `&Gravar` | Alt+G | grava |
| `btnCancelar` | `&Sair` / `&Cancelar` | Alt+S / Alt+C | sai/cancela (caption alterna) |
| `btnAdicionarRegistro` | `&Adicionar` | Alt+A | novo registro |
| `btnOutros` | `&Outros` | Alt+O | popup `ppmBotaoOutros` |
| `rdgAtivo` | `Ati&vo [F6]` | Alt+V / **F6** | cicla filtro (N/A prático: MARCAS não tem `ATIVO`; o filtro efetivo é `INDR`) |

**Teclas funcionais/navegação (herdadas, `KeyPreview`/`FormKeyDown`):** **Esc** engolida durante insert/edit; **F6** cicla `rdgAtivo`; **Alt+O** abre "Outros"; **←/→** em `edtCodigo` = registro anterior/próximo; **↑/↓** = primeiro/último; **Enter** em `edtCodigo` = carrega pelo código; `edtCodigo` só aceita dígitos (PK inteira). Comum a todas as ~101 herdeiras → config-padrão do engine CRUD (ADR-010).

---

## 9. Casos de teste (golden)

> ⚠️ **Sem golden de runtime certificado para MARCAS.** Diferente de [Bancos](uCadBancos.md) (que tem captura `V$SQL`/`REMESSA_SERVER` de CODBCO=740), aqui só há **leitura do dicionário Oracle** (estrutura/view/triggers/sequence confirmadas) + o motor herdado de Bancos provado lá. Os casos abaixo são a **matriz a capturar** (mesma técnica do piloto — [dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md)), com a SQL **esperada** marcada conforme a procedência.

| ID | Cobre (BR/Q + caminho) | Input (estado + campos) | Ação | Output esperado | Procedência |
|---|---|---|---|---|---|
| G-01 | Q1 leitura (com filtro INDR) | abrir `IDMARCA` existente e ativo | carregar por código | retorna a linha; `SetaUltimaAlteracao` (join OPERADORES) preenche status bar | ✅ SQL confirmada (`.dfm` + Oracle) |
| G-02 | BR-03 + INSERT delta | adicionar; `descricao='TESTE'` | gravar novo | `IDMARCA` vem de `ID_IDMARCA`; `insert into "MARCAS"("IDMARCA","DESCRICAO") values(:1,:2)`; carimbo `UPDATE ... DTCADASTRO,DTULTIMALTERACAO`; **0 linhas de replicação** | `[inferido]` write + ✅ generator confirmado |
| G-03 | UPDATE delta | editar `descricao` | gravar | `update "MARCAS" set "DESCRICAO"=:1 where "IDMARCA"=:2`; carimbo `UPDATE ... USULTALTERACAO`; **0 replicação** | `[inferido]` (herda Bancos) |
| G-04 | BR-04 soft-delete | excluir registro com INDR | excluir | `update "MARCAS" set "INDR"='E', "INDR_USUARIO"=op, "INDR_DATA"=<servidor> where "IDMARCA"=:id` (**não** DELETE físico); **0 replicação** | ✅ lógica confirmada (`.pas:L886` + Oracle: INDR existe, ATIVO não) |
| G-05 | BR-05 esconde excluído | tentar carregar por código um `INDR='E'` | carregar | **vazio** (filtro `COALESCE(INDR,'I')<>'E'`) | ✅ SQL confirmada (`.dfm:L53`) |
| G-06 | Q2 pesquisa + filtro INDR | pesquisar | abrir pesquisa | `select FORM from TABELA_CADASTRO where TABELA='GET_MARCAS'` → `select Cast('F'..)Selecionar,Cast('T'..)Sel,GET_MARCAS.* from GET_MARCAS where (COALESCE(INDR,'I')='I')` | view ✅ confirmada; SQL do grid `[inferido]` |
| G-07 | BR-02 obrigatórios | adicionar; `descricao` **vazio** | gravar | **grava normal** (descrição vazia permitida; só `IDMARCA` é Required e é auto) — **não bloqueia** | ✅ confirmado (`.dfm` Required + Oracle nullable + linha real com DESCRICAO=NULL) |
| G-08 | BR-01 RBAC | operador sem `BTNGRAVAR` | gravar | bloqueado **antes do banco** (cancel + exceção), **zero DML** | ✅ lógica confirmada (`.pas:L430`) |

**Negativos/zero-DML:** G-07 (obrigatório — aqui **não** bloqueia, ao contrário de Bancos) e G-08 (RBAC — bloqueia antes do banco). 

---

## 10. Alvo (especificação de implementação)

**Backend (NestJS):**
- Módulo: `cadastro/marcas` (já implementado — **declarativo**, ver [Paridade](#paridade-com-o-novo)).
- Endpoints:
  | Método+rota | Origem | DTO (zod) | Mutação? |
  |---|---|---|---|
  | `GET /cadastro/marcas` | Q2 | filtro (lista filtra `coalesce(indr,'I')='I'`) | leitura |
  | `GET /cadastro/marcas/:idmarca` | Q1 | — | leitura (filtra `<>'E'`) |
  | `POST /cadastro/marcas` | btnGravar (insert) | `marcaSchema` | escrita (sem outbox) |
  | `PUT /cadastro/marcas/:idmarca` | btnGravar (update) | `atualizarMarcaSchema` | escrita |
  | `DELETE /cadastro/marcas/:idmarca` | btnExcluir | — | escrita = **soft-delete** (`indr='E'`) |
- Para o **service**: RBAC (BR-01) via guard `@RequerAcesso('FRMCADMARCAS', ...)`; carimbo operador/data (BR-06) no service; soft-delete (BR-04) no service; **sem outbox** (BR: sem trigger). PK por sequence (BR-03).
- Para o **DTO/zod**: `descricao` **opcional**, `max(100)` (BR-02 — fiel ao legado, **sem** "obrigatório"). Sem uppercase forçado (sem `CharCase` no legado).
- Tenant: conexão global → conexão por tenant; operador do request context (fail-closed).

**Frontend (React — via `CadMaster`/engine CRUD, espírito `/ds-create-crud`, ADR-014):**
- Rota `/cadastro/marcas` (lista) + `/cadastro/marcas/:idmarca` (form de 1 campo).
- Campo único `Descrição` (taborder 0); atalhos de botão herdados do engine.
- Decisão consciente: app adiciona mnemônico `&Descrição` (Alt+D) que o legado não tinha — melhoria, não quebra paridade (ADR-010 é piso).

**Decisões offline (PDV/Electron):** N/A direto — cadastro de marca roda na **retaguarda/nuvem**. **Sem replicação** (sem `REM_MARCAS`), então não há delta de sync a preservar (≠ Bancos). Se marca alimentar a carga inicial do PDV (via produto), o delta vem pela entidade produto, não por MARCAS isolada.

---

## Paridade com o novo

A tela **já está implementada declarativamente** no app (`/Library/Apollo/apps`), espírito ADR-014 — uma `CrudConfig` em vez do vertical de 6 arquivos:

- **Backend:** `/Library/Apollo/apps/api/src/modules/cadastro/marcas.crud.ts` — `marcasCrudConfig`:
  ```ts
  { tabela: 'marcas', pk: 'idmarca', view: 'get_marcas', colunas: ['descricao'],
    rbacForm: 'FRMCADMARCAS', colunasPesquisa: ['codigo','descricao'],
    softDelete: true,   // excluir → INDR='E' (BR-04/BR-05) ✅ fiel
    replica: false }    // MARCAS não tem trigger REM ✅ fiel (Oracle confirma zero triggers)
  ```
  `createCrudController({ path: 'cadastro/marcas', schema: marcaSchema, ... })` herda do engine (auditoria, soft-delete, RBAC, view de listagem).
- **Schema:** `/Library/Apollo/packages/shared/src/schema/marca.schema.ts` — `descricao: z.string().trim().max(100).optional()` (✅ fiel a BR-02: não-obrigatório, max 100; o comentário do arquivo já cita o branch de soft-delete do form-base).
- **Frontend:** `/Library/Apollo/apps/web/src/features/marcas/MarcasCadMaster.tsx` — `<CadMaster titulo="Marcas" resourcePath="cadastro/marcas" pk="idmarca" viewPk="codigo" .../>` com o campo `&Descrição`; toda máquina de estados/teclado/carregar-por-código vem do pilar `CadMaster`.
- **Migração:** `/Library/Apollo/apps/api/migrations/006_marcas.sql` — `seq_marcas_idmarca` (BR-03 ✅), 8 colunas espelhando o Oracle (✅), `view get_marcas` com alias `codigo` (✅ idêntico à view real), e o comentário **"Sem trigger REM (não replica)"** (✅). Concede `permissoes` para `FRMCADMARCAS`.

> 🟡 **Status de paridade: FIEL-POR-CONSTRUÇÃO, não certificado em runtime.** A implementação espelha corretamente os achados deste dossiê (soft-delete, sem replicação, PK por sequence, descrição opcional, view com alias). **MAS não há golden de runtime do legado MARCAS** rodando contra o novo — **só [Bancos](uCadBancos.md) tem golden certificado** (captura `V$SQL`/`REMESSA_SERVER`). Portanto MARCAS **não pode ser marcada `paridade-verde`/`concluído`** pelos critérios de [dossier-process.md](../dossier-process.md): falta a etapa 3 (harness com golden capturado) e a 2ª revisão independente. A confiança atual vem de: (a) dicionário Oracle confirmado read-only, (b) o motor `TfrmCadMaster`/FireDAC já provado em runtime no piloto, (c) a config declarativa que reusa esse motor.

---

## Lacunas / perguntas

1. **Golden de runtime de MARCAS não capturado** — o pipeline de escrita (Q-WRITE: INSERT/UPDATE/soft-delete delta-based + carimbo) e a SQL final da pesquisa (Q2 com filtro/ordem) estão `[inferido]` (herdados do motor de Bancos). Capturar via `V$SQL` exercitando a tela legada (criar+editar+excluir 1 marca), mesma técnica do piloto. **Bloqueia `paridade-verde`.**
2. **2ª revisão independente** pendente (etapa 2 do loop) — outro agente deve auditar dossiê + código contra o `.pas`.
3. **Mnemônico `&Descrição` (Alt+D)** é melhoria do app, ausente no legado — confirmar com produto que adicionar mnemônico onde o legado não tinha é aceitável (provável sim; ADR-010 é piso de paridade, não teto).
4. **`HISTORICO_DINAMICO` e telemetria `MENUEXPRESS`** — herdados do form-base, disparam em gravar/excluir **se ativos**; **não implementados** no app. Decidir manter/descartar (mesma pendência aberta de Bancos).
5. **`rdgAtivo`/F6** — o ciclo de filtro Ativo do form-base depende de `FCampoAtivo`/coluna `ATIVO`, que **MARCAS não tem**. O filtro efetivo é por `INDR`. Confirmar em runtime que F6 é inócuo aqui (não cicla nada visível) — provável.
6. **Carimbo de auditoria** (`USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO`) — confirmar em runtime que o 2º statement de `SetaOperadorAlteracao` roda igual em MARCAS (esperado sim, colunas existem; sem replicação a reboque, ao contrário de Bancos).

## Ver também

- [dossier-template.md](../dossier-template.md) · [dossier-process.md](../dossier-process.md)
- [uCadBancos.md](uCadBancos.md) — o piloto (único com golden de runtime certificado); MARCAS é o "espelho invertido": **tem** soft-delete, **não tem** replicação.
- [../../03-legacy-analysis/recon/form-base-cadmaster.md](../../03-legacy-analysis/recon/form-base-cadmaster.md) — o contrato do `TfrmCadMaster` (engine CRUD) que esta tela herda quase por inteiro.
- [../../03-legacy-analysis/dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md) — como fechar as seções 4 e 9 (capturar o runtime de MARCAS).
- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — ADR-008/010/011/012/014.
