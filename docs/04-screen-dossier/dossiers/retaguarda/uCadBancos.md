# Dossiê — `frmCadBancos` (Cadastro de Bancos)

| Campo | Valor |
|---|---|
| **Status** | **`implementado (Fase 0 esqueleto) + revisado (1ª rodada)`** — golden do legado capturados em homologação (CODBCO=740) e o piloto implementado em `/Users/apollosistemas/apollo-erp` com paridade verde (SQL 7 + integração 6 + teclado 7 + smoke HTTP 9). Revisão independente feita e corrigida. **Não `concluído`**: pendências conhecidas documentadas (RBAC stub, replicação parcial, DS visual) — ver fim do dossiê. |
| **Autor / Revisor** | agente de recon (Claude) / *pendente — revisor independente ([../../08-agents/review-loop.md](../../08-agents/review-loop.md))* |
| **Versão do dossiê** | v0 (draft de recon — Fase 1 piloto) |
| **Data** | 2026-06-24 |
| **Commit do legado analisado** | `/Library/SicomGit/retaguarda-master` (branch `*-master`, sem hash versionado) |

> **Por que este é o piloto:** menor superfície de regra de toda a retaguarda, fora do risco-coroa fiscal, mas exercita **toda a fundação** — form-base `TfrmCadMaster`, datamodule→repository, conexão global→por-tenant, RBAC, camada de teclado, CDC de replicação e harness de paridade. Ver [mapa-reconhecimento.md §G/§I](../../03-legacy-analysis/recon/mapa-reconhecimento.md).
>
> ⚠️ **Limite desta versão:** feita por leitura estática de `.pas`/`.dfm` + inspeção do dicionário Oracle (read-only). O playbook exige **captura de runtime** para fechar as seções 4 e 9 ([../../03-legacy-analysis/dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md)). Tudo que não foi visto rodando está marcado `[estático]`/`[inferido]` e listado em [Pendências de runtime](#pendências-de-runtime-para-sair-de-rascunho).

---

## 1. Identidade

| Campo | Valor |
|---|---|
| **Form (`.pas` / `.dfm`)** | `retaguarda-master/fonte/Units/uCadBancos.pas` (80 linhas) + `uCadBancos.dfm` (224 linhas) `[.dfm]` |
| **Classe do form** | `TfrmCadBancos` — **herda `TfrmCadMaster`** (`uCadMaster.pas`, 1.806 linhas) via herança visual (`inherited frmCadBancos`) `[.dfm:L1]` |
| **Módulo de domínio** | `cadastro` (financeiro — usado por contas bancárias / boletos) |
| **Função no negócio** | CRUD do cadastro de bancos: agência, nome do banco, cidade, e dados de cobrança/boleto (agência cedente, código do banco para boletos, convênio, carteira, variação da carteira). |
| **Frequência / criticidade** | **baixa** frequência (cadastro estável, 718 linhas na amostra COLUMBIA), **baixa** criticidade. Não é caminho de PDV. **Não toca fiscal.** Alimenta cadastros de contas bancárias e emissão de boletos (CNAB). |
| **Rota-alvo (web)** | `/cadastro/bancos` (lista) · `/cadastro/bancos/:codbco` (edição) — *proposta* |
| **Casca-alvo** | `browser` — tela de retaguarda, sem device, sem teclas reservadas críticas. (Electron só se entrar no pacote power-user; não há requisito próprio.) |

---

## 2. UI — inventário de componentes (`.dfm` → React)

Herança visual: o `.dfm` herda do form-base (`imgCabecalho`, `lblTitulo`, `pnlGeral`, `pnlCabecalho` com `edtCodigo`+`btnPesquisa`+`DBNavigator1`, `pnlRodapeMaster` com os botões de ação, `stbHints`, `cdsPrincipal`/`cdsNavegation`/`cdsFiltros`/`cdsHistorico_dinamico`). Abaixo, só os controles **próprios** desta tela (todos em `pnlGeral`, bind `DataSource = dtsPrincipal` herdado → `cdsPrincipal`).

| Controle (`.dfm`) | Tipo VCL | Left,Top,W,H | Caption/label | DataField | → React (DS) | Nota de reflow |
|---|---|---|---|---|---|---|
| `edtAGENCIA` | `TDBEdit` | 8,18,89,21 | `Agência` (UPPERCASE) | `AGENCIA` | `<Field>` | linha 1, col 1 |
| `EDTAGENCIACEDENTE` | `TDBEdit` | 103,18,89,21 | `Agência Cedente` (UPPER) | `AGENCIA_CEDENTE` | `<NumberField>` | linha 1, col 2 |
| `edtBANCO` | `TDBEdit` | 8,58,282,21 | `Banco` (UPPER) | `BANCO` | `<Field>` *(obrigatório)* | linha 2, col 1 (largo) |
| `edtCodBcoBlt` | `TDBEdit` | 296,58,89,21 | `Código do Banco (Emissão de boletos)` (UPPER) | `CODBCOBLT` | `<NumberField>` | linha 2, col 2 |
| `edtCIDADE` | `TDBEdit` | 8,98,375,21 | `Cidade` (UPPER) | `CIDADE` | `<Field>` *(obrigatório)* | linha 3 (largo) |
| `edtConvenio` | `TDBEdit` | 8,144,121,21 | `Convênio` | `CONVENIO` | `<NumberField>` | linha 4, col 1 |
| `edtVariacaoCarteira` | `TDBEdit` | 134,144,121,21 | `Variação Carteira` | `VARIACAO_CARTEIRA` | `<NumberField>` | linha 4, col 2 |
| `DBEdit1` | `TDBEdit` | 264,144,121,21 | `Carteira Cobrança` | `CARTEIRA_COBRANCA` | `<NumberField>` | linha 4, col 3 |
| `DataSource1` | `TDataSource` | — | (não-visual; sem DataSet no `.dfm`) | — | — | aparente sobra; confirmar uso |

**Herdados (do form-base, a reaproveitar no engine CRUD do alvo):** `edtCodigo` (campo de código/lookup da PK), `btnPesquisa` (`TSpeedButton`, abre pesquisa), `DBNavigator1` (navegação de registros), botões de ação no rodapé (Gravar/Cancelar/Editar/Excluir/Adicionar + `btnOutros`), `stbHints` (status bar com "Cadastrado/Alteração").

**Notas de reflow:** layout absoluto `Left/Top` → grid fluido de 1–3 colunas preservando ordem de leitura e taborder (seção 8); **não** copiar pixels. `CharCase=ecUpperCase` em quase todos → normalização para maiúsculas no input (regra BR-04). 

> **Achado (gap de UI):** a coluna `UF` existe na tabela e no dataset (`cdsBancosUF`, CHAR(2)), mas **não há campo de UF no `.dfm`** — a tela não permite editar UF. Decidir no alvo: expor UF ou manter omitido (paridade = omitido). `[.dfm]` + `[.pas dataset]`.

---

## 3. Eventos

Handlers próprios de `uCadBancos.pas` (o resto do comportamento é herdado de `TfrmCadMaster` — ver seção 7).

| Componente.Evento | `.pas` | O que faz | Toca SQL? | Toca estado externo? | Vira (alvo) |
|---|---|---|---|---|---|
| `FormCreate` | `[.pas:L72]` | `inherited`; cria `RDmCadBancos`; `SetaDataset(edtAgencia, RDmCadBancos.cdsBancos, 'CODBCO', 'BANCOS')` — wira o cds da tabela BANCOS ao form-base, define PK e foco inicial | indireto (abre dataset) | cria datamodule; usa conn global | montagem do form + bind do recurso `/bancos` |
| `btnGravarClick` | `[.pas:L48]` | converte `edtCodBcoBlt.Text`→int (se preenchido); `inherited` (todo o fluxo de gravação do form-base, ver seção 6); captura exceção e mostra `Mensagem(E.Message, tmInformacao)` | sim (via `ApplyUpdates`) | sim (ver seção 6) | `POST`/`PUT /bancos` + tratamento de erro tipado |
| `FormClose` | `[.pas:L66]` | `FreeAndNil(RDmCadBancos)`; `inherited` | — | libera datamodule | desmontagem/cleanup |

> Observação: `btnGravarClick` aqui é fino — a conversão de `CODBCOBLT` é só defensiva; **o grosso da gravação é `inherited`** (`TfrmCadMaster.btnGravarClick`, ver seção 6). A leitura "olhando a tela" perderia tudo isso — daí a regra "migre o que o sistema faz".

---

## 4. Dados — TODA query

### Q1 — `aqqBancos` (leitura de 1 registro por código) — `[.dfm SQL.Strings]`
- **Origem:** `retaguarda-master/fonte/Units/uRDmCadBancos.dfm` — `TFDQuery aqqBancos`, Connection = `dmPrincipal.FDConexao` (global).
- **Quando dispara:** ao abrir/editar um banco pelo código (via `SetaDataset`/`AbreDataset` do form-base).
- **SQL base (Oracle, verbatim):**
  ```sql
  select *
  from BANCOS B
  where B.CODBCO = :Codigo
  ```
- **Params:** `:Codigo` (`CODIGO`, `ftInteger`, `ptInput`) — origem: `edtCodigo` / chave selecionada na pesquisa.
- **Fragmentos condicionais:** nenhum nesta query (estática pura).
- **Pipeline de gravação — ✅ CAPTURADO EM RUNTIME** (`V$SQL`, `pinheirao@dbhomologacao`, 2026-06-24, teste CODBCO=740 gerado por **sequence app-side**). A DML do provider é **delta-based** (só colunas tocadas), bindada:
  ```sql
  -- INSERT (só os campos preenchidos, não as 13 colunas)
  insert into "BANCOS" ("CODBCO","AGENCIA","BANCO","CIDADE","AGENCIA_CEDENTE") values (:1,:2,:3,:4,:5)
  -- UPDATE (só a coluna alterada; WHERE pela chave)
  update "BANCOS" set "CIDADE" = :1 where "CODBCO" = :2
  -- DELETE
  delete from "BANCOS" where "CODBCO" = :1
  ```
- **⚠️ Carimbo de auditoria = 2º statement SEPARADO** (literal, não bindado), emitido **após** o insert/update pelo form-base (`SetaOperadorAlteracao`):
  ```sql
  -- após INSERT (seta DTCADASTRO também):
  UPDATE BANCOS SET USULTALTERACAO=1, DTULTIMALTERACAO='24.06.2026 15:16:30', DTCADASTRO='24.06.2026 15:16:30' WHERE CODBCO='740'
  -- após UPDATE de edição:
  UPDATE BANCOS SET USULTALTERACAO=1, DTULTIMALTERACAO='24.06.2026 15:16:41' WHERE CODBCO='740'
  ```
  Este UPDATE de carimbo **também dispara replicação** (conta como mais 1 evento por terminal — ver seção 6).
- **Leitura do "Cadastrado/Alteração" (status bar, `SetaUltimaAlteracao`) — capturada:**
  ```sql
  select T.USULTALTERACAO, O.LOGIN, T.DTULTIMALTERACAO, T.DTCADASTRO
  from BANCOS T LEFT JOIN OPERADORES O ON (O.CODOPERADOR = T.USULTALTERACAO) where T.CODBCO = '740'
  ```
- **Mutações:** leitura (Q1) + escrita (INSERT/UPDATE/DELETE via provider) em `BANCOS`.
- **Tabelas / triggers / sequences tocadas:**
  - `BANCOS` (CRUD).
  - **Trigger `REM_BANCOS`** (AFTER I/U/D EACH ROW) — **escrita-fantasma**: insere em `REMESSA_SERVER` a instrução de replicação (ver seção 6). A SQL da tela **não mostra** isso.
  - **PK `CODBCO` é gerada por SEQUENCE app-side** `[runtime confirmado]`: o banco não tem trigger/sequence de PK (a única trigger é `REM_BANCOS`), mas o **aplicativo** busca o próximo código de uma sequence e o insere **explicitamente** (capturado: o INSERT lista `CODBCO` e o valor 740 foi gerado, não digitado). → **No alvo:** sequence no Postgres (`seq_bancos_codbco`, default `nextval`) — **paridade de resultado** (código sequencial auto-gerado, não digitado pelo operador). ⚠️ Corrige a hipótese estática anterior ("PK manual/digitada"), que o runtime refutou.
  - Auditoria: `USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO` carimbadas pelo form-base (`SetaOperadorAlteracao`), não pela query (seção 6).
- **SQL-alvo (Postgres, Kysely):** `select * from bancos where codbco = $1`; writes viram `insert/update/delete` explícitos no repository. Oracle→PG: tipos `NUMBER`→`integer/numeric`, `CHAR(2)`→`char(2)`/`varchar`, `TIMESTAMP(6)`→`timestamptz`. Sem `NVL/ROWNUM/(+)/SYSDATE` nesta query.

### Q2 — Pesquisa / listagem (`btnPesquisa` → `frmPesquisa`) — `[estático]` (reconstruída; valores finais em runtime)
- **Origem:** form-base `TfrmCadMaster.btnPesquisaClick` `[.pas:L516]` abre `frmPesquisa` (`uPesquisa.pas`) sobre uma **VIEW `GET_BANCOS`** (não a tabela crua) — ver [form-base-cadmaster.md §2](../../03-legacy-analysis/recon/form-base-cadmaster.md).
- **View `GET_BANCOS` (✅ validada contra homologação — `pinheirao@dbhomologacao`):** projeção de 8 colunas que **renomeia** para o grid de pesquisa:
  ```
  BANCO, AGENCIA, CIDADE, CODIGO(=CODBCO), CODIGO_BANCO(=CODBCOBLT),
  CONVENIO, CARTEIRA_COBRANCA, VARIACAO_CARTEIRA
  ```
  **Omite** UF, AGENCIA_CEDENTE e auditoria. Sem `INDR`/`ATIVO` → sem filtro de soft-delete. (No alvo, os aliases `CODIGO`/`CODIGO_BANCO` da listagem mapeiam para `codbco`/`codbcoblt`.)
- **✅ CAPTURADO EM RUNTIME** — o `frmPesquisa` faz, em sequência:
  ```sql
  -- 1) lê a config do form de pesquisa:
  select FORM from TABELA_CADASTRO where TABELA = 'GET_BANCOS'
  -- 2) a listagem (2 colunas sintéticas de seleção + a view inteira):
  select Cast('F' as CHAR(1)) as Selecionar, Cast('T' as CHAR(1)) as Sel, GET_BANCOS.* from GET_BANCOS
  ```
  `Selecionar`/`Sel` são flags de seleção do grid. `where`/`order` entram conforme o usuário filtra. **Achado de runtime:** há uma tabela de metadados **`TABELA_CADASTRO`** que parametriza o form de cada pesquisa (`WHERE TABELA='GET_BANCOS'`).
- **Alvo:** `GET /bancos?filtro=...` (lista paginada sobre o equivalente da view).

> **Regra de ouro:** Q1 é estática e confiável; o **pipeline de escrita** (provider) e **Q2** (pesquisa) são `[inferido]` até a captura de runtime. Não declarar paridade sem isso.

---

## 5. Regras de negócio

| ID | Regra | Gatilho | Lógica | *Porquê* | Procedência |
|---|---|---|---|---|---|
| BR-01 | **Permissão de gravar** por form+ação | ao gravar | `dmPrincipal.PossuiAcessoForm('frmCadBancos','BTNGRAVAR')`; sem permissão → cancela e lança exceção | RBAC data-driven por tela/ação | `[.pas TfrmCadMaster:L430]` |
| BR-02 | **Campos obrigatórios** | ao gravar | `ValidaObrigatorios(cdsPrincipal)` → `Abort` se faltar. Obrigatórios (do dataset/DB): `BANCO`, `CIDADE`, `CODBCO` (Required=True) | integridade do cadastro | `[.pas TfrmCadMaster:L446]` + `[.dfm uRDmCadBancos: Required]` + `[DB NOT NULL]` |
| BR-03 | **Carimbo de empresa/operador** | ao gravar | se `FPreencheEmpresa` → `CODEMPRESA := dmPrincipal.EmpresaCODEMPRESA`; se `FPreencheOperador` → `CODOPERADOR := dmPrincipal.OperadorCODOPERADOR` | tenant/autoria | `[.pas TfrmCadMaster:L449-453]` *(confirmar se BANCOS tem essas colunas — provavelmente não; flag off)* |
| BR-04 | **Entrada em MAIÚSCULAS** | digitação | `CharCase = ecUpperCase` em AGENCIA, AGENCIA_CEDENTE, BANCO, CIDADE, CODBCOBLT | padronização de busca/exibição | `[.dfm]` |
| BR-05 | **Conversão defensiva de `CODBCOBLT`** | ao gravar | se `Length(edtCodBcoBlt.Text)>0` → `StrToInt` (pode lançar) | campo inteiro | `[.pas:L48-58]` |
| BR-06 | **Sem soft-delete** | ao excluir | `BANCOS` **não** tem `INDR` → exclusão é **física** (DELETE), conforme convenção do form-base (soft-delete só com `INDR`) | tabela simples | `[DB colunas]` + `[.pas uCadMaster cabeçalho]` |

> Não há cálculo nem regra fiscal nesta tela — por isso é piloto. As "regras" são todas do contrato do form-base + integridade. O *porquê* de campos como `CONVENIO`/`CARTEIRA_COBRANCA`/`VARIACAO_CARTEIRA` é **boleto/CNAB** (cobrança bancária) — confirmar com domínio se há validação por banco/layout (provável que não, aqui é só cadastro).

---

## 6. Efeitos colaterais + estado externo

> A seção que salva da armadilha de acoplamento. Mesmo um CRUD trivial dispara muita coisa **fora do `.pas` da tela**.

| Item | Tipo | Alvo | Quem setou / consome | Mapeamento alvo |
|---|---|---|---|---|
| `dmPrincipal.FDConexao` | usa | conexão Oracle **global** | datamodule principal (boot) | conexão **por tenant** request-scoped ([../../03-legacy-analysis/hidden-coupling-traps.md](../../03-legacy-analysis/hidden-coupling-traps.md)) |
| `dmPrincipal.EmpresaCODEMPRESA` | lê | empresa/tenant global | login/troca de empresa | tenant context fail-closed |
| `dmPrincipal.OperadorCODOPERADOR` | lê | operador logado | login | usuário no request context |
| `dmPrincipal.PossuiAcessoForm` | lê | RBAC | tabela de permissões | guard/policy por rota+ação |
| **trigger `REM_BANCOS`** | grava (indireto) | `REMESSA_SERVER` (outbox) | dispara em I/U/D de `BANCOS` | **sync explícito** (outbox/event no service), **fan-out por terminal**, idempotente por `CHAVE` ([ADR-008](../../00-orientation/canonical-decisions.md)) |
| `MENUEXPRESS` | grava | telemetria de uso | ao abrir a tela: `ACESSOS=ACESSOS+1 WHERE FORMULARIO='FRMCADBANCOS'` | métrica de uso (opcional no alvo) |
| `HISTORICO_DINAMICO` | grava (indireto) | tabela de histórico | `SetaHistorico_Dinamico` no `btnGravarClick` herdado | audit log / interceptor |
| `USULTALTERACAO`/`DTULTIMALTERACAO` | grava | colunas da `BANCOS` | `SetaOperadorAlteracao` herdado | colunas de auditoria preenchidas no service |
| `TLog.GravaLog` | grava | log de aplicação | `btnGravarClick` herdado | logging estruturado |
| `cdsHistorico_dinamico` | usa | cds de histórico | form-base | — |

- **Conexão/transação:** usa a conexão **global** do `dmPrincipal`; transação é a global do legado (risco de [transação atravessando telas](../../03-legacy-analysis/hidden-coupling-traps.md)). No alvo: transação **escopada** ao caso de uso (a gravação de banco + outbox numa só transação).
- **Ordem de abertura assumida:** presume login feito (empresa/operador/permissões em `dmPrincipal`). Precondição a virar contexto explícito.

> **A escrita-fantasma da replicação é o item mais importante — e o runtime revelou a real dimensão dela.** Capturado (CODBCO=740, tenant PINHEIRAO com **3 terminais: 1001/1002/1051**):
> - Cada I/U/D gera **1 linha de remessa POR TERMINAL** (fan-out — 3 linhas/operação aqui).
> - **O UPDATE de carimbo de auditoria também replica** (cada save = update de dados + update de carimbo → 2 ondas de replicação).
> - Total do teste (criar+editar+excluir 1 banco) = **15 linhas** em `REMESSA_SERVER`: INSERT×3, UPDATE×9, DELETE×3.
> - `INSTRUCAO` por tipo: INSERT/UPDATE → `SELECT * FROM BANCOS WHERE CODBCO =<chave>` (consumidor re-busca e faz upsert); DELETE → `DELETE FROM BANCOS WHERE CODBCO =<chave>`. `REPLICA`: null=pendente (terminal de origem 1001), 0=enfileirado p/ os demais.
> No alvo: o equivalente de sync deve **fan-out por terminal/loja** e cobrir **tanto a mutação quanto o carimbo** — senão diverge.

---

## 7. Dependências

| Dependência | Tipo | Como é usada | Vira (alvo) |
|---|---|---|---|
| `TfrmCadMaster` (`uCadMaster.pas`) | **herança** | todo o CRUD: gravar/editar/excluir/pesquisar/navegar, validação, carimbo, histórico, log, RBAC, teclado | **engine CRUD reutilizável** (o `/ds-create-crud` do DS, [ADR-014](../../00-orientation/canonical-decisions.md)) |
| `TRDmCadBancos` (`uRDmCadBancos`) | datamodule | `aqqBancos`→`dspBancos`→`cdsBancos` da tabela BANCOS | `BancosRepository` (Kysely) sem estado |
| `udmPrincipal` (`dmPrincipal`) | datamodule global | conexão, empresa, operador, RBAC, histórico | tenant context + providers |
| `SearchEngineApollo` | unit | motor de pesquisa (Q2) | serviço de listagem/filtro |
| `FuncoesApollo` | unit util | `Mensagem(...)`, `SetaDataset`, helpers | utils/serviços compartilhados |
| FastReport (`frx*`), JVCL (`Jv*`) | libs | exportar/UI (herdado) | export server-side / DS |

> **Há duas cópias do datamodule** (`DmOld/udmCadBancos` e `Units/udmCadBancos`) além do ativo `Units/uRDmCadBancos`. A tela usa o **`uRDmCadBancos`** (`TRDmCadBancos`, criado no `FormCreate`). As variantes `udmCadBancos`/`DmOld` parecem legado-do-legado — **ignorar** na migração (confirmar que não há uso vivo).

---

## 8. TabOrder + mapa de atalhos/mnemônicos

**TabOrder (campos próprios, sequência exata `[.dfm]`):**

| Ordem | Controle | Campo | Tipo |
|---|---|---|---|
| 0 | `edtAGENCIA` | AGENCIA | TDBEdit |
| 1 | `EDTAGENCIACEDENTE` | AGENCIA_CEDENTE | TDBEdit |
| 2 | `edtBANCO` | BANCO | TDBEdit |
| 3 | `edtCIDADE` | CIDADE | TDBEdit |
| 4 | `edtCodBcoBlt` | CODBCOBLT | TDBEdit |
| 5 | `edtConvenio` | CONVENIO | TDBEdit |
| 6 | `edtVariacaoCarteira` | VARIACAO_CARTEIRA | TDBEdit |
| 7 | `DBEdit1` | CARTEIRA_COBRANCA | TDBEdit |

> Nota: a **ordem visual** (linhas por `Top`) e a **taborder** divergem — ex.: `edtBANCO` está visualmente na linha 2 mas é TabOrder 2 (depois de AGENCIA_CEDENTE que está na linha 1, col 2). Replicar a **taborder exata** (ADR-010), não a leitura visual. Antes destes, o foco inicial é `edtCodigo` (código, herdado) via `SetaDataset`.

**Mnemônicos `&` (Alt+letra):** **nenhum nos labels desta tela** (captions sem `&`: `Agência`, `Banco`, `Cidade`…). Os mnemônicos/atalhos vivem nos **botões herdados** do rodapé, já extraídos em [form-base-cadmaster.md §4](../../03-legacy-analysis/recon/form-base-cadmaster.md): `&Gravar` (Alt+G), `&Editar` (Alt+E), `E&xcluir` (Alt+X), `&Adicionar` (Alt+A), `&Sair`/`&Cancelar` (Alt+S/C), `&Outros` (Alt+O).

**Atalhos (F-keys/Enter/Esc) — herdados do form-base** (ver [form-base-cadmaster.md §4](../../03-legacy-analysis/recon/form-base-cadmaster.md)): **F6** cicla filtro ativo (N/A em BANCOS), **Alt+O** abre "Outros", **←/→** navega registro anterior/próximo e **↑/↓** primeiro/último (em `edtCodigo`), **Enter** em `edtCodigo` carrega pelo código, **Esc** é protegida durante edição, e `edtCodigo` só aceita dígitos (PK inteira). Este mapa é comum a todas as ~101 herdeiras → vira config-padrão do engine CRUD.

---

## 9. Casos de teste (golden) — capturados do legado

> ✅ **Golden capturados do legado em execução** (`V$SQL`/`REMESSA_SERVER`, `pinheirao@dbhomologacao`, 2026-06-24; teste real CODBCO=**740**, tenant com 3 terminais 1001/1002/1051). SQL **verbatim** abaixo — vira a régua de paridade ([../../06-testing-quality/parity-harness.md](../../06-testing-quality/parity-harness.md)).

| ID | Cobre | Ação | SQL real capturada | Efeito-fantasma |
|---|---|---|---|---|
| G-01 | Q1 leitura | abrir registro | `select * from BANCOS B where B.CODBCO =:CODIGO` ✅ idêntico à semente `.dfm` | + `SetaUltimaAlteracao` (join OPERADORES) |
| G-02 | INSERT (delta) | gravar novo | `insert into "BANCOS" ("CODBCO","AGENCIA","BANCO","CIDADE","AGENCIA_CEDENTE") values (:1..:5)` | carimbo `UPDATE ... DTCADASTRO,DTULTIMALTERACAO`; **REMESSA INSERT×3 + UPDATE×3** |
| G-03 | UPDATE (delta) | editar CIDADE | `update "BANCOS" set "CIDADE"=:1 where "CODBCO"=:2` | carimbo `UPDATE ... USULTALTERACAO`; **REMESSA UPDATE×3 (mutação) + ×3 (carimbo)** |
| G-04 | DELETE (físico) | excluir | `delete from "BANCOS" where "CODBCO"=:1` | **REMESSA DELETE×3** |
| G-05 | Q2 pesquisa | pesquisar | `select FORM from TABELA_CADASTRO where TABELA='GET_BANCOS'` → `select Cast('F'..)Selecionar,Cast('T'..)Sel,GET_BANCOS.* from GET_BANCOS` | — |
| G-06 | telemetria | abrir tela | `UPDATE MENUEXPRESS SET ACESSOS=ACESSOS+1 WHERE FORMULARIO='FRMCADBANCOS' AND CODOPERADOR=1` | — |
| **Total replicação do teste** | — | criar+editar+excluir 1 banco | — | **15 linhas REMESSA_SERVER**: INSERT×3, UPDATE×9, DELETE×3 |

**Caminhos negativos:**
- **G-07 obrigatórios (BANCO/CIDADE) — ✅ confirmado** (informado pelo usuário + estática): a validação é **app-side** (`ValidaObrigatorios → Abort` **antes** do `ApplyUpdates`) → **nenhuma SQL emitida** quando faltam. Golden = "bloqueado, zero DML". DB tem `NOT NULL` em BANCO/CIDADE como **backstop** (nunca atingido no fluxo normal). → **Alvo:** validar obrigatórios no **DTO/service** (bloquear antes do banco), NOT NULL só como rede.
- **Ainda a capturar (rápidos, mesma técnica):** G-08 RBAC sem permissão (BR-01, também bloqueia antes do banco), G-09 uppercase (BR-04), e a pesquisa **com filtro/ordenação** (where/order dinâmicos).

---

## 10. Alvo (especificação de implementação)

**Backend (NestJS):**
- Módulo: `cadastro/bancos`.
- Endpoints:
  | Método+rota | Origem | DTO (zod) | Mutação? |
  |---|---|---|---|
  | `GET /bancos` | Q2 | `BancoFilterDto` | leitura |
  | `GET /bancos/:codbco` | Q1 | — | leitura |
  | `POST /bancos` | btnGravar (insert) | `BancoUpsertDto` | escrita + **outbox sync** |
  | `PUT /bancos/:codbco` | btnGravar (update) | `BancoUpsertDto` | escrita + outbox sync |
  | `DELETE /bancos/:codbco` | btnExcluir | — | escrita + outbox sync |
- Para o **service** (não controller): RBAC (BR-01) via guard; carimbo de operador/data (BR-03) no service; **publicação no outbox de sync** equivalente a `REM_BANCOS`, na **mesma transação** do write.
- Para o **DTO/zod**: obrigatórios `banco`, `cidade` (BR-02); uppercase (BR-04); coerção de inteiros (BR-05).
- Tenant: a conexão global vira **conexão por tenant**; empresa/operador do request context (não global mutável).

**Frontend (React — via `/ds-create-crud`, ADR-014):**
- Rota `/cadastro/bancos` (lista DataGrid teclado-first) + `/cadastro/bancos/:codbco` (form).
- Campos/ordem = seção 2 + taborder = seção 8; Enter-avança-campo e atalhos do engine CRUD (herdados do equivalente ao form-base).
- Decidir exposição do campo **UF** (gap da seção 2).

**Decisões offline (PDV/Electron):** N/A direto — cadastro de banco roda na **retaguarda/nuvem**. Mas o **delta de replicação** (substituto do `REM_BANCOS`) precisa chegar onde o legado mandava (loja/central) — preservar a semântica de sync ([ADR-001/008](../../00-orientation/canonical-decisions.md)).

---

## Pendências (para sair de `rascunho`)

**✅ Validadas contra homologação (`pinheirao@dbhomologacao`, read-only):** estrutura de `BANCOS` (13 colunas), **Q1** (`where CODBCO=:Codigo`), **GET_BANCOS** (com aliases `CODIGO`/`CODIGO_BANCO`), trigger **REM_BANCOS** presente/ENABLED. · **BR-03 resolvida**: `BANCOS` **não tem** `CODEMPRESA`/`CODOPERADOR` → `FPreencheEmpresa/Operador` **off** (só carimba `USULTALTERACAO`/`DTULTIMALTERACAO`).
**✅ Fechadas antes (estática):** PK `CODBCO` manual · mapa de teclado do form-base ([form-base-cadmaster.md §4](../../03-legacy-analysis/recon/form-base-cadmaster.md)).

**✅ Capturado do legado em execução (V$SQL, 2026-06-24):** INSERT/UPDATE/DELETE reais (delta-based), carimbo de auditoria (2º statement), `SetaUltimaAlteracao`, pesquisa (`TABELA_CADASTRO`→`GET_BANCOS`), telemetria `MENUEXPRESS`, replicação **fan-out por terminal** (15 linhas para criar+editar+excluir). Código por **sequence app-side** (não trigger).

**✅ Implementação Fase 0 (esqueleto andante)** — `/Users/apollosistemas/apollo-erp` (NestJS+Kysely+React). Verde: paridade de SQL (7), integração Postgres real (6), teclado ADR-010 (7), smoke HTTP (9). **Revisão independente (1ª rodada) feita** — correções aplicadas: PK confirmada por sequence (não digitação); identidade de operador fail-closed (sem default `1`); DELETE 204; teste de replicação rotulado como **parcial**; teste de preservação de `dtcadastro` adicionado.

**Pendências conhecidas (documentadas — não marcar `concluído` sem elas):**
1. ~~RBAC (BR-01) stub~~ **✅ FEITO**: implementado fiel ao `PossuiAcessoForm` — tabela `PERMISSOES` (presença=concedido), modo 'usuario' (default do legado), guard NestJS `@RequerAcesso(form,opcao)`; G-08 coberto (operador sem grant → 403). Extensão futura: modos perfil/ambos.
2. **Replicação parcial**: 1 evento/operação; o legado faz **fan-out por terminal** (15 no teste) e o carimbo também replica — trilha de sync (Fase 4).
3. ~~DS visual~~ **✅ FEITO**: DS buildado (`dist-lib`) e plugado — `Button`/`FormFieldInput` do `@apollosg/design-system` com a camada de teclado por cima; Tailwind v4 + tema do DS; web typecheck + `vite build` verdes. (Pendência menor: fonte Geist omitida — pacote `geist` não expõe o woff2 no caminho do template.)
4. **UF** persistível pela API mas sem campo na tela — decidir expor/remover.
5. **`HISTORICO_DINAMICO`** e telemetria **`MENUEXPRESS`** não implementados — decidir manter/descartar.
6. **2ª revisão independente** + (opcional) golden de escrita com log de SQL ligado durante o exercício do ERP; pesquisa com filtro/ordenação dinâmicos.

## Ver também

- [dossier-template.md](../dossier-template.md) · [dossier-process.md](../dossier-process.md)
- [mapa-reconhecimento.md §I](../../03-legacy-analysis/recon/mapa-reconhecimento.md) — o contrato do form-base e a descoberta de replicação.
- [../../03-legacy-analysis/dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md) — como fechar as seções 4 e 9.
- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — ADR-008/010/011/012/014.
