# Dossiê — `frmCadCidades` (Cadastro de Cidades)

| Campo | Valor |
|---|---|
| **Status** | **`em-revisão`** — análise de legado (estática `.pas`/`.dfm` + **fatos do dicionário Oracle confirmados read-only**) feita e fechada; tela já implementada **declarativamente** no app (`cidade.crud.ts` + `CidadesCadMaster.tsx`), **fiel-por-construção e verde no novo** (paridade de **RESULTADO** via smoke/integração). **NÃO `concluído`**: falta o **golden RUNTIME do legado** capturado via `V$SQL` (pendência registrada — ver [Lacunas](#lacunas--perguntas) e seção 9) e a 2ª revisão independente. |
| **Autor / Revisor** | Analista de Legado (Claude) / *pendente — revisor independente ([../../08-agents/review-loop.md](../../08-agents/review-loop.md))* |
| **Versão do dossiê** | v0 (recon — herdeira do form-base com **1 desvio próprio**: o lookup UF por SIGLA→IDUF) |
| **Data** | 2026-06-25 |
| **Commit do legado analisado** | `/Library/SicomGit/retaguarda-master` (branch `*-master`, sem hash versionado) |

> **O que torna esta tela interessante:** é herdeira de `TfrmCadMaster` (como [Marcas](uCadMarcas.md)/[Bancos](uCadBancos.md)), mas **NÃO é trivial**: ela tem **dois campos próprios** (`CIDADE` + um combo de **UF**) e — o ponto-chave — **o combo de UF não grava o que mostra**. O `cmbUF` está bindado em `SIGLA` (uma coluna **derivada de LEFT JOIN**, não da tabela `CIDADES`), e o handler **`cmbUFExit`** traduz a sigla escolhida para o `IDUF` numérico consultando a tabela `UF`, e só então grava `IDUF` no registro de cidade. **"Migre o que o sistema faz":** olhar a tela vê "um combo de UF"; o sistema faz **resolução de chave SIGLA→IDUF via segundo dataset**. O app novo elimina esse round-trip gravando `IDUF` direto a partir de uma lista fixa (`UF_OPCOES`) — decisão registrada em [BR-03](#5-regras-de-negócio)/[seção 10](#10-alvo-especificação-de-implementação).
>
> **Diferença para Marcas/Bancos:** Cidades **não tem `INDR`** (sem soft-delete → **hard-delete**), **não tem colunas de auditoria** (`USULTALTERACAO`/`DT*`), **não tem trigger de replicação** (`REM_*`), e **a PK NÃO é gerada** — é **chave natural** (`IDCIDADE` = código **IBGE**, digitado/importado). É o **espelho oposto** de Marcas em quase tudo.
>
> ⚠️ **Limite desta versão:** análise **estática** de `.pas`/`.dfm` + **fatos do dicionário Oracle confirmados** (estrutura de `CIDADES`/`UF`, sem auditoria, sem `INDR`, sem trigger; `UF.IDUF` = códigos IBGE 11..53). O playbook exige **captura de runtime** (`V$SQL`) para certificar as seções 4 e 9 ([dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md)). O pipeline de escrita do provider está `[inferido — herda Bancos]`; o **golden RUNTIME do legado é pendência** (a paridade hoje é de **resultado** contra o novo, verde). Tudo não visto rodando está rotulado `[estático]`/`[inferido]`.

---

## 1. Identidade

| Campo | Valor |
|---|---|
| **Form (`.pas` / `.dfm`)** | `retaguarda-master/fonte/Units/uCadCidades.pas` (68 linhas) + `uCadCidades.dfm` (151 linhas) `[.dfm]` + datamodule `udmCadCidades.pas`/`.dfm` `[.dfm]` |
| **Classe do form** | `TfrmCadCidades` — **herda `TfrmCadMaster`** (`uCadMaster.pas`) via herança visual (`inherited frmCadCidades`) `[.dfm:L1]` `[.pas:L13]` |
| **Módulo de domínio** | `cadastro` (cidade — referência geográfica; **alvo do LOOKUP/FK de Bairros** e de endereços de parceiros) |
| **Função no negócio** | CRUD do cadastro de cidades: o operador informa o **código IBGE** (`IDCIDADE`, chave natural), o **nome** da cidade e a **UF** (escolhida por sigla). É um cadastro de apoio referenciado por bairros/endereços. |
| **Frequência / criticidade** | **baixa** frequência (tabela geográfica estável, normalmente populada por carga IBGE). **baixa** criticidade. **Não** é caminho de PDV. **Não** toca fiscal diretamente (mas a cidade/UF compõem endereço usado em NF-e a jusante — fora desta tela). |
| **Rota-alvo (web)** | `/cadastro/cidades` (lista) · `/cadastro/cidades/:idcidade` (edição) — recurso `cadastro/cidades` (já implementado, ver [Paridade com o novo](#paridade-com-o-novo)) |
| **Casca-alvo** | `browser` — tela de retaguarda, sem device, sem teclas reservadas críticas. Electron só se entrar no pacote power-user; sem requisito próprio. **Offline:** a cidade pode alimentar a carga inicial do PDV indiretamente (via endereço de parceiro/produto), mas o cadastro em si roda na **nuvem/retaguarda** — ver [seção 10](#10-alvo-especificação-de-implementação). |

---

## 2. UI — inventário de componentes (`.dfm` → React)

Herança visual: o `.dfm` herda **todo** o chrome do form-base (`imgCabecalho`, `lblTitulo`, `pnlGeral`, `pnlCabecalho` com `edtCodigo`+`btnPesquisa`+`DBNavigator1`, `pnlRodapeMaster` com os botões de ação, `stbHints`, e os ClientDataSets de controle como `cdsHistorico_dinamico`). `lblTitulo.Caption='Cidade'` `[.dfm:L15]`. Abaixo, **os controles próprios** desta tela (todos dentro de `pnlGeral`, bind `DataSource = dtsPrincipal` herdado → `cdsCidades`).

| Controle (`.dfm`) | Tipo VCL | Left,Top,W,H | Caption/label (com `&`) | DataField | → React (DS) | Nota de reflow |
|---|---|---|---|---|---|---|
| `Label1` | `TLabel` | 24,4,13,13 | `UF` (**sem `&`**, sem `FocusControl`) | — | `<label>` do SelectField | linha 1, rótulo do combo |
| `cmbUF` | `TJvDBComboBox` | 24,18,46,21 | (rótulo via `Label1`) | **`SIGLA`** (⚠️ coluna **derivada do LEFT JOIN**, não da tabela) | `<SelectField>` (UF_OPCOES) | linha 1; `TabOrder=0`; **`OnExit=cmbUFExit`** (resolve SIGLA→IDUF, ver §3) |
| `Label2` | `TLabel` | 24,47,38,13 | `CIDADE` (**sem `&`**, **com** `FocusControl=edtCidade`) | — | `<label>` do Field | linha 2, rótulo do nome |
| `edtCidade` | `TDBEdit` | 24,61,502,21 | (rótulo via `Label2`) | `CIDADE` | `<Field>` (largo, 200 chars) | linha 2; `TabOrder=1`; **sem `CharCase`** → não força maiúsculas |

`[.dfm:L23-117]`

**Herdados (do form-base, reusados pelo engine CRUD do alvo):** `edtCodigo` (campo de código/lookup da PK = `IDCIDADE` — aqui **digitável**, pois é chave natural), `btnPesquisa` (`TSpeedButton`, abre pesquisa sobre `GET_CIDADES`), `DBNavigator1` (navegação), botões de ação do rodapé (Gravar/Cancelar/Editar/Excluir/Adicionar + `btnOutros`), `rdgAtivo` (filtro Ativo `[F6]` — **N/A prático**: CIDADES não tem coluna `ATIVO` nem `INDR`), `stbHints` (status bar).

**`cmbUF` — itens fixos no `.dfm`:** as 27 UFs estão **hard-coded** em `Items.Strings` e `Values.Strings` (idênticos: `AC, AL, AM, AP, BA, CE, DF, ES, GO, MA, MG, MS, MT, PA, PB, PE, PI, PR, RJ, RN, RO, RR, RS, SC, SE, SP, TO`) `[.dfm:L54-110]`. **São só siglas** — o combo **não** conhece o `IDUF` numérico; por isso precisa do `cmbUFExit` para traduzir (ver §3). O app novo reproduz a lista, mas em `UF_OPCOES` (value=`iduf`, label=`SIGLA — Nome`) → **grava o IDUF direto**, dispensando a tradução. Ordem dos itens no legado é **alfabética por sigla**; em `UF_OPCOES` é por **código IBGE** (RO=11…DF=53) — divergência cosmética de ordenação do combo, registrar.

**Notas de reflow:** layout absoluto `Left/Top` → duas linhas (combo UF em cima, nome embaixo). Sem `TPanel`/`TGroupBox`/`TPageControl` próprios. No alvo, `grid grid-cols-2` com o campo Cidade ocupando `col-span-2` e a UF numa célula `[CidadesCadMaster.tsx:L27-50]`. `edtCidade` é `TDBEdit` **sem `CharCase`** → **não normaliza maiúsculas** no input (a amostra/seed está em caixa-alta por convenção, não por regra de UI).

> **Achado (labels sem mnemônico no legado):** `Label1.Caption='UF'` e `Label2.Caption='CIDADE'` **ambos sem `&`** `[.dfm:L28,L35]`. Logo, **não há Alt+letra próprio** no legado (só `Label2` tem `FocusControl=edtCidade`, mas sem mnemônico não há tecla). O app novo introduziu `label="&Cidade"` (Alt+C) e `label="&UF"` (Alt+U) — **melhoria consciente**, não paridade estrita; aceitável por ADR-010 (mnemônicos são piso). Registrar como divergência consciente.

---

## 3. Eventos

Handlers **próprios** de `uCadCidades.pas` — **três** (o resto é herdado de `TfrmCadMaster`, ver §7). Aqui mora o **único desvio real** desta tela (o `cmbUFExit`):

| Componente.Evento | `.pas` | O que faz (passo a passo) | Toca SQL? | Toca estado externo? | Vira (alvo) |
|---|---|---|---|---|---|
| `FormActivate` | `[.pas:L58-66]` | `inherited`; cria `dmCadCidades := TdmCadCidades.Create(Self)`; chama **`SetaDataset(cmbUF, dmCadCidades.cdsCidades, 'IDCIDADE', 'CIDADES', tcManual)`** — wira o cds da tabela `CIDADES`, define PK=`IDCIDADE`, tabela=`CIDADES`, **foco inicial=`cmbUF`**, e **`tcManual`** (PK **digitada**, NÃO gerada por generator — ver BR-04/Q-PK). Depois `FCampoRetornoPesquisa := 'IDCIDADE'` (a pesquisa devolve o IDCIDADE p/ recarregar) | indireto (prepara datasets) | cria datamodule; usa conn global `dmPrincipal.FDConexao` | montagem do form + bind do recurso `/cadastro/cidades` |
| `cmbUF.OnExit` (`cmbUFExit`) | `[.pas:L42-56]` | `inherited`; **resolve SIGLA→IDUF**: fecha `cdsUF`, seta `cdsUF.Params[0] := cmbUF.Field.AsString` (a SIGLA escolhida), abre `cdsUF` (dispara `sqqUF`: `SELECT SIGLA,IDUF,PAIS FROM UF WHERE SIGLA=:SIGLA`, Q3); então `cdsCidades.Edit; cdsCidadesIDUF := cdsUFIDUF; cdsCidades.Post` — **grava o IDUF numérico** correspondente à sigla no registro de cidade | **sim** (Q3 — consulta `UF`) | grava `IDUF` no `cdsCidades` em memória | **eliminado** no alvo: o `<SelectField>` já carrega `value=iduf` → grava direto, **sem** round-trip à tabela UF (ver BR-03) |
| `btnEditarClick` | `[.pas:L36-40]` | `inherited` (todo o fluxo de edição do form-base: RBAC, estado dsEdit); depois `SetaFoco(cmbUF)` — ao entrar em edição, **foco vai para o combo de UF** | não (próprio) | foco de UI | entrar em edição → focar o campo UF |

> **`FormActivate` (não `FormCreate`) cria o DM:** diferente de Marcas (que usa `FormCreate`), Cidades instancia o datamodule no **`FormActivate`** `[.pas:L58-61]`. ⚠️ **Atenção (achado de risco estático):** `FormActivate` pode disparar **mais de uma vez** ao longo da vida do form (toda vez que o form recebe foco), e **não há `FreeAndNil` em `FormClose`** próprio aqui (≠ Marcas, que libera no `FormClose`). O DM é criado com `Owner=Self` (`TdmCadCidades.Create(Self)`), então o form o destrói no fim — mas reativações poderiam **recriar** o DM (vazamento/duplicação). Confirmar em **runtime** se há recriação (provável: `SetaDataset` em `tcManual` reabre dataset). No alvo, isso some (sem datamodule de instância). Marcar `[estático — risco a confirmar em runtime]`.
>
> **O coração da tela é o `cmbUFExit`:** sem ele, a cidade gravaria `SIGLA` mas **nunca** preencheria `IDUF` (a coluna real, FK). A leitura "olhando a tela" veria um combo comum; o sistema **faz uma consulta extra e uma escrita derivada**. No alvo, o `SelectField` carrega as opções já como `{value:iduf, label:sigla}`, então o `IDUF` é o próprio valor do controle — a tradução vira desnecessária. **Decisão registrada** (ver BR-03 e [Paridade](#paridade-com-o-novo)).

---

## 4. Dados — TODA query

> A tela tem **duas** queries estáticas próprias no datamodule: Q1 (leitura da cidade por código, com LEFT JOIN UF p/ a sigla) e Q3 (resolução SIGLA→IDUF na tabela UF, disparada pelo `cmbUFExit`). Mais o **pipeline de escrita** do provider (herdado) e a **pesquisa** sobre a view `GET_CIDADES` (herdada). Estrutura de `CIDADES`/`UF` e a regra `UF.IDUF=IBGE` são **fatos do dicionário Oracle confirmados** (não re-consultados aqui — procedência `[Oracle-dict]`).

### Estrutura da tabela `CIDADES` — `[Oracle-dict]`

| Coluna | Tipo Oracle | Nulo? | Papel | → Postgres (alvo) |
|---|---|---|---|---|
| `IDCIDADE` | `NUMBER` | **NOT NULL** | **PK natural** = código **IBGE** (digitado/importado, **não** gerado) | `integer PRIMARY KEY` |
| `IDUF` | `NUMBER` | NULL (**opcional**) | FK → `UF.IDUF` (código IBGE da UF, 11..53) | `integer` (nullable) |
| `CIDADE` | `VARCHAR2(200)` | NULL (**opcional**) | nome da cidade | `varchar(200)` (nullable) |

- **PK:** `IDCIDADE` (chave natural IBGE). **Sem generator/sequence** consumida pela tela (`tcManual`). `[Oracle-dict]` + `[.pas:L63 tcManual]`
- **Sem `INDR`** → **sem soft-delete** (a exclusão é **DELETE físico** — hard-delete). `[Oracle-dict]`
- **Sem colunas de auditoria** (`USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO`/`INDR_*`) → o carimbo `SetaOperadorAlteracao` do form-base **não tem onde escrever** (ver BR-06/§6). `[Oracle-dict]`
- **Triggers:** **NENHUMA** (`REM_CIDADES` não existe) → **CIDADES não replica**. `[Oracle-dict]`
- **Sem `CODEMPRESA`/`CODOPERADOR`** → cidade é global ao tenant (BR-07). `[Oracle-dict]`

### Estrutura da tabela auxiliar `UF` — `[Oracle-dict]`

| Coluna | Tipo Oracle | Papel |
|---|---|---|
| `SIGLA` | `CHAR(2)` | sigla da UF (`SP`, `RJ`…) — é o que o `cmbUF` exibe/seleciona |
| `IDUF` | `NUMBER` | **= código IBGE da UF** (11..53) — é o que `CIDADES.IDUF` referencia |
| `PAIS` / `CODPAI` | — | país (não usado nesta tela além do select de Q3) |

> **Fato canônico `[Oracle-dict]`:** `UF.IDUF` **SÃO** os códigos IBGE (RO=11 … DF=53), **27 linhas** (só estados BR). É **por isso** que o `ufs.ts`/view `get_cidades` podem decodificar `IDUF→SIGLA` por `CASE` fixo (ver Q2) **sem** uma tabela UF no app — o mapeamento é estável e fechado. Confirma a correção da decisão de gravar `IDUF` direto.

### Q1 — `sqqCidades` (leitura de 1 cidade por código, com sigla) — `[.dfm SQL.Strings]`

- **Origem:** `udmCadCidades.dfm` `[.dfm:L78-99]` — `TFDQuery sqqCidades`, `Connection = dmPrincipal.FDConexao` (global), feeding `dspCidades` (`TDataSetProvider`) → `cdsCidades` (`TClientDataSet`).
- **Quando dispara:** ao abrir/editar uma cidade pelo código (via `SetaDataset`→`AbreDataset` do form-base; param `:CODIGO` ← `edtCodigo`/retorno da pesquisa).
- **SQL base (Oracle, verbatim do `.dfm`):**
  ```sql
  SELECT
  C.IDCIDADE,
  C.IDUF,
  C.CIDADE,
  UF.SIGLA
  FROM CIDADES C
  LEFT JOIN UF ON UF.IDUF = C.IDUF
  WHERE C.IDCIDADE = :CODIGO
  ```
- **Fragmentos condicionais:** **nenhum** (estática pura). **Sem filtro de soft-delete** (não há `INDR`) → ao contrário de Marcas, **não** esconde "excluídos" (não existem; exclusão é física).
- **Params:** `:CODIGO` (`ftInteger`, `ptInput`) `[.dfm:L93-99]` — origem: `edtCodigo` / chave selecionada na pesquisa.
- **Campos do dataset (`Required`/`ProviderFlags`):** **só `IDCIDADE` é `Required=True`** com flags `[pfInUpdate,pfInWhere,pfInKey]` `[.dfm:L100-105 e L21-26]` (é a chave do WHERE de update). `IDUF` e `CIDADE` têm só `[pfInUpdate]` (entram no SET, não no WHERE). **`SIGLA`** tem `ProviderFlags = []` `[.dfm:L117-123]` → **read-only no provider**: vem do JOIN, **nunca** é gravada na tabela `CIDADES` (não existe lá). Isso prova que `cmbUF` (bindado em `SIGLA`) é **display-only** e o `cmbUFExit` é quem persiste o valor real (`IDUF`).
- **Mutações:** leitura (Q1) + escrita (pipeline do provider, abaixo).
- **Tabelas tocadas:** `CIDADES` (CRUD) + `UF` (só leitura, via JOIN). **Sem trigger, sem sequence.**
- **SQL-alvo (Postgres / view, Kysely):** o app **não** replica o JOIN na leitura por código crua — usa a **view `get_cidades`** (que já traz `uf` decodificada por `CASE`) tanto para listar quanto para o lookup:
  ```sql
  select idcidade, iduf, cidade, uf
  from get_cidades
  where idcidade = $1
  ```
  Oracle→PG: o `LEFT JOIN UF` (que dá a sigla) vira o `CASE iduf→sigla` da view (`[013_cidades.sql:L13-27]`) — **espelha** o LEFT JOIN sem precisar da tabela UF (fato `[Oracle-dict]`: IDUF=IBGE). `NUMBER`→`integer`, `VARCHAR2(200)`→`varchar(200)`.

### Q3 — `sqqUF` (resolução SIGLA→IDUF, disparada por `cmbUFExit`) — `[.dfm SQL.Strings]`

- **Origem:** `udmCadCidades.dfm` `[.dfm:L125-143]` — `TFDQuery sqqUF` → `dspUF` → `cdsUF`. Disparada por código no handler `cmbUFExit` `[.pas:L48-50]`.
- **Quando dispara:** ao **sair do combo `cmbUF`** (`OnExit`), com a sigla escolhida.
- **SQL base (Oracle, verbatim do `.dfm`):**
  ```sql
  SELECT
  U.SIGLA,
  U.IDUF,
  U.PAIS
  FROM UF U
  WHERE U.SIGLA = :SIGLA
  ```
- **Fragmentos condicionais:** **nenhum**.
- **Params:** `:SIGLA` (`ftString`, `ptInput`) ← `cmbUF.Field.AsString` (a sigla selecionada) `[.pas:L49]`.
- **Mutações:** **leitura** (mas o handler usa o resultado para um `cdsCidades.Edit/Post` → escrita derivada de `IDUF` em memória; persiste só no Gravar).
- **Tabelas tocadas:** `UF` (leitura).
- **SQL-alvo (Postgres):** **N/A — eliminada.** No alvo, `UF_OPCOES` (`ufs.ts`) já mapeia `SIGLA↔IDUF` em memória (lista fixa, fato `[Oracle-dict]`), então o `SelectField` grava `IDUF` direto. **Sem** query à UF. Esta é a maior simplificação Oracle→novo desta tela — ver [BR-03](#5-regras-de-negócio).

### Q-PK — geração do `IDCIDADE` — **NÃO existe (chave natural)** — `[.pas:L63 tcManual]`

- `SetaDataset(..., 'IDCIDADE','CIDADES', **tcManual**)` `[.pas:L63]` → o form-base **NÃO** chama `GetID`/generator ao inserir; o `IDCIDADE` é **digitado** (código IBGE) no `edtCodigo`. ≠ Marcas (`tcAutomatica`/`ID_IDMARCA`). 
- **No alvo:** `pkGerada: false` (`cidade.crud.ts:L13`) e `pkGerada={false}` (`CidadesCadMaster.tsx:L17`) — **paridade fiel**: usuário informa o IBGE; **sem** sequence. A migração **não** cria `seq_*` para cidades (`[013_cidades.sql]` define só a PK natural).

### Q-WRITE — pipeline de gravação/exclusão (provider FireDAC) — `[inferido — herda Bancos]`

- O provider gera **DML delta-based bindada** a partir do delta do `cdsCidades` em `ApplyUpdates(0)` (WHERE pela PK `IDCIDADE`, único campo `pfInWhere`/`pfInKey`). Por analogia direta com o piloto Bancos (mesmo motor, capturado em runtime lá), o esperado:
  ```sql
  -- INSERT (só colunas tocadas; IDCIDADE digitado, IDUF resolvido pelo cmbUFExit):
  insert into "CIDADES" ("IDCIDADE","IDUF","CIDADE") values (:1,:2,:3)
  -- UPDATE de edição (só colunas alteradas; WHERE pela PK):
  update "CIDADES" set "CIDADE" = :1, "IDUF" = :2 where "IDCIDADE" = :3
  -- exclusão = DELETE FÍSICO (NÃO há INDR → hard-delete; ver BR-05/§6):
  delete from "CIDADES" where "IDCIDADE" = :1
  ```
- **Carimbo de auditoria:** **NÃO aplicável** — `CIDADES` não tem `USULTALTERACAO`/`DT*` `[Oracle-dict]`. O `SetaOperadorAlteracao` do form-base, se chamado, **não tem coluna para escrever** (o app codificou `audit:false`). Confirmar em runtime que o form-base **pula** o carimbo quando as colunas não existem (esperado; senão, erro de coluna inexistente — improvável pois a tela roda em produção). Marcar `[inferido — herda Bancos / a confirmar runtime]`.
- **Tabelas/triggers:** só `CIDADES`. **Zero trigger** → **zero escrita-fantasma de replicação** `[Oracle-dict]`.
- **SQL-alvo (Postgres):** `insert/update` explícitos no engine CRUD; exclusão = **`delete from cidades where idcidade=$1`** (hard-delete, `audit:false`/`replica:false`/`softDelete` ausente em `cidade.crud.ts`).

> **Regra de ouro:** Q1 e Q3 (leituras) e a estrutura/`get_cidades` estão **confirmadas** (`.dfm` verbatim + `[Oracle-dict]`). O **pipeline de escrita** (Q-WRITE) e a **SQL final da pesquisa** (Q2) seguem `[inferido]` (herdados do motor de Bancos) **até captura de runtime** (`V$SQL`) específica de CIDADES. A paridade hoje é de **RESULTADO** (smoke/integração verde no novo, §9); o **golden RUNTIME do legado é pendência**. **Não declarar `paridade-verde`/`concluído` sem ele** — ver [Lacunas](#lacunas--perguntas).

### Q2 — Pesquisa / listagem (`btnPesquisa` → `frmPesquisa` sobre `GET_CIDADES`) — `[estático]` + view `[Oracle-dict]`

- **Origem:** form-base `TfrmCadMaster.btnPesquisaClick` abre `frmPesquisa` (`uPesquisa.pas`) sobre a **VIEW `GET_CIDADES`** (`FViewPesquisa = 'GET_' + FTabela = 'GET_CIDADES'`). `FCampoRetornoPesquisa='IDCIDADE'` `[.pas:L64]` → ao escolher, devolve o `IDCIDADE` p/ recarregar via Q1.
- **View `GET_CIDADES` (legado):** `[Oracle-dict]` — faz **`LEFT JOIN UF`** para trazer a **`SIGLA`** junto de `IDCIDADE`/`IDUF`/`CIDADE` (o grid de pesquisa mostra a **sigla**, não o `IDUF` cru). **Sem** filtro de soft-delete (não há `INDR`).
- **Equivalente no alvo (`get_cidades`):** `[013_cidades.sql:L13-27]` — em vez de `LEFT JOIN UF`, decodifica `CASE iduf→uf` (alias **`uf`**) — **mesmo resultado** (sigla ao lado da cidade), espelhando o LEFT JOIN real (justificado por `[Oracle-dict]`: IDUF=IBGE). Colunas de pesquisa no app: `['idcidade','cidade','iduf','uf']` (`cidade.crud.ts:L19`) e no front `IBGE / Cidade / UF` (`CidadesCadMaster.tsx:L19-23`).
- **SQL final esperada (por analogia com Bancos, `[inferido]`):**
  ```sql
  select FORM from TABELA_CADASTRO where TABELA = 'GET_CIDADES'   -- config do form de pesquisa
  select Cast('F' as CHAR(1)) as Selecionar, Cast('T' as CHAR(1)) as Sel, GET_CIDADES.*
  from GET_CIDADES [ + filtro/ordem do usuário ]
  ```
  **Sem** `WHERE COALESCE(INDR…)` (não há soft-delete nesta tela) — diferença direta para Marcas/Bancos.
- **Alvo:** `GET /cadastro/cidades?filtro=...` — lista paginada sobre `get_cidades` (sem filtro de INDR). 

---

## 5. Regras de negócio

| ID | Regra | Gatilho | Lógica (verbatim do legado) | *Porquê* | Procedência |
|---|---|---|---|---|---|
| BR-01 | **Permissão por form+ação (RBAC)** | ao gravar / editar / excluir | `dmPrincipal.PossuiAcessoForm('frmCadCidades','BTNGRAVAR')` (e `'BTNEXCLUIR'`/`'BTNEDITAR'`/`'BTNADICIONARREGISTRO'`); sem permissão → cancela | RBAC data-driven por tela/ação | `[.pas form-base — herdado]` + `[013_cidades.sql:L41-45 concede FRMCADCIDADES]` |
| BR-02 | **Obrigatórios (na prática só a PK)** | ao gravar | `ValidaObrigatorios` percorre `Fields[i].Required`; **só `IDCIDADE` é `Required=True`** `[.dfm:L100-105]`. `IDUF` e `CIDADE` **não** são Required (e ambos nullable na tabela). → **gravar com `CIDADE` e/ou `IDUF` vazios é permitido** | a tela não exige nome nem UF (colunas opcionais `[Oracle-dict]`) | `[.dfm udmCadCidades:L21-37]` + `[Oracle-dict: IDUF/CIDADE nullable]` |
| BR-03 | **UF: SIGLA→IDUF (legado) ⇒ grava IDUF direto (novo)** | ao sair do combo UF (`cmbUFExit`) | Legado: combo bindado em `SIGLA`; `cmbUFExit` consulta `UF WHERE SIGLA=:sigla` (Q3) e grava `cdsCidadesIDUF := cdsUFIDUF`. **Novo:** `SelectField`/`UF_OPCOES` (value=`iduf`) grava `IDUF` direto — **sem** round-trip | a coluna real persistida é `IDUF` (numérico, FK); o legado resolvia em runtime via tabela UF, o novo usa a lista fixa (fato `[Oracle-dict]`: IDUF=IBGE, 27 linhas estáveis) | `[.pas:L42-56]` + `[ufs.ts]` + `[CidadesCadMaster.tsx:L36-49]` |
| BR-04 | **PK = chave natural digitada (não gerada)** | ao inserir | `SetaDataset(...,'IDCIDADE','CIDADES', **tcManual**)` → **sem** `GetID`/generator; `IDCIDADE` digitado no `edtCodigo` | `IDCIDADE` é o **código IBGE** (identidade externa estável) — gerar localmente quebraria a referência IBGE | `[.pas:L63]` + `[Oracle-dict: IDCIDADE PK natural]` |
| BR-05 | **Exclusão = HARD-DELETE** | ao excluir | `CIDADES` **não tem `INDR`** → `ExcluirRegistro` cai no caminho de **DELETE físico** (`ApplyUpdates` emite `DELETE`); **não** há `INDR:='E'` nem `ATIVO` | tabela geográfica de referência; sem necessidade de histórico de exclusão — **mas atenção à FK de Bairros** (a exclusão falha se houver bairro referenciando) | `[.pas form-base — caminho sem INDR]` + `[Oracle-dict: sem INDR/ATIVO]` + `[013_cidades.sql:L38-39 FK bairro→cidade]` |
| BR-06 | **Sem carimbo de auditoria** | ao gravar | `CIDADES` **não tem** `USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO` → o `SetaOperadorAlteracao` do form-base não persiste carimbo | a tabela real só tem `idcidade/iduf/cidade` (`audit:false` no app) | `[Oracle-dict]` + `[cidade.crud.ts:L17 audit:false]` |
| BR-07 | **Sem empresa/operador como FK; cidade é global** | ao gravar | `SetaDataset` sem `PreencheEmpresa`/`PreencheOperador`; `CIDADES` não tem `CODEMPRESA`/`CODOPERADOR` | referência geográfica é global ao tenant | `[.pas:L63]` + `[Oracle-dict]` |
| BR-08 | **Sem replicação (sem trigger `REM_*`)** | ao gravar/excluir | `CIDADES` não tem trigger → não gera escrita-fantasma de replicação | cadastro de retaguarda, não vai por outbox isolado | `[Oracle-dict]` + `[cidade.crud.ts:L18 replica:false]` |

> **Sem cálculo, sem regra fiscal, sem máscara, sem CharCase.** As "regras" são o **contrato do form-base** + **três fatos da tabela** que invertem Marcas/Bancos: **chave natural** (BR-04), **hard-delete** (BR-05) e **sem auditoria/sem replicação** (BR-06/BR-08) — mais o **único desvio próprio**, a resolução **SIGLA→IDUF** (BR-03). O *porquê* canônico de BR-04: `IDCIDADE` é o IBGE; gerar um id local divergiria do código oficial usado por integrações fiscais/endereço.

---

## 6. Efeitos colaterais + estado externo

> A seção que salva da armadilha de acoplamento.

| Item | Tipo (lê/grava) | Alvo | Quem setou / quem consome | Mapeamento alvo |
|---|---|---|---|---|
| `dmPrincipal.FDConexao` | usa | conexão Oracle **global** | datamodule principal (boot) | conexão **por tenant** request-scoped ([hidden-coupling-traps.md](../../03-legacy-analysis/hidden-coupling-traps.md)) |
| `dmPrincipal.OperadorCODOPERADOR` | lê | operador logado | login | usuário no request context (fail-closed) — usado só p/ RBAC (não há carimbo) |
| `dmPrincipal.PossuiAcessoForm` | lê | RBAC (tabela de permissões) | login/permissões | guard/policy por rota+ação (`FRMCADCIDADES`) |
| **tabela `UF`** | **lê** | tabela auxiliar Oracle | populada por carga; lida por Q3 no `cmbUFExit` | **lista fixa `UF_OPCOES`/`UFS`** (`ufs.ts`) — **não há tabela/endpoint UF no app** (fato `[Oracle-dict]`: 27 linhas estáveis = IBGE) |
| `cdsUF` (dataset auxiliar) | lê/escreve (memória) | DM da tela | aberto/fechado por `cmbUFExit` | eliminado (sem dataset auxiliar) |
| `IDUF` em `cdsCidades` | grava (memória→DB no Post) | coluna `CIDADES.IDUF` | `cmbUFExit` | valor do `SelectField` |
| `HISTORICO_DINAMICO` | grava (indireto) | tabela de histórico genérica | `SetaHistorico_Dinamico` herdado **se `cdsHistorico_dinamico.Active`** | audit log / interceptor (decidir manter) |
| `TLog.GravaLog` | grava | log de aplicação | gravar herdado (best-effort) | logging estruturado |
| `MENUEXPRESS` | grava | telemetria de uso | ao abrir: `ACESSOS=ACESSOS+1 WHERE FORMULARIO='FRMCADCIDADES'` (padrão do form-base; `[inferido]`) | métrica de uso (opcional) |
| **carimbo de auditoria** | **N/A — colunas não existem** | — | `SetaOperadorAlteracao` herdado sem destino | **não aplicável** (`audit:false`) `[Oracle-dict]` |
| **trigger `REM_CIDADES`** | **N/A — NÃO EXISTE** | — | — | **sem replicação** (`replica:false`) `[Oracle-dict]` |
| **FK `fk_bairro_cidade`** | restringe DELETE | integridade Bairro→Cidades | `[013_cidades.sql:L38-39]` | FK no Postgres — **DELETE de cidade referenciada por bairro falha** (efeito a testar, BR-05) |

- **Conexão/transação:** usa a conexão **global** do `dmPrincipal`. ⚠️ **`cmbUFExit` faz um `cdsCidades.Edit/Post` no meio da edição** (commit do delta em memória do cds, não do banco) — mas mexe no estado do dataset principal a partir de um `OnExit`; em runtime, confirmar que não há reentrância com a máquina de estados do form-base. No alvo: a UF é só um valor do formulário (react-hook-form), sem efeito colateral.
- **Ordem de abertura assumida:** presume login feito (operador/permissões em `dmPrincipal`) e a tabela `UF` populada (senão Q3 retorna vazio e `IDUF` fica nulo). No alvo, `UF_OPCOES` é estático (sempre disponível).

> **Diferença para os pilotos:** Cidades **não tem** carimbo de auditoria (≠ Marcas/Bancos, que têm), **não tem** soft-delete (≠ Marcas), **não tem** replicação (≠ Bancos). O efeito colateral **próprio e único** é a **leitura da tabela `UF`** no `cmbUFExit` para resolver `IDUF` — eliminado no alvo pela lista fixa. A novidade de risco é a **FK de Bairros** apontando p/ Cidades: o hard-delete pode ser **bloqueado** pela integridade referencial (comportamento desejável, mas precisa de teste — ver §9).

---

## 7. Dependências

| Dependência | Tipo | Como é usada | Vira (alvo) |
|---|---|---|---|
| `TfrmCadMaster` (`uCadMaster.pas`) | **herança** | todo o CRUD: gravar/editar/excluir/pesquisar/navegar, validação, RBAC, teclado, máquina de estados (aqui: **hard-delete**, **sem carimbo**, **PK manual**) | **engine CRUD reutilizável** (`createCrudController` + pilar `CadMaster`, ADR-014) |
| `TdmCadCidades` (`udmCadCidades`) | datamodule | `sqqCidades`→`dspCidades`→`cdsCidades` (Q1) **e** `sqqUF`→`dspUF`→`cdsUF` (Q3, resolução de UF) | `cidadeCrudConfig` (declarativo) + `UF_OPCOES` (a UF some como dataset) |
| `udmPrincipal` (`dmPrincipal`) | datamodule global | conexão, operador, RBAC | tenant context + providers |
| `uPesquisa` (`frmPesquisa`) | form modal | pesquisa sobre `GET_CIDADES` (Q2); retorna `IDCIDADE` | serviço de listagem/filtro paginado |
| **tabela/view `UF` / `GET_CIDADES`** | objeto de banco | `UF` (resolução SIGLA→IDUF) e `GET_CIDADES` (LEFT JOIN p/ sigla na pesquisa) | `UF_OPCOES` (fixo) + view `get_cidades` (CASE iduf→uf) `[013_cidades.sql]` |
| `FuncoesApollo` | unit util | `SetaDataset`, `SetaFoco`, etc. | utils/serviços compartilhados |
| FastReport (`frx*`), JVCL (`Jv*`) | libs | `TJvDBComboBox` (combo UF) + export/UI herdados | `SelectField` do DS + export server-side |

> **Dependência de dados externa (não óbvia):** a tela **depende da tabela `UF` estar populada** para o `cmbUFExit` resolver o `IDUF`. No app, essa dependência some — `UFS`/`UF_OPCOES` é reference data fixa em `ufs.ts` (justificado por `[Oracle-dict]`: a UF tem só 27 linhas estáveis = códigos IBGE). **Bairros NÃO é gerido aqui** (Cidades é o **alvo** da FK de Bairros, não o gestor) — `[013_cidades.sql:L38-39]`.

---

## 8. TabOrder + mapa de atalhos/mnemônicos

**TabOrder (campos próprios, sequência exata `[.dfm]`):**

| Ordem | Controle | Campo | Tipo | Enter faz | Foco condicional |
|---|---|---|---|---|---|
| 0 | `cmbUF` | SIGLA→IDUF | `TJvDBComboBox` | avança | `OnExit=cmbUFExit` resolve IDUF; em `btnEditar`, foco entra aqui (`SetaFoco(cmbUF)` `[.pas:L39]`) |
| 1 | `edtCidade` | CIDADE | `TDBEdit` | avança | — |

`[.dfm:L82 (cmbUF TabOrder=0), L45 (edtCidade TabOrder=1)]`. Antes destes, o foco inicial em modo busca é `edtCodigo` (PK **digitável**, herdado) via `SetaDataset`. Em **edição** (`btnEditarClick`), foco vai p/ `cmbUF` `[.pas:L39]`.

**Mnemônicos `&` (Alt+letra) — campos próprios:** **NENHUM** no legado. `Label1.Caption='UF'` e `Label2.Caption='CIDADE'` **sem `&`** `[.dfm:L28,L35]` (apenas `Label2.FocusControl=edtCidade`, mas sem mnemônico não há atalho). *(O app novo adiciona `&Cidade` (Alt+C) e `&UF` (Alt+U) — melhoria consciente, ver §2.)*

**Atalhos de botão (herdados do form-base — [form-base-cadmaster.md §4](../../03-legacy-analysis/recon/form-base-cadmaster.md)):**

| Botão | Caption | Mnemônico | Ação |
|---|---|---|---|
| `btnEditar` | `&Editar` | Alt+E | entra em edição (depois foca `cmbUF`, BR/§3) |
| `btnExcluir` | `E&xcluir` | Alt+X | exclui — **HARD-DELETE** (BR-05) |
| `btnGravar` | `&Gravar` | Alt+G | grava |
| `btnCancelar` | `&Sair` / `&Cancelar` | Alt+S / Alt+C | sai/cancela (caption alterna) |
| `btnAdicionarRegistro` | `&Adicionar` | Alt+A | novo registro (PK digitada, BR-04) |
| `btnOutros` | `&Outros` | Alt+O | popup `ppmBotaoOutros` |
| `rdgAtivo` | `Ati&vo [F6]` | Alt+V / **F6** | cicla filtro (N/A prático: CIDADES não tem `ATIVO` **nem** `INDR` → inócuo) |

**Teclas funcionais/navegação (herdadas, `KeyPreview`/`FormKeyDown`):** **Esc** engolida durante insert/edit; **F6** cicla `rdgAtivo` (inócuo aqui); **Alt+O** "Outros"; **←/→** em `edtCodigo` = registro anterior/próximo; **↑/↓** = primeiro/último; **Enter** em `edtCodigo` = carrega pelo código. Comum às ~101 herdeiras → config-padrão do engine CRUD (ADR-010).

---

## 9. Casos de teste (golden)

> ⚠️ **Paridade de RESULTADO (verde no novo), golden RUNTIME do legado = PENDÊNCIA.** Diferente de [Bancos](uCadBancos.md) (captura `V$SQL`/`REMESSA_SERVER` certificada), aqui a confiança vem de: (a) `.dfm` verbatim (Q1/Q3), (b) **fatos `[Oracle-dict]`** (estrutura, sem INDR/auditoria/trigger, IDUF=IBGE), (c) o motor `TfrmCadMaster`/FireDAC já provado em runtime no piloto, e (d) os **casos de smoke/integração do novo abaixo passando verde** (lista seed=4; FK iduf válida/inválida). A coluna "Procedência" marca o que é **RESULTADO verde no novo** vs. o **RUNTIME do legado a capturar** (mesma técnica do piloto — [dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md)).

| ID | Cobre (BR/Q + caminho) | Input (estado + campos) | Ação | Output esperado | Procedência |
|---|---|---|---|---|---|
| G-01 | Q2/lista (view `get_cidades`) | seed inicial (`013_cidades.sql`) | listar | **4 linhas** (São Paulo 3550308/SP, Campinas 3509502/SP, Rio 3304557/RJ, BH 3106200/MG) com coluna `uf` decodificada | ✅ RESULTADO verde no novo (seed=4) · legado RUNTIME pendente |
| G-02 | Q1 leitura por código | abrir `idcidade=3550308` | carregar | retorna `{idcidade:3550308, iduf:35, cidade:'SAO PAULO', uf:'SP'}` | ✅ SQL `.dfm` confirmada + view; RESULTADO verde no novo · legado RUNTIME pendente |
| G-03 | BR-03 + BR-04 INSERT (FK iduf **válida**) | adicionar `idcidade=4106902` (Curitiba IBGE), `cidade='CURITIBA'`, UF=`PR`(iduf=41) | gravar | `insert into cidades(idcidade,iduf,cidade) values(4106902,41,'CURITIBA')`; **PK digitada** (sem sequence); `uf` na view = `PR` | ✅ RESULTADO verde no novo (FK iduf válida) · legado RUNTIME pendente (`[inferido]` write + Q3 SIGLA→IDUF) |
| G-04 | BR-03 FK iduf **inválida** | gravar cidade com `iduf` fora de 11..53 (ex.: 99) | gravar | **rejeitado** (no novo: `iduf` fora de `UF_OPCOES` → não selecionável; view decodifica `ELSE NULL`); legado: Q3 `UF WHERE SIGLA=:x` não retorna → `IDUF` nulo | ✅ RESULTADO verde no novo (FK/lista inválida) · legado RUNTIME pendente |
| G-05 | BR-02 obrigatórios | adicionar com `cidade` e `iduf` **vazios**, só `idcidade` | gravar | **grava** (só `IDCIDADE` é Required; `IDUF`/`CIDADE` nullable) — não bloqueia | ✅ `.dfm` Required + `[Oracle-dict]` nullable; RESULTADO verde no novo · legado RUNTIME pendente |
| G-06 | BR-05 HARD-delete | excluir cidade **não referenciada** por bairro | excluir | `delete from cidades where idcidade=:id` (**DELETE físico**, não soft) — some da lista | ✅ lógica confirmada (`[Oracle-dict]` sem INDR); RESULTADO verde no novo · legado RUNTIME pendente |
| G-07 | BR-05 + FK Bairros | excluir cidade **referenciada** por um bairro | excluir | **bloqueado** pela FK `fk_bairro_cidade` (integridade) — erro de violação | ✅ FK em `013_cidades.sql:L38-39`; RESULTADO a exercitar no novo · legado: comportamento Oracle equivalente, RUNTIME pendente |
| G-08 | BR-01 RBAC | operador sem `BTNGRAVAR` | gravar | bloqueado **antes do banco** (cancel), **zero DML** | ✅ lógica confirmada (form-base + permissões `013_cidades.sql:L41-45`); legado RUNTIME pendente |
| G-09 | Q3 (legado) SIGLA→IDUF | escolher `SP` no combo | sair do combo | legado: `select SIGLA,IDUF,PAIS from UF where SIGLA='SP'` → grava `IDUF=35`. **No novo: N/A** (grava 35 direto via `UF_OPCOES`) | ✅ SQL `.dfm` confirmada; **legado RUNTIME pendente** (provar que IDUF gravado = 35) |

**Negativos/zero-DML:** G-05 (obrigatório — **não** bloqueia, ao contrário de Bancos), G-08 (RBAC — bloqueia antes do banco), G-07 (FK — bloqueia no banco).

> **Registro explícito da pendência:** os casos acima cobrem a **paridade de RESULTADO** do novo (verde nos smoke/integração: seed=4, FK iduf válida G-03 / inválida G-04). O **golden RUNTIME do legado** (capturar `V$SQL` exercitando criar+editar+excluir 1 cidade + o `cmbUFExit` real, G-09) **não foi capturado** → **bloqueia `paridade-verde`/`concluído`**.

---

## 10. Alvo (especificação de implementação)

**Backend (NestJS — engine CRUD declarativo):**
- Módulo: `cadastro/cidades` (já implementado, `cidade.crud.ts`).
- Endpoints:
  | Método+rota | Origem | DTO (zod) | Mutação? |
  |---|---|---|---|
  | `GET /cadastro/cidades` | Q2 | filtro (lista sobre `get_cidades`, **sem** filtro de INDR) | leitura |
  | `GET /cadastro/cidades/:idcidade` | Q1 | — | leitura |
  | `POST /cadastro/cidades` | btnGravar (insert) | `cidadeSchema` | escrita (PK natural, sem sequence) |
  | `PUT /cadastro/cidades/:idcidade` | btnGravar (update) | `atualizarCidadeSchema` | escrita |
  | `DELETE /cadastro/cidades/:idcidade` | btnExcluir | — | escrita = **HARD-DELETE** (sujeito à FK de Bairros) |
- Para o **service/engine**: RBAC (BR-01) via `rbacForm:'FRMCADCIDADES'`; `pkGerada:false` (BR-04, PK digitada); `audit:false` (BR-06, sem carimbo); `replica:false` (BR-08, sem outbox); **sem soft-delete** → hard-delete (BR-05). Tudo em `cidadeCrudConfig` `[cidade.crud.ts:L10-20]`.
- Para o **DTO/zod** (`cidade.schema.ts`): `idcidade` **obrigatório** `int().positive()` (código IBGE, BR-04); `iduf` **opcional** `int()` (BR-02/BR-03); `cidade` **opcional** `max(200)` (BR-02, fiel ao legado — **sem** "obrigatório", **sem** uppercase forçado pois não há `CharCase`).
- **UF como reference data:** `UFS`/`UF_OPCOES` (`ufs.ts`) — lista fixa (IDUF=IBGE, `[Oracle-dict]`), **sem** tabela/endpoint UF. O `iduf` é gravado direto (BR-03), eliminando a Q3 (`cmbUFExit`).
- Tenant: conexão global → conexão por tenant; operador do request context (fail-closed, usado só p/ RBAC).

**Frontend (React — via `CadMaster`/engine CRUD, ADR-014):**
- Rota `/cadastro/cidades` (lista) + `/cadastro/cidades/:idcidade` (form). `pkGerada={false}` (`CidadesCadMaster.tsx:L17`) → `edtCodigo` (IBGE) digitável.
- Campos: `&Cidade` (Field, col-span-2, taborder lógico) + `&UF` (`SelectField` com `UF_OPCOES`, value=`iduf`). `colunasPesquisa`: IBGE / Cidade / UF.
- Decisão consciente: app adiciona mnemônicos `&Cidade`/`&UF` ausentes no legado, e **substitui a resolução SIGLA→IDUF (cmbUFExit) por gravação direta de IDUF** — melhorias/simplificações que **mantêm paridade de resultado** (IDUF gravado é o mesmo). ADR-010 é piso.

**Decisões offline (PDV/Electron — ADR-008):** Cadastro de cidade roda na **retaguarda/nuvem**, não no PDV. **Sem replicação** (sem `REM_CIDADES`), então não há delta de sync próprio. Se a cidade alimentar a carga inicial do PDV, será **indireto** (via endereço de parceiro/produto), não por CIDADES isolada. **Sem escrita offline, sem contingência fiscal** nesta tela.

---

## Paridade com o novo

A tela **já está implementada declarativamente** (espírito ADR-014) e **verde por RESULTADO** nos smoke/integração:

- **Backend:** `/Library/Apollo/apps/api/src/modules/cadastro/cidade.crud.ts` — `cidadeCrudConfig`:
  ```ts
  { tabela:'cidades', pk:'idcidade', pkGerada:false, view:'get_cidades',
    colunas:['iduf','cidade'], rbacForm:'FRMCADCIDADES',
    audit:false,   // sem USULTALTERACAO/DT* (BR-06) ✅ fiel ([Oracle-dict])
    replica:false, // sem trigger REM (BR-08) ✅ fiel ([Oracle-dict])
    colunasPesquisa:['idcidade','cidade','iduf','uf'] }
  ```
  (chave natural via `pkGerada:false` ✅ BR-04; hard-delete por ausência de `softDelete` ✅ BR-05).
- **Schema:** `/Library/Apollo/packages/shared/src/schema/cidade.schema.ts` — `idcidade` int positivo (IBGE, ✅ BR-04), `iduf` opcional (✅ BR-02/BR-03), `cidade` opcional max(200) (✅ BR-02, não-obrigatório, sem uppercase).
- **UF (reference data):** `/Library/Apollo/packages/shared/src/ufs.ts` — `UFS` (27 linhas, IDUF=IBGE ✅ `[Oracle-dict]`) + `UF_OPCOES` (value=`iduf`, label=`SIGLA — Nome`). Substitui a tabela `UF` + Q3.
- **Frontend:** `/Library/Apollo/apps/web/src/features/cidades/CidadesCadMaster.tsx` — `<CadMaster pk="idcidade" pkGerada={false} viewPk... />` com `Field` `&Cidade` + `SelectField` `&UF` (grava `iduf` direto). 
- **Migração:** `/Library/Apollo/apps/api/migrations/013_cidades.sql` — tabela `cidades` (3 colunas, PK natural ✅), `view get_cidades` (CASE iduf→uf espelhando o LEFT JOIN ✅ `[Oracle-dict]`), seed de **4 cidades reais** (G-01), **FK `fk_bairro_cidade`** (G-07), e `permissoes` p/ `FRMCADCIDADES` (BR-01). Comentários do arquivo já citam "audit:false, hard-delete", "IDCIDADE = IBGE", "LEFT JOIN em UF do GET_CIDADES real".

> 🟢🟡 **Status de paridade: FIEL-POR-CONSTRUÇÃO e VERDE por RESULTADO; golden RUNTIME do legado = PENDÊNCIA.** A implementação espelha corretamente os achados (chave natural, hard-delete, sem auditoria/replicação, IDUF direto, view com `uf` decodificada) e **passa nos smoke/integração** (lista seed=4; FK iduf válida G-03 / inválida G-04). **MAS não há golden de RUNTIME do legado CIDADES** capturado via `V$SQL` (criar/editar/excluir + `cmbUFExit`). Portanto CIDADES **não pode ser marcada `paridade-verde`/`concluído`** pelos critérios de [dossier-process.md](../dossier-process.md): falta a captura de runtime do legado (Q-WRITE/Q2/Q3 ainda `[inferido]`/`[estático]`) e a 2ª revisão independente.

---

## Lacunas / perguntas

1. **Golden RUNTIME do legado de CIDADES não capturado** — Q-WRITE (INSERT/UPDATE/**DELETE físico** delta-based) e a SQL final da pesquisa (Q2) estão `[inferido]` (motor de Bancos); o `cmbUFExit`/Q3 (SIGLA→IDUF, G-09) está `[estático]` (`.dfm` verbatim). Capturar via `V$SQL` exercitando a tela legada (criar+editar+excluir 1 cidade + sair do combo UF), mesma técnica do piloto. **Bloqueia `paridade-verde`.** (A paridade de RESULTADO do novo já está verde — registrar essa distinção.)
2. **2ª revisão independente** pendente (etapa 2 do loop) — outro agente deve auditar dossiê + código contra o `.pas`.
3. **`FormActivate` cria o DM sem `FreeAndNil` próprio** `[.pas:L58-61]` (≠ Marcas, que libera no `FormClose`) — confirmar em runtime se reativações recriam/vazam o `dmCadCidades` (Owner=Self mitiga, mas reentrância é possível). Inócuo no alvo (sem DM de instância).
4. **Carimbo de auditoria** — confirmar em runtime que o form-base **pula** `SetaOperadorAlteracao` quando `CIDADES` não tem as colunas (esperado; `audit:false` no app). 
5. **FK Bairros bloqueando hard-delete (G-07)** — exercitar no novo: excluir cidade referenciada por bairro deve falhar pela `fk_bairro_cidade`. Confirmar mensagem/comportamento equivalente ao legado.
6. **Ordenação do combo UF** — legado: alfabética por sigla `[.dfm:L54-110]`; novo (`UF_OPCOES`): por código IBGE. Divergência cosmética — confirmar que é aceitável (provável; não afeta o IDUF gravado).
7. **`HISTORICO_DINAMICO` e telemetria `MENUEXPRESS`** — herdados do form-base, disparam em gravar/excluir se ativos; **não implementados** no app. Decidir manter/descartar (pendência comum a Marcas/Bancos).
8. **`rdgAtivo`/F6** — inócuo aqui (CIDADES não tem `ATIVO` nem `INDR`); confirmar em runtime que F6 não cicla nada visível (provável).

## Ver também

- [dossier-template.md](../dossier-template.md) · [dossier-process.md](../dossier-process.md)
- [uCadMarcas.md](uCadMarcas.md) — herdeira com **soft-delete + auditoria + PK gerada** (espelho **oposto** de Cidades em quase tudo).
- [uCadBancos.md](uCadBancos.md) — o piloto (único com golden de RUNTIME certificado); referência do motor `TfrmCadMaster`/FireDAC reusado aqui.
- [../../03-legacy-analysis/recon/form-base-cadmaster.md](../../03-legacy-analysis/recon/form-base-cadmaster.md) — o contrato do `TfrmCadMaster` que esta tela herda (com os caminhos **hard-delete**/**sem carimbo**/**PK manual**).
- [../../03-legacy-analysis/dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md) — como fechar as seções 4 e 9 (capturar o RUNTIME do legado de CIDADES).
- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — ADR-008/010/011/012/014.

---

## Checklist de fechamento

- [x] Seções 1–10 preenchidas; nenhum campo em branco (só valor ou `N/A — motivo`).
- [~] **Toda** SQL reconstruída com todos os caminhos (seção 4: Q1/Q3 verbatim do `.dfm`; Q-WRITE/Q2 `[inferido]`) — **falta confirmar em RUNTIME** (`V$SQL`).
- [x] Cada regra de negócio (seção 5) tem o *porquê* e procedência.
- [x] Estado externo/datamodules mapeados (seção 6) — incl. leitura da tabela `UF` (Q3) e FK de Bairros; trigger/auditoria marcados `N/A` com motivo `[Oracle-dict]`.
- [x] Mapa de teclado extraído do `.dfm` (seção 8).
- [~] Golden cobrindo cada condicional/regra (seção 9) — **paridade de RESULTADO verde no novo**; **golden RUNTIME do legado = PENDÊNCIA**.
- [ ] Dossiê **revisado** por agente independente.
- [~] **Paridade**: verde por RESULTADO no novo; **falta** golden de runtime do legado p/ certificar.
- [x] Dossiê versionado junto do código-alvo (013_cidades.sql / cidade.crud.ts / CidadesCadMaster.tsx / cidade.schema.ts / ufs.ts).
