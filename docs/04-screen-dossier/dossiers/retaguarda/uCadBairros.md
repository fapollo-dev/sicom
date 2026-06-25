# Dossiê — `frmCadBairro` (Cadastro de Bairros)

| Campo | Valor |
|---|---|
| **Status** | **`em-revisão`** — tela **NOVA** de manutenção sobre a tabela real `BAIRRO` (existe no Oracle, **vazia**), **sem form Delphi de origem**. Implementada **declarativamente** no app (`bairro.crud.ts` + `BairrosCadMaster.tsx` + migração `010_bairro.sql`), fiel-por-construção ao contrato do engine CRUD. **NÃO `concluído`**: não é port de legado (não há golden de runtime de tela legada — N/A), e o decode de `REGIAO` é **decisão nossa** (não paridade); pendências em [Lacunas](#lacunas--perguntas). |
| **Autor / Revisor** | Analista de Legado (Claude) / *pendente — revisor independente ([../../08-agents/review-loop.md](../../08-agents/review-loop.md))* |
| **Versão do dossiê** | v0 (tela nova — sem `.pas`/`.dfm` de origem) |
| **Data** | 2026-06-25 |
| **Commit do legado analisado** | `/Library/SicomGit/retaguarda-master` (branch `*-master`, sem hash versionado) — **sem form de Bairros**; usado só para o contexto de `BAIRRO` como texto livre (`PARCEIROS_END`/`uCadClientes`) |

> **O que torna esta tela atípica:** **não existe tela Delphi de Bairros no legado.** Existe a **tabela `BAIRRO` real** no Oracle de homologação (`pinheirao@dbhomologacao`), porém **vazia** e **sem `.pas`/`.dfm`** que a edite, e **sem view `GET_BAIRRO`** nos fontes. No legado, "bairro" é **texto livre digitado** no endereço do parceiro (`PARCEIROS_END.BAIRRO VARCHAR2(50)`, `TDBEdit` em `uCadClientes`), **não** uma FK para a tabela `BAIRRO`. Portanto este dossiê **não é a migração de um form** — é a **especificação de uma tela nova** de manutenção sobre uma tabela existente, usando o engine CRUD (pilar `CadMaster`, ADR-014) como exercício do palette **texto + combo + flag**.
>
> ⚠️ **Limite e honestidade de procedência:** como **não há form legado**, todas as linhas de "handler `.pas`", "SQL do `.dfm`" e "golden capturado do legado rodando" são **N/A — sem tela de origem**, e estão marcadas assim (não inventadas). O que existe de concreto é: **(a)** o **dicionário Oracle** da tabela `BAIRRO` `[Oracle-dict]` (confirmado: existe, vazia, com as colunas abaixo); **(b)** o uso de `BAIRRO` como **texto livre** no legado `[.dfm]` (contexto, não origem); **(c)** a **implementação nova** `[impl]` (migração + zod + crud config + tela React + smoke). O decode de `REGIAO` é **inferência/decisão nossa** `[inferido]`, não paridade.
>
> **Procedência usada neste dossiê:** `[Oracle-dict]` = dicionário Oracle read-only da tabela real `BAIRRO`/uso de `BAIRRO` em `PARCEIROS_END`; `[impl]` = código novo do app (verbatim); `[inferido]` = decisão/interpretação nossa (sem base em legado). **Não há** `[.pas:L…]`/`[runtime]` de tela de Bairros porque **a tela não existe no legado**.

---

## 1. Identidade

| Campo | Valor |
|---|---|
| **Form (`.pas` / `.dfm`)** | **N/A — não existe form Delphi de Bairros no legado** (busca em `/Library/SicomGit/retaguarda-master/fonte/Units`: zero `uCadBairro*.pas`/`.dfm`, zero `frmCadBairro`, zero view `GET_BAIRRO`). Esta é uma **tela NOVA**. `[Oracle-dict]` (ausência confirmada nos fontes) |
| **Classe do form** | **N/A no legado.** No alvo: herdeira declarativa do pilar `<CadMaster>` (engine CRUD, ADR-014) — equivalente ao que `TfrmCadMaster` daria a um form herdeiro, mas **sem** `.pas`/`.dfm` de origem. Form RBAC novo: **`FRMCADBAIRRO`** `[impl]` |
| **Módulo de domínio** | `cadastro` (cadastro de apoio: bairro normalizado, com cidade (FK lógica) e região (combo)) |
| **Função no negócio** | CRUD de **bairros normalizados**: o operador cria/edita/exclui um bairro com **descrição**, **região** (combo de zona urbana), **ativo** (flag S/N) e **cidade** (lookup/FK opcional). Objetivo: substituir o "bairro" hoje **digitado à mão** no endereço por um cadastro **controlado** (ver [contraste com o legado](#contraste-com-o-legado-bairro-como-texto-livre)). |
| **Frequência / criticidade** | **baixa** frequência (cadastro de apoio, tabela hoje **vazia**), **baixa** criticidade. **Não** é caminho de PDV. **Não** toca fiscal. |
| **Rota-alvo (web)** | `/cadastro/bairros` (lista) · `/cadastro/bairros/:idbairro` (edição) — recurso `cadastro/bairros` (já implementado, ver [Paridade com o novo](#paridade-com-o-novo-implementação)) `[impl]` |
| **Casca-alvo** | `browser` — tela de retaguarda, sem device, sem teclas reservadas críticas. (Electron só se entrar no pacote power-user; sem requisito próprio.) `[inferido]` |

> **Declaração obrigatória:** esta é uma **tela NOVA de manutenção sobre a tabela real `BAIRRO`** (existe no Oracle, **vazia**); **SEM form Delphi de origem**. Não confundir com um port: não há `.dfm`/`.pas`/`GET_BAIRRO`/golden de legado a espelhar. O que se espelha do legado é apenas a **estrutura da tabela** `[Oracle-dict]` e o padrão de colunas (soft-delete `INDR`, carimbo) comum às demais (ver [Marcas](uCadMarcas.md)).

---

## 2. UI — inventário de componentes (`.dfm` → React)

**N/A — não há `.dfm` de origem.** Não existe layout absoluto `Left/Top` a refluir nem árvore de controles VCL a mapear, porque **não há form legado**. A UI abaixo é **desenho novo** `[impl]`, construído sobre o pilar `<CadMaster>` (que injeta o chrome equivalente ao form-base: cabeçalho com código+Pesquisa, navegador, rodapé de ações, status bar). Os controles **próprios** da tela são os campos do formulário em `BairrosCadMaster.tsx`:

| Controle (alvo) | Componente React (DS) | Caption/label (com `&`) | Campo (DataField) | Bind | Nota de layout |
|---|---|---|---|---|---|
| Descrição | `<Field>` (texto, 100 chars) | `&Descrição` (Alt+D) | `DESCRICAO` | `form.register('descricao')` | grid: `sm:col-span-2` (largo), linha 1 |
| Região | `<SelectField>` (combo) | `&Região` (Alt+R) | `REGIAO` | `Controller name="regiao"`, opções `REGIAO_BAIRRO` | grid col 1, placeholder "Selecione a região…" |
| Ativo | `<SelectField>` (combo S/N) | `&Ativo` (Alt+A) | `ATIVO` | `Controller name="ativo"`, opções `ATIVO_SN`, default `'S'` | grid col 2 |
| Cidade | `<SelectField>` (lookup/FK) | `&Cidade` (Alt+C) | `IDCIDADE` | `Controller name="idcidade"`, opções de `cadastro/cidades` via `useResourceOptions` | grid `sm:col-span-2` (largo), placeholder "Selecione a cidade…" |

`[impl: apps/web/src/features/bairros/BairrosCadMaster.tsx:L38-90]`

**Herdados do pilar `<CadMaster>` (equivalente ao chrome do form-base):** campo de código/lookup da PK (`IDBAIRRO`), botão/ação de Pesquisa (sobre a view `get_bairro`), navegação de registros, botões de ação (Gravar/Cancelar/Editar/Excluir/Adicionar), filtro de situação (F6), status bar. `[impl: shared/cadmaster/CadMaster]`

**Notas de layout (não há reflow de legado):** como **não existe `.dfm`**, não se copia pixel nem `TPanel`/`TGroupBox` legados — o layout é grid fluido novo (`grid-cols-1 sm:grid-cols-2`, `gap-form-gap`). A coluna `IDCIDADE` é um **lookup para outra entidade** (`cadastro/cidades`), carregada por `useResourceOptions` — não vive nesta fatia de dados. `[impl]`

> **Achado (combo de região é construção nossa):** `REGIAO` no Oracle é só um código `VARCHAR2(2)` sem domínio definido em lugar nenhum do legado `[Oracle-dict]`. O combo `REGIAO_BAIRRO` (Centro/Norte/Sul/Leste/Oeste/Nordeste/Sudeste/Noroeste/Sudoeste) é **decisão de UI nossa** `[inferido — impl]`, não a réplica de um combo legado. Registrar como **decisão**, não paridade (ver BR-03/§5 e [Lacunas](#lacunas--perguntas)).

---

## 3. Eventos

**N/A — não há handlers `.pas` de origem** (a tela não existe no legado). Não há `FormCreate`/`btnGravarClick`/`BeforePost` de Bairros para ler. Abaixo, os "eventos" são o **comportamento do engine** que a tela nova herda do pilar `<CadMaster>`/`createCrudController` `[impl]` — análogo ao que `TfrmCadMaster` faria, mas sem código próprio da tela:

| Componente.Evento (alvo) | Origem | O que faz (passo a passo) | Toca SQL? | Toca estado externo? | Mapeamento |
|---|---|---|---|---|---|
| montagem da tela | `[impl: BairrosCadMaster.tsx:L19-24]` | monta `<CadMaster resourcePath="cadastro/bairros" pk="idbairro">`; pré-carrega opções de cidade via `useResourceOptions('cadastro/cidades')` | leitura (lookup cidades) | — | bind do recurso `/cadastro/bairros` |
| carregar por código (Enter no código) | engine `read()` `[impl: crud-engine.service.ts:L32-42]` | `select * from bairro where idbairro=$1 and coalesce(indr,'I')<>'E'` | sim (Q1) | lê tenant context | `GET /cadastro/bairros/:id` |
| Gravar (Alt+G) — inclusão | engine `create()` `[impl: crud-engine.service.ts:L96-120]` | delta das colunas → `insert into bairro(...) returning idbairro` (PK por sequence) → `stamp` (carimbo) → histórico → (sem outbox) | sim (Q-WRITE) | grava carimbo + histórico (§6) | `POST /cadastro/bairros` |
| Gravar (Alt+G) — edição | engine `update()` `[impl: crud-engine.service.ts:L122-137]` | lê estado anterior → `update bairro set <delta> where idbairro=$` → `stamp` → histórico (diff) | sim (Q-WRITE) | grava carimbo + histórico (§6) | `PUT /cadastro/bairros/:id` |
| Excluir (Alt+X) | engine `remove()` `[impl: crud-engine.service.ts:L139-154]` | **soft-delete**: `update bairro set indr='E', indr_usuario=op, indr_data=now() where idbairro=$` (não DELETE físico) | sim (Q-WRITE) | grava histórico DELETE (§6) | `DELETE /cadastro/bairros/:id` |
| Pesquisa (filtro/F6) | engine `list()` `[impl: crud-engine.service.ts:L44-94]` | `select * from get_bairro` + filtro situação (F6) + campo/operador/valor (whitelist) + ordenação + `limit` | sim (Q2) | lê tenant context | `GET /cadastro/bairros?campo=&operador=&valor=` |

> Não há "evento próprio escondendo regra" porque **não há `.pas` próprio** — toda a lógica é o contrato do engine (declarativo). O que no legado seria `BeforePost`/`SetaOperadorAlteracao`/`ExcluirRegistro` aqui é, respectivamente, `derivados()`/`stamp()`/`remove(softDelete)` do engine `[impl]`.

---

## 4. Dados — TODA query

> **SQL de origem (`.dfm`/`.pas`/`GET_BAIRRO`): N/A — não existe no legado.** A busca nos fontes não achou `TFDQuery`/view de Bairros. O que existe de concreto: **(a)** a **estrutura da tabela real** `[Oracle-dict]`; **(b)** as queries que o **engine novo** roda `[impl]` (Q1/Q2/Q-WRITE), reconstruídas a partir do código do engine, não de SQL legada.

### Estrutura da tabela `BAIRRO` — ✅ CONFIRMADA `[Oracle-dict]` (tabela real, **vazia**)

| Coluna | Tipo Oracle | Papel | → Postgres (alvo) `[impl: migrations/010_bairro.sql]` |
|---|---|---|---|
| `IDBAIRRO` | `NUMBER` | PK | `integer PRIMARY KEY DEFAULT nextval('seq_bairro_idbairro')` |
| `DESCRICAO` | `VARCHAR2(100)` | descrição do bairro | `varchar(100)` (nullable) |
| `ATIVO` | `CHAR/VARCHAR2(1)` | flag S/N (editável, **≠** soft-delete) | `varchar(1) DEFAULT 'S'` |
| `REGIAO` | `VARCHAR2(2)` | **código** de região (domínio **não definido** no legado) | `varchar(2)` (decode na view — decisão nossa) |
| `IDCIDADE` | `NUMBER` | FK lógica p/ `CIDADE` (lookup) | `integer` (nullable) |
| `INDR` (+`INDR_USUARIO`, `INDR_DATA`) | `CHAR(1)`/`NUMBER`/`TIMESTAMP(6)` | soft-delete (`'E'`=excluído) + autoria/data da exclusão | `char(1)` / `integer` / `timestamptz` |
| `USULTALTERACAO` / `DTULTIMALTERACAO` / `DTCADASTRO` | `NUMBER` / `TIMESTAMP(6)` / `TIMESTAMP(6)` | carimbo de auditoria | `integer` / `timestamptz` / `timestamptz` |

- **Estado no Oracle:** tabela **existe e está VAZIA** `[Oracle-dict]` — não há dados a migrar, e a aplicação nova faz **seed próprio** (4 linhas, ver Q-WRITE/seed).
- **Triggers:** **NENHUMA de replicação** (`REM_BAIRRO` não existe) → `replica: false` `[impl: bairro.crud.ts:L18]`. (Sem tela legada, não há outbox a replicar — igual ao caso [Marcas](uCadMarcas.md).)
- **PK:** no Oracle, `NUMBER` (geração não observável — tabela vazia, sem tela). No alvo: **sequence** `seq_bairro_idbairro` via `DEFAULT nextval` `[impl]`. **Decisão nossa** (não há `GetID`/generator legado observado para Bairros).
- **`ATIVO` vs `INDR`:** **dois conceitos distintos** — `ATIVO` é um **campo editável S/N** (atributo do bairro); `INDR='E'` é o **soft-delete** (exclusão). A tela edita `ATIVO`; o engine usa `INDR` para excluir/filtrar. `[impl: migrations/010_bairro.sql:L13-16]`

### Q1 — leitura de 1 registro por código (engine `read`) — `[impl]`

- **Origem:** engine `CrudEngineService.read()` `[impl: crud-engine.service.ts:L32-42]`. **Sem `.dfm` de origem** (N/A legado).
- **Quando dispara:** carregar/editar um bairro pelo código (`GET /cadastro/bairros/:id`).
- **SQL-alvo (Postgres, Kysely → SQL efetiva):**
  ```sql
  select * from bairro
  where idbairro = $1
    and coalesce(indr, 'I') <> 'E'      -- softDelete: não reabre excluído (paridade BR-04/G-05)
  ```
- **Fragmentos condicionais:** `if cfg.softDelete → + and coalesce(indr,'I')<>'E'` (ativo para Bairros). `if cfg.empresaScoped → + and idempresa=:emp` — **não** aplicado (Bairro não é `empresaScoped`). `[impl: L38-40]`
- **Params:** `$1` = `idbairro` (da rota). Leitura.
- **Tabelas/triggers/sequences:** `bairro` (leitura). Sem trigger.

### Q2 — Pesquisa/listagem (engine `list`) sobre a view `get_bairro` — `[impl]`

- **Origem:** engine `CrudEngineService.list()` `[impl: crud-engine.service.ts:L44-94]` sobre a **view nova `get_bairro`** `[impl: migrations/010_bairro.sql:L29-48]`. **Não existe `GET_BAIRRO` no legado** (N/A) — a view é nossa.
- **View `get_bairro` (verbatim do alvo) — decodifica `REGIAO` (decisão nossa):**
  ```sql
  CREATE OR REPLACE VIEW get_bairro AS
  SELECT idbairro, descricao, ativo, idcidade,
    CASE regiao
      WHEN 'C'  THEN 'CENTRO'  WHEN 'N'  THEN 'NORTE'    WHEN 'S'  THEN 'SUL'
      WHEN 'L'  THEN 'LESTE'   WHEN 'O'  THEN 'OESTE'    WHEN 'NL' THEN 'NORDESTE'
      WHEN 'SL' THEN 'SUDESTE' WHEN 'NO' THEN 'NOROESTE' WHEN 'SO' THEN 'SUDOESTE'
      ELSE '' END AS regiao,
    indr
  FROM bairro;
  ```
  ⚠️ Esse `CASE`/decode é **interpretação NOSSA** do código `REGIAO` `[inferido — impl]` — **não** a cópia de uma view legada (não há). Como em `get_marcas`: a view **não pré-filtra `INDR`** e **expõe `indr`**; o engine aplica a situação.
- **SQL-alvo (Postgres) com todos os caminhos do engine:**
  ```sql
  select * from get_bairro
  -- filtro situação (F6): ativos → coalesce(indr,'I')='I' ; inativos → ='E' ; todos → (sem filtro)
  [ where coalesce(indr,'I') = 'I' ]
  -- filtro campo+operador (campo SEMPRE em whitelist colunasPesquisa = idbairro,descricao,regiao,ativo)
  [ and upper(<campo>) like '%<valor>%'   -- operador 'contem' (default); 'comeca' → '<valor>%'
    | and <campo> = <valor>               -- 'igual'/'diferente'/'maior'/'menor' ]
  [ order by <orderBy> asc|desc ]
  limit least(<limite|200>, 500)
  ```
- **Fragmentos condicionais (todos):** `[impl: L51-92]`
  | Condição (engine) | Fragmento |
  |---|---|
  | `situacao='ativos'` (default) | `+ coalesce(indr,'I')='I'` |
  | `situacao='inativos'` | `+ coalesce(indr,'I')='E'` |
  | `situacao='todos'` (`incluirExcluidos`) | (sem filtro de situação) |
  | `campo∈whitelist & valor` + `operador='contem'` | `+ upper(<campo>) like '%<v>%'` |
  | `operador='comeca'` | `+ upper(<campo>) like '<v>%'` |
  | `operador='igual'/'diferente'/'maior'/'menor'` | `+ <campo> <op> <v>` |
  | `orderBy∈whitelist` | `order by <campo> asc/desc` |
- **Params:** `campo`/`operador`/`valor`/`situacao`/`orderBy`/`orderDir`/`limite` (query string). **Anti-injection:** `campo`/`orderBy` **só** se em `colunasPesquisa` `[impl: L62,L88]`. Leitura.
- **Tabelas:** view `get_bairro` (sobre `bairro`).

### Q-WRITE — gravação/exclusão (engine `create`/`update`/`remove`) — `[impl]`

- **Origem:** engine `CrudEngineService` `[impl: crud-engine.service.ts:L96-167]`, numa **transação** por operação. **Sem pipeline de provider legado** (N/A — não há tela).
- **INSERT (inclusão):** delta só das `colunas` (`descricao, regiao, ativo, idcidade`); PK pela sequence:
  ```sql
  insert into bairro (descricao, regiao, ativo, idcidade) values ($1,$2,$3,$4) returning idbairro;
  -- carimbo (statement separado, stamp(), isInsert=true):
  update bairro set usultalteracao=$op, dtultimalteracao=now(), dtcadastro=now() where idbairro=$id;
  ```
- **UPDATE (edição):** lê estado anterior (diff p/ histórico) → grava delta → carimbo (sem `dtcadastro`):
  ```sql
  update bairro set <colunas alteradas> where idbairro=$id;
  update bairro set usultalteracao=$op, dtultimalteracao=now() where idbairro=$id;
  ```
- **DELETE = soft-delete** (porque `softDelete:true`):
  ```sql
  update bairro set indr='E', indr_usuario=$op, indr_data=now() where idbairro=$id;
  ```
- **Histórico:** `gravarHistorico`/`gravarHistoricoMarca` em `HISTORICO_DINAMICO` em toda I/U/D (`historico !== false`) `[impl: L116,134,151]`.
- **Outbox/replicação:** **não** (`replica:false`) — `if cfg.replica` nunca dispara `[impl: L117,135,152]`. Sem escrita-fantasma de replicação.
- **Seed inicial (migração):** 4 linhas `[impl: migrations/010_bairro.sql:L51-55]`:
  ```sql
  INSERT INTO bairro (descricao, ativo, regiao) VALUES
    ('CENTRO','S','C'), ('JARDIM AMERICA','S','S'), ('VILA NOVA','S','N'), ('SANTA CRUZ','S','L');
  ```
- **Tabelas/triggers/sequences:** `bairro` (CRUD) + `seq_bairro_idbairro` (PK) + `historico_dinamico` (audit). **Sem trigger.**

> **Regra de ouro / honestidade:** **nada aqui foi capturado de um legado rodando** — não há legado de Bairros. Q1/Q2/Q-WRITE são `[impl]` (a SQL que o **engine novo** emite, lida do código), **não** SQL Oracle reconstruída de um `.dfm`. A estrutura da tabela é `[Oracle-dict]`. O decode de `REGIAO` é `[inferido]`. Por isso **não há "SQL real observada" de legado** na seção 9 — só resultado do **novo** (smoke).

---

## 5. Regras de negócio

> **Sem regra legada de tela** (não há `.pas`). As regras abaixo são **(a)** contrato do engine `[impl]`, **(b)** estrutura da tabela `[Oracle-dict]`, **(c)** decisões nossas `[inferido]`. Nenhuma é cálculo fiscal/financeiro.

| ID | Regra | Gatilho | Lógica | *Porquê* | Procedência |
|---|---|---|---|---|---|
| BR-01 | **Permissão por form+ação (RBAC)** | gravar/excluir/editar/adicionar | guard sobre `FRMCADBAIRRO` + ação (`BTNGRAVAR`/`BTNEXCLUIR`/`BTNEDITAR`/`BTNADICIONARREGISTRO`); permissões semeadas na migração | RBAC data-driven por tela/ação (padrão de toda herdeira) | `[impl: migrations/010_bairro.sql:L57-61]` + engine |
| BR-02 | **Obrigatórios: nenhum bloqueante** | ao gravar | `bairroSchema`: `descricao`/`regiao`/`ativo`/`idcidade` **todos `.optional()`** → grava com campos vazios | fiel à tabela: `DESCRICAO` é nullable no Oracle (como Marcas); sem exigência de negócio | `[impl: bairro.schema.ts:L27-36]` + `[Oracle-dict: DESCRICAO VARCHAR2(100) null]` |
| BR-03 | **`REGIAO` é código `VARCHAR2(2)` com domínio NOSSO** | ao gravar/listar | zod `enum(['C','N','S','L','O','NL','SL','NO','SO'])`; view decodifica p/ nome (Centro…Sudoeste) | **decisão/inferência nossa**: o legado **não define** o domínio de `REGIAO` em lugar nenhum → o decode C/N/S/L/O/NL/SL/NO/SO é interpretação de zona urbana, **não paridade** | `[inferido]` + `[impl: bairro.schema.ts:L10-20, migrations/010_bairro.sql:L35-46]` |
| BR-04 | **Exclusão = SOFT-DELETE (`INDR`)** | ao excluir | `softDelete:true` → `update bairro set indr='E', indr_usuario=op, indr_data=now()` (não DELETE físico) | preservar histórico / não quebrar referências; padrão das herdeiras com `INDR` (como Marcas) | `[impl: bairro.crud.ts:L17, crud-engine.service.ts:L142-147]` + `[Oracle-dict: INDR/INDR_USUARIO/INDR_DATA existem]` |
| BR-05 | **Leitura/listagem escondem excluídos** | carregar por código / pesquisar | Q1: `coalesce(indr,'I')<>'E'`; Q2: situação default `ativos` = `coalesce(indr,'I')='I'` (F6 alterna ativos/inativos/todos) | excluído não reaparece por código nem por busca (salvo "todos") | `[impl: crud-engine.service.ts:L38, L53-58]` |
| BR-06 | **Carimbo de operador/data** | ao gravar | `stamp()`: `usultalteracao`=op, `dtultimalteracao`=now; no **insert** também `dtcadastro`=now | autoria/auditoria (colunas existem na tabela real) | `[impl: crud-engine.service.ts:L156-167]` + `[Oracle-dict]` |
| BR-07 | **`ATIVO` (S/N) ≠ soft-delete** | ao gravar | `ativo` é flag editável `enum('S','N')` default `'S'`; **não** é o `INDR` | a tabela tem **as duas** colunas; `ATIVO` é atributo do bairro, `INDR` é exclusão | `[impl: bairro.schema.ts:L33, migrations/010_bairro.sql:L13,16]` + `[Oracle-dict]` |
| BR-08 | **`IDCIDADE` = lookup/FK opcional** | ao gravar | `idcidade` opcional, `int positivo`; FK lógica para `CIDADE`; FK inexistente → erro 409 PT (`REGISTRO_RELACIONADO_INEXISTENTE`, não 500) | bairro pode não ter cidade; e referência inválida deve falhar com motivo real (ADR-015) | `[impl: bairro.schema.ts:L35, smoke.ts:L162-174]` |
| BR-09 | **PK por sequence (não digitada)** | ao inserir | `pkGerada` default → `insert … returning idbairro`; `DEFAULT nextval('seq_bairro_idbairro')` | identidade sequencial estável (decisão nossa; sem generator legado observado) | `[inferido]` + `[impl: crud-engine.service.ts:L107-114, migrations/010_bairro.sql:L8,11]` |

> **Sem cálculo, sem regra fiscal, sem máscara.** A única "regra de paridade" real seria a estrutura da tabela `[Oracle-dict]` (soft-delete + carimbo + nullable). `REGIAO` decodificada e a própria existência da tela são **decisões nossas** `[inferido]`, **não** paridade com legado. O *porquê* canônico do soft-delete: bairro normalizado será referenciado por endereços; apagar fisicamente quebraria a referência.

---

## 6. Efeitos colaterais + estado externo

> A seção que salva da armadilha de acoplamento. Mesmo sem `.pas` legado, a tela nova lê/escreve estado externo via engine.

| Item | Tipo (lê/grava) | Alvo | Quem setou / quem consome | Mapeamento alvo |
|---|---|---|---|---|
| `currentTenant()` (operador) | lê | tenant context (request-scoped) | login/middleware | operador do request (fail-closed) `[impl: crud-engine.service.ts:L97,123,140]` |
| `currentTenant()` (empresa) | lê | tenant context | login | **não** usado p/ Bairro (não é `empresaScoped`) — bairro é global ao tenant |
| RBAC `FRMCADBAIRRO` | lê | tabela `permissoes` | seed da migração | guard/policy por rota+ação `[impl: migrations/010_bairro.sql:L57-61]` |
| `seq_bairro_idbairro` | consome | sequence Postgres | migração | `nextval` no insert `[impl]` |
| `usultalteracao`/`dtultimalteracao`/`dtcadastro` | grava | colunas da própria `bairro` | `stamp()` | carimbo no service (mesma transação) |
| `indr`/`indr_usuario`/`indr_data` | grava | colunas da própria `bairro` | `remove()` soft-delete | soft-delete no service |
| `HISTORICO_DINAMICO` | grava (indireto) | tabela de histórico genérica | `gravarHistorico` em I/U/D | audit log (engine) |
| `CIDADE`/`cadastro/cidades` | lê | outra entidade (lookup FK) | recurso `cadastro/cidades` via `useResourceOptions` | lookup/combo no front + FK validada no back (409 PT) |
| **trigger `REM_BAIRRO`** | **N/A — NÃO EXISTE** | — | — | **sem replicação** (`replica:false`), sem outbox `[impl: bairro.crud.ts:L18]` |
| **estado global / `TDataModule` legado** | **N/A — não há tela legada** | — | — | não há acoplamento de form a desfazer |

- **Conexão/transação:** cada I/U/D roda em **transação própria** do engine (`.transaction().execute`) `[impl: L98,124,141]` — carimbo + histórico na **mesma** transação do insert/update. **Sem** conexão global atravessando telas (≠ legado).
- **Ordem de abertura assumida:** presume tenant/login (operador no request). No alvo é **explícito** (request context), não estado global.

> **Diferença para os ports reais:** nos forms portados ([Bancos](uCadBancos.md)/[Marcas](uCadMarcas.md)) esta seção mapeia o `TDataModule` global e triggers legadas. Aqui **não há legado** — então **não há acoplamento oculto de form** a documentar (N/A). O único "efeito-fantasma" possível seria o histórico + a FK de cidade, ambos **explícitos** no engine. **Sem replicação** (sem `REM_BAIRRO`).

---

## 7. Dependências

| Dependência | Tipo | Como é usada | Procedência |
|---|---|---|---|
| `<CadMaster>` (pilar) | composição/engine | máquina de estados, código+Enter, Pesquisa/F6, navegação, gravar/excluir, soft-delete, histórico | `[impl: shared/cadmaster/CadMaster]` |
| `createCrudController` + `CrudEngineService` | factory/engine | gera os endpoints e a lógica CRUD a partir de `bairroCrudConfig` | `[impl: bairro.crud.ts:L22-27, crud-engine.service.ts]` |
| `bairroSchema`/`atualizarBairroSchema` (zod) | validação | DTOs de entrada (`descricao`/`regiao`/`ativo`/`idcidade` opcionais) | `[impl: bairro.schema.ts]` |
| `REGIAO_BAIRRO` / `ATIVO_SN` (constantes) | domínio de combo | opções dos `<SelectField>` (decisão nossa) | `[inferido — impl: bairro.schema.ts:L10-25]` |
| recurso `cadastro/cidades` | lookup/FK | opções de cidade (`useResourceOptions`) + FK validada no back | `[impl: BairrosCadMaster.tsx:L21-24, cidade.crud.ts]` |
| view `get_bairro` | leitura/pesquisa | listagem com decode de `REGIAO` | `[impl: migrations/010_bairro.sql:L29-48]` |
| **`TfrmCadMaster` / `uPesquisa` / `dmPrincipal` (legado)** | **N/A** | **não há form legado** que herde/chame esses | `[Oracle-dict: ausência]` |

> Não há dependência de unit/datamodule Delphi porque **não existe a tela legada**. As dependências são todas do **app novo**.

---

## 8. TabOrder + mapa de atalhos/mnemônicos

> **N/A no legado** (sem `.dfm` p/ extrair taborder/mnemônicos). O mapa abaixo é **desenho novo** `[impl]`, com mnemônicos definidos via `label="&…"` (consumidos pelo DS), e os atalhos de ação herdados do pilar `<CadMaster>` (padrão ADR-010 comum às herdeiras).

**TabOrder (campos próprios — ordem na tela nova):** `[impl: BairrosCadMaster.tsx:L38-90]`

| Ordem | Controle | Campo | Tipo | Enter faz |
|---|---|---|---|---|
| 0 | Descrição | DESCRICAO | `<Field>` | avança |
| 1 | Região | REGIAO | `<SelectField>` | avança |
| 2 | Ativo | ATIVO | `<SelectField>` | avança |
| 3 | Cidade | IDCIDADE | `<SelectField>` (lookup) | avança |

Antes destes, o foco inicial em modo busca é o campo de código (`IDBAIRRO`, herdado do pilar).

**Mnemônicos `&` (Alt+letra) — campos próprios (novos):** `[impl]`

| Controle | Caption | Letra | Papel | FocusControl |
|---|---|---|---|---|
| Descrição | `&Descrição` | D | focus | campo descrição |
| Região | `&Região` | R | focus | combo região |
| Ativo | `&Ativo` | A | focus | combo ativo |
| Cidade | `&Cidade` | C | focus | combo cidade |

> ⚠️ Como **não há legado**, estes mnemônicos **não são paridade** — são escolha nova (sem memória muscular de operador a preservar). ADR-010 trata mnemônico como piso; aqui partimos do zero. `[inferido]`

**Atalhos de ação (herdados do pilar `<CadMaster>` — padrão das herdeiras):** Gravar (Alt+G), Editar (Alt+E), Excluir (Alt+X), Adicionar (Alt+A), Cancelar/Sair (Alt+C/Alt+S), filtro de situação (F6: ativos/inativos/todos), navegação por setas em código, Enter no código carrega registro. `[impl: shared/cadmaster/CadMaster]` (não extraído de `.dfm` — **não existe**).

---

## 9. Casos de teste (golden)

> ⚠️ **Golden de legado: N/A — não há tela legada de Bairros para capturar.** Não existe `V$SQL`/runtime de um form Delphi de Bairros (o form não existe). Portanto **não há golden de paridade contra legado** — só **resultado do NOVO**, capturado pelo **smoke HTTP** `[impl: apps/api/scripts/smoke.ts]` (caso 9 e caso 12). Isto é honestamente um conjunto de **testes da tela nova**, não golden de port.

**Casos do smoke (resultado do NOVO) — `[impl: smoke.ts]`:**

| ID | Cobre (BR/Q) | Input (estado + campos) | Ação | Output esperado (do novo) | Procedência |
|---|---|---|---|---|---|
| G-01 | Q2 + seed | tabela com seed de 4 | `GET /cadastro/bairros` | lista **4** linhas (CENTRO/JARDIM AMERICA/VILA NOVA/SANTA CRUZ) | `[impl: smoke.ts:L113-114]` |
| G-02 | BR-03 + BR-09 + Q-WRITE INSERT | `POST {descricao:'BAIRRO SMOKE', regiao:'NL', ativo:'S'}` | gravar novo | **201**, `idbairro` gerado pela sequence; `regiao='NL'` aceita pelo enum | `[impl: smoke.ts:L115-122]` |
| G-03 | BR-03 decode (view) | pesquisa `?campo=regiao&operador=contem&valor=NORDESTE` | filtrar | acha o novo (a view decodifica `'NL'` → **`NORDESTE`**) | `[impl: smoke.ts:L124-125]` |
| G-04 | BR-08 FK válida | `POST {descricao:'PINHEIROS', regiao:'O', ativo:'S', idcidade:3550308}` | gravar com FK válida | **201** (FK de cidade OK) | `[impl: smoke.ts:L156-161]` |
| G-05 | BR-08 FK inválida | `POST {descricao:'FANTASMA', regiao:'N', idcidade:9999999}` | gravar com FK inexistente | **erro ≥400** | `[impl: smoke.ts:L162-167]` |
| G-06 | BR-08 + ADR-015 (envelope) | mesma FK inválida | inspecionar erro | **409** com `code='REGISTRO_RELACIONADO_INEXISTENTE'`, `statusCode≠500` (motivo real, não 500 genérico) | `[impl: smoke.ts:L168-174]` |
| G-07 | BR-02 obrigatórios | `POST` com `descricao` vazia | gravar | grava normal (todos os campos opcionais) — não bloqueia | `[impl: bairro.schema.ts:L27-36]` (a confirmar no smoke) |
| G-08 | BR-04/BR-05 soft-delete | excluir bairro existente, depois carregar/pesquisar | excluir + reler | `DELETE` → `indr='E'`; `GET /:id` retorna **vazio**; pesquisa default (ativos) **não** mostra | `[impl: crud-engine.service.ts:L139-147, L38]` (a confirmar no smoke) |
| G-09 | BR-01 RBAC | operador sem `BTNGRAVAR` | gravar | bloqueado antes do banco (zero DML) | `[impl]` (a confirmar) |

> **Não há "SQL real observada" de legado** (coluna omitida de propósito): a SQL é a do **engine novo** (§4), não capturada de um form. G-01..G-06 já rodam no smoke; G-07..G-09 são derivados de §4/§5 ainda **a exercitar explicitamente no smoke**.

---

## 10. Alvo (especificação de implementação)

> Já **implementado** (declarativo). Esta seção descreve o que existe `[impl]`.

**Backend (NestJS — engine CRUD):**
- Módulo: `cadastro` (registrado em `cadastro.module.ts:L25` como `BairroCrudController`).
- Config declarativa `[impl: bairro.crud.ts:L11-20]`:
  ```ts
  { tabela:'bairro', pk:'idbairro', view:'get_bairro',
    colunas:['descricao','regiao','ativo','idcidade'],   // idcidade = LOOKUP/FK → CIDADES
    rbacForm:'FRMCADBAIRRO',
    softDelete:true,   // excluir → INDR='E' (BR-04/BR-05)
    replica:false,     // BAIRRO não tem trigger REM no legado
    colunasPesquisa:['idbairro','descricao','regiao','ativo'] }
  ```
- Endpoints (gerados por `createCrudController({ path:'cadastro/bairros' })`):
  | Método+rota | Origem (Q/BR) | DTO (zod) | Mutação? |
  |---|---|---|---|
  | `GET /cadastro/bairros` | Q2 | `PesquisaQuery` (filtra situação default `ativos`) | leitura |
  | `GET /cadastro/bairros/:id` | Q1 | — | leitura (filtra `<>'E'`) |
  | `POST /cadastro/bairros` | Q-WRITE INSERT, BR-02/03/06/08/09 | `bairroSchema` | escrita (sem outbox) |
  | `PUT /cadastro/bairros/:id` | Q-WRITE UPDATE | `atualizarBairroSchema` | escrita |
  | `DELETE /cadastro/bairros/:id` | Q-WRITE soft-delete, BR-04 | — | escrita = `indr='E'` |
- Service: RBAC (BR-01) por `FRMCADBAIRRO`; carimbo (BR-06) e soft-delete (BR-04) no engine; FK de cidade → 409 PT (BR-08, ADR-015); PK por sequence (BR-09). DTO/zod: `descricao` `max(100)` opcional, `regiao` enum opcional, `ativo` `S/N` opcional, `idcidade` int positivo opcional.

**Frontend (React — pilar `<CadMaster>`):** `[impl: BairrosCadMaster.tsx]`
- Rota `/cadastro/bairros` (lista) + `/cadastro/bairros/:idbairro` (form).
- Campos: Descrição (`<Field>`), Região (`<SelectField>` `REGIAO_BAIRRO`), Ativo (`<SelectField>` `ATIVO_SN`), Cidade (`<SelectField>` lookup de `cadastro/cidades`).
- Colunas de pesquisa: Código/Descrição/Região/Ativo. Mnemônicos `&Descrição`/`&Região`/`&Ativo`/`&Cidade` (decisão nova).

**Decisões offline (PDV/Electron):** N/A direto — cadastro de apoio roda na **retaguarda/nuvem**. **Sem replicação** (`replica:false`, sem `REM_BAIRRO`), então não há delta de sync próprio. Se bairro vier a alimentar endereço no PDV, o delta viria pela entidade que o referencia, não por `BAIRRO` isolada. `[inferido]`

---

## Contraste com o legado (BAIRRO como texto livre)

> **Por que esta tela existe e o que ela substitui.** No legado, **não há cadastro de bairro** — "bairro" é **texto livre** digitado no endereço:

- **`PARCEIROS_END.BAIRRO`** é `TStringField` **`Size=50`** (free text, `ProviderFlags=[pfInUpdate]`), em múltiplos datasets `[.dfm: /Library/SicomGit/retaguarda-master/fonte/Units/udmParceiros.dfm:L852-856 (cdsEndParceiros), L2337-2341 (qryEndParceiros), L343-347 (cdsParceiros), L1825-1829 (qryParceiros)]`.
- **`uCadClientes`** edita o bairro por **`edtBairro: TDBEdit`** (texto puro), `DataField='BAIRRO'`, `DataSource=dsEnderecos`, `CharCase=ecUpperCase` `[.dfm: /Library/SicomGit/retaguarda-master/fonte/Units/uCadClientes.dfm:L701-718]`. O `edtBairroEnter` só ajusta foco — **sem lookup**.
- **Ausência confirmada:** **nenhuma** FK `IDBAIRRO`, **nenhum** `TDBLookupComboBox` p/ bairro, **nenhuma** view `GET_BAIRRO`; a SQL de endereços (`qryEndParceiros`) só junta `PARCEIROS_END`/`PARCEIROS`/`PAIS` — **não** junta `BAIRRO` `[.dfm: udmParceiros.dfm:L2279-2309]`.

**Conclusão do contraste:** o legado guarda bairro como **string `VARCHAR(50)` não-controlada** no endereço; **a tabela `BAIRRO` (`VARCHAR2(100)`/região/cidade) existe mas nunca foi usada por tela** (vazia). Esta tela nova é o **primeiro uso** dessa tabela — **normaliza** o que era texto livre. **Não é um port**; é uma melhoria estrutural. Eventual ligação `PARCEIROS_END.BAIRRO` (texto) → `BAIRRO.IDBAIRRO` (FK) é trabalho **futuro** fora desta fatia.

---

## Paridade com o novo (implementação)

A tela está implementada **declarativamente** `[impl]`, espírito ADR-014:

- **Backend:** `/Library/Apollo/apps/api/src/modules/cadastro/bairro.crud.ts` — `bairroCrudConfig` + `createCrudController({ path:'cadastro/bairros' })`.
- **Schema:** `/Library/Apollo/packages/shared/src/schema/bairro.schema.ts` — `bairroSchema` (todos opcionais; `regiao` enum; `ativo` S/N; `idcidade` int>0) + `REGIAO_BAIRRO`/`ATIVO_SN`.
- **Frontend:** `/Library/Apollo/apps/web/src/features/bairros/BairrosCadMaster.tsx` — `<CadMaster titulo="Bairros" resourcePath="cadastro/bairros" pk="idbairro">` com texto + 2 combos + lookup de cidade.
- **Migração:** `/Library/Apollo/apps/api/migrations/010_bairro.sql` — `seq_bairro_idbairro`, tabela `bairro` (11 colunas espelhando o Oracle), `view get_bairro` com decode de `REGIAO` (decisão nossa), seed de 4 e permissões `FRMCADBAIRRO`.
- **Smoke:** `/Library/Apollo/apps/api/scripts/smoke.ts:L112-174` — casos 9 e 12 (listar seed=4, POST com `REGIAO='NL'`→`NORDESTE`, FK de cidade válida/inválida com 409 PT).

> 🟡 **Status: FIEL-POR-CONSTRUÇÃO sobre tabela real, NÃO port de legado.** A implementação é coerente com a estrutura Oracle `[Oracle-dict]` (soft-delete, carimbo, nullable, sem replicação) e exercita o palette texto+combo+flag+lookup. **Mas não há paridade a certificar contra um legado** — a tela não existe lá. O que é **decisão nossa** (não paridade): existência da tela, domínio/decode de `REGIAO`, sequence da PK, mnemônicos. Por isso `em-revisão`, não `concluído`.

---

## Lacunas / perguntas

1. **Domínio de `REGIAO` (decisão nossa)** — o legado **não define** o que `VARCHAR2(2)` significa. O decode C/N/S/L/O/NL/SL/NO/SO é **interpretação nossa** `[inferido]`. Confirmar com produto se esse domínio (zona urbana) é o desejado ou se há um catálogo de regiões a respeitar.
2. **Sem golden de legado (N/A)** — não há tela Delphi de Bairros; impossível capturar `V$SQL` de um form inexistente. Os "golden" são testes do **novo** (smoke). Documentar que paridade-de-port **não se aplica** aqui.
3. **PK por sequence** — `nextval` é **decisão nossa** `[inferido]` (sem `GetID('IDBAIRRO')`/generator legado observado, tabela vazia). Confirmar nome/estratégia.
4. **Ligação futura `PARCEIROS_END.BAIRRO` (texto) → `BAIRRO` (FK)** — fora desta fatia; abrir item de roadmap para normalizar os endereços existentes (texto livre `VARCHAR(50)`) contra o novo cadastro.
5. **`HISTORICO_DINAMICO`** — o engine grava histórico em I/U/D; confirmar se deve ficar ativo para este cadastro de apoio.
6. **`IDCIDADE` FK física** — hoje é FK **lógica** (validada no service → 409 PT); a coluna é `integer` sem constraint física nesta migração. Decidir se vira FK física quando `CIDADE` estiver consolidada.
7. **`ATIVO` vs `INDR`** — confirmar com produto que faz sentido manter **dois** conceitos (flag editável S/N **e** soft-delete) nesta tela nova, herdados da estrutura da tabela real.

## Ver também

- [dossier-template.md](../dossier-template.md) · [dossier-process.md](../dossier-process.md)
- [uCadMarcas.md](uCadMarcas.md) — herdeira com soft-delete + sem replicação (espelho mais próximo: aqui é o **caso sem legado**, lá há `.pas`/`.dfm`).
- [uCadBancos.md](uCadBancos.md) — o piloto com golden de runtime certificado (contraste: Bairros **não tem** golden de legado).
- [../../03-legacy-analysis/recon/form-base-cadmaster.md](../../03-legacy-analysis/recon/form-base-cadmaster.md) — o contrato `TfrmCadMaster` que o engine CRUD replica.
- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — ADR-008/010/011/012/014/015.
