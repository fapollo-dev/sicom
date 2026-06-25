# Mapa de Reconhecimento do Legado

> Reconhecimento do terreno (entender, **não** migrar) do ERP Apollo legado: inventário técnico do código Delphi, mapa de módulos, estado global, como a SQL é montada, volume/estrutura do banco Oracle, o risco-coroa fiscal/TEF/periféricos, candidatos a tela-piloto e as lacunas que dependem de decisão de produto. Trabalho **read-only**, por amostragem inteligente sobre `/Library/SicomGit` (código) e o banco Oracle `192.168.1.230:1521/apollo` (via cliente `python-oracledb` thin, só leitura de dicionário/estatística).

## Pré-requisitos de leitura

- [../../00-orientation/mission-and-principles.md](../../00-orientation/mission-and-principles.md) — "migre o que o sistema faz, não o que a tela mostra"; o risco-coroa fiscal.
- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — ADR-003/004 (tenancy), ADR-008 (PDV Electron), ADR-010 (teclado), ADR-011 (Oracle→PG), ADR-012 (dossiê).
- [../delphi-anatomy.md](../delphi-anatomy.md), [../dynamic-sql-extraction.md](../dynamic-sql-extraction.md), [../hidden-coupling-traps.md](../hidden-coupling-traps.md) — os métodos de leitura aplicados aqui.

> **Status do preflight:** ✅ Playbook (`/Library/Apollo`) · ✅ Legado Delphi (`/Library/SicomGit`) · ✅ Banco Oracle (alcançável e consultável após instalar `python-oracledb` thin no ambiente). Os três pilares verdes.

---

## A) Inventário técnico

| Item | Achado | Evidência |
|------|--------|-----------|
| **IDE / compilador** | **Delphi 10.2 Tokyo** (RAD Studio, `ProjectVersion 18.2`), **Win32**, framework **VCL**, compilador `DCC32` | `vendas-master/fonte/Pdv.dproj` |
| **Executáveis (`.dpr`)** | **3**: `Retaguarda.dpr` (back-office), `Pdv.dpr` e `ApPDV.dpr` (frente de caixa / vendas) | `find *.dpr` |
| **Arquivos-fonte** | ~**2.231** arquivos Delphi. Retaguarda: 1.074 `.pas` / 990 `.dfm`. Vendas/PDV: 104 `.pas` / 60 `.dfm` | `find` por extensão |
| **Linhas de código** | ~**641 mil** linhas `.pas` (retaguarda **580.904** + vendas **60.501**) | `wc -l` |
| **Suíte de UI** | **DevExpress** (dominante): `cxGrid` (~7.859 ocorrências), `cxGridDBTableView` (778), `cxButton`, `cxTextEdit`, `cxLookupComboBox`, `cxPageControl`; há `uTraducaoComponentesDevExpress` no boot. Também componentes **JVCL** (`Jv*`) em telas antigas | grep em `.dfm`; `Retaguarda.dpr` |
| **Relatórios** | **FastReport** (`frxReport` ~1.018 ocorrências, `frxExportPDF/XLS/XML`) | grep em `.dfm`/`.pas` |
| **Camada de acesso a dados** | **Híbrida**, padrão "briefcase" 3-camadas **local**: `TClientDataSet` (~4.008) ← `TDataSetProvider` (~2.213) ← `TFDQuery`/**FireDAC** (~3.017) **e** `TSQLQuery`/**DBExpress** (~673). Conexão: `TFDConnection` (56) predominante, `TSQLConnection` (2). **DataSnap remoto quase ausente** (2 server modules) → o provider/cds é local, o app fala direto com o banco | grep censo de tipos |
| **Banco do legado** | **Oracle** via FireDAC (`DriverID=Ora`); refs residuais a Interbase (legado morto) | grep `DriverName/DriverID` |
| **Formato `.dfm`** | **ASCII texto** (parseável) — a premissa de [../delphi-anatomy.md](../delphi-anatomy.md) (extrair scaffold/taborder/mnemônicos/sementes de SQL via parser) **se confirma** | `file` nas amostras |
| **Fiscal / periféricos** | Biblioteca **ACBr** (open-source BR): `ACBrNFe` (194), `ACBrPosPrinter` (70), `ACBrNFeDANFEFR/FR1` (DANFE via FastReport), `ACBrBAL` (balança), `ACBrPAF`, `ACBrBlocoX`, `ACBrMail` | grep `ACBr*` |

> **Leitura:** stack clássica de ERP Delphi de ~20 anos, **monolítica e thick-client** — toda a lógica roda no executável que fala direto com o Oracle. A boa notícia (canon): é **procedural e legível**, e os `.dfm` são texto. A má: o volume (641k linhas) e o estado global (abaixo) são grandes.

---

## B) Mapa de módulos

Três executáveis, dois universos de tamanho e maturidade muito diferentes.

### 1. Retaguarda (`retaguarda-master`) — o gigante back-office
- **~581k linhas**, 1.074 `.pas`, 990 `.dfm`, **1 executável** (`Retaguarda.exe`).
- Estrutura **plana**: quase tudo em `fonte/Units/`, com `fonte/DmOld/` (datamodules antigos) e `fonte/Objetos/`.
- **~101 telas de cadastro** (`UCad*`/`uCad*`). Convenção de nomes firme: `frm*`=form, `udm*`/`Rdm*`/`dm*`=datamodule, `UCad*`=cadastro.
- **Herança visual**: cadastros herdam de um **form-base `TfrmCadMaster`** (`uCadMaster.pas`, 1.806 linhas) que centraliza gravar/navegar/validar via `inherited`. Migrar o `TfrmCadMaster` **uma vez** destrava dezenas de telas.
- **Onde mora a complexidade** (maiores `.pas`): `uNF.pas` **18.262** linhas (nota fiscal — o monstro), `udmNF.pas` 12.103, `uPedidoCompra.pas` 8.973, `UCadProduto.pas` 8.819, `uVendas.pas` 8.118, `uAPagar.pas` 6.815, `uCadCte.pas` 6.568. (`uGifImage.pas` 12.945 é lib, não negócio.)
- **Domínios visíveis**: produtos/estoque, parceiros (clientes/fornecedores), financeiro (a receber/a pagar, contas/cheques/bancos/boleto), compras/cotação, faturamento, **fiscal** (NF-e/NFC-e/SPED/Sintegra/PIS-COFINS/ICMS/Redução Z), etiqueta/balança, relatórios.

### 2. PDV / Vendas (`vendas-master`) — frente de caixa
- **~60k linhas**, 104 `.pas`, 60 `.dfm`, **2 executáveis** (`Pdv.exe`, `ApPDV.exe`).
- Estrutura **mais em camadas** que a retaguarda: `fonte/` com `BO/` (business objects), `VO/` (value objects), `Aut/`, `Tef/`, `CargaCliente/`, `Componentes/`, `Util/`, `Units/`. Sinal de uma reescrita mais recente/organizada.
- **TEF** isolado em `fonte/Tef/`: `uTEF.pas` + diálogos (`uTEFLeCheque`, `uTEFLeDigitos`, `uTEFLeSimNao`, `uTEFMensagem`).
- É o alvo de [ADR-008](../../00-orientation/canonical-decisions.md) (PDV offline-first em Electron) — o módulo onde fiscal+TEF+periféricos+offline convergem.

> **Balcão**: o prompt cita "retaguarda, balcão, PDV". No código aparecem claramente **retaguarda** e **PDV/vendas**; "balcão" não tem executável próprio — provavelmente é um **modo/fluxo** dentro de vendas (pré-venda/atacarejo: há `UFrmItensAtacarejo.pas`). **Lacuna a confirmar** (seção H).

| Módulo | Exec | `.pas` | linhas `.pas` | maturidade |
|--------|------|--------|---------------|------------|
| Retaguarda | 1 | 1.074 | ~581k | antiga, plana, herança de form-base |
| PDV/Vendas | 2 | 104 | ~60k | mais nova, camadas BO/VO/Tef |

---

## C) Datamodules / estado global compartilhado

**A maior armadilha do projeto, e está em escala.** ([../hidden-coupling-traps.md](../hidden-coupling-traps.md))

- **~323 classes `TDataModule`** na retaguarda (356 arquivos `udm*/dm*`); o PDV tem ~2-3. Cada cadastro tem seu datamodule (provider + ClientDataSet).
- **Conexão global única**: `udmPrincipal.pas` (retaguarda) e `uConexao.pas` (PDV). Os datasets das telas apontam `Connection`/`SQLConnection = dmPrincipal.Conexao` — **uma sessão Oracle para todas as telas** ⇒ transação global e "registro corrente" compartilhado, exatamente o cenário de acoplamento invisível do playbook.
- **Confirmado no piloto**: `uCadBancos.pas` cria `RDmCadBancos` e usa `dmPrincipal.Conexao`; a SQL semente é `select * from BANCOS B where B.CODBCO = :Codigo`. A tela não tem conexão própria — herda a global.
- **Utilitários globais**: `FuncoesApollo`, `uComunPesquisaRel`, `SetaDataset`, `Mensagem(...)` — funções de UI/dados compartilhadas e onipresentes.
- **Implicação direta para o alvo**: esse estado global mutável é **incompatível** com multi-tenant ([ADR-003/004](../../00-orientation/canonical-decisions.md)). Cada datamodule vira **conexão por tenant request-scoped + repository sem estado**; quebrar o acoplamento é **requisito de segurança** (isolamento fail-closed), não só limpeza.

---

## D) Camada de dados — como a SQL é montada

- **Sementes de design-time** existem nos `.dfm` (ex.: `SQL.Strings = ('select * from BANCOS B where B.CODBCO = :Codigo')`) — coletáveis pelo parser.
- **Mutação em runtime** é a regra esperada (o "arquivo-coroa" [../dynamic-sql-extraction.md](../dynamic-sql-extraction.md)): a stack `TClientDataSet` ← `TDataSetProvider` ← `TFDQuery/TSQLQuery` favorece montar/alterar SQL no `.pas` antes de `Open`. A extração **tem de ser em duas frentes** (estática + captura de runtime → fixtures), conforme o playbook.
- **Parâmetros** via `ParamByName` (`:x`) — bom (vira binding). Caçar concatenação de string e macros para os ramos condicionais.
- **Lógica no banco é LEVE**: por schema-cliente há **~21 procedures, 9 functions, 0 packages** (ver E). Ou seja, **a regra de negócio vive no Delphi, não em PL/SQL** — o inventário de condicionais sai do `.pas` ([../business-rule-extraction.md](../business-rule-extraction.md)), não de packages. Isso **alivia** a ADR-011 (Oracle→PG) no quesito lógica, mas **não** no quesito estrutura (views/triggers/sequences — ver E).
- **Triggers existem e escondem efeito**: ~92 triggers por schema, em boa parte **de replicação** (`REM_<TABELA>`). Toda tela cuja tabela tem trigger tem efeito colateral **fora do `.pas`** — ver a descoberta de CDC/replicação abaixo.

### Replicação / sync por trigger (descoberta — alimenta a arquitetura edge↔nuvem)

A trigger `REM_BANCOS` (AFTER INSERT/UPDATE/DELETE em `BANCOS`) **não** é auditoria: é **change-data-capture (CDC) por outbox**. A cada alteração ela insere em **`REMESSA_SERVER`** uma linha com a *instrução* a replicar:

```sql
INSERT INTO remessa_server(id, INSTRUCAO, DATA, TABELA, CHAVE, TIPO, CAMPOCHAVE)
VALUES (id_codremessa.NEXTVAL,
        'SELECT * FROM BANCOS WHERE CODBCO ='||:NEW.CODBCO,  -- o que reenviar
        current_timestamp, 'BANCOS', :NEW.CODBCO, 'INSERT', 'CODBCO');
```

- **`REMESSA_SERVER`** (outbox): colunas `ID, INSTRUCAO, DATA, TABELA, CHAVE, TIPO, CAMPOCHAVE, CODTERMINAL, REPLICA` — clássico outbox de replicação **por terminal** (`CODTERMINAL`) com flag `REPLICA`. ~8.952 linhas pendentes no schema amostrado. Há ainda **`REMESSA_LOTE`** (~2,9M linhas — replicação em lote) e `REMESSA_DATASNAP` (variante DataSnap, vazia aqui).
- **Implicação:** o legado já faz sync **loja/terminal → central** via triggers→outbox. Isso é a fundação concreta do [ADR-008](../../00-orientation/canonical-decisions.md) (offline-edge-sync) e da [arquitetura edge↔nuvem](../../01-architecture/). No alvo, esse CDC implícito vira um mecanismo de sync **explícito** (outbox/event no service), não trigger de banco — mas a **semântica de paridade** (o que replica, por terminal, idempotência via `CHAVE`) precisa ser preservada.

---

## E) Banco (schema/volume)

Oracle **19c Standard Edition 2** (`192.168.1.230:1521`, SID `apollo`).

### Topologia multi-tenant **por schema** (não por banco)
- **99 owners** distintos; cada cliente de supermercado tem **seu próprio schema** com ~800–875 tabelas. Ex. de owners: `COLUMBIA`, `PINHEIRAO`, `QUALITA`, `COMAC`, `MERCADO`, `SUPSANTOS`, `AZM` — vários com variantes (`PINHEIRAO_DEMO`, `_MANIFESTO`, `_CARTAO`, `_LARISSA`, `COLUMBIAESTOQUE`).
- **`METADADOSSICOM`** (o usuário fornecido) é o **schema-modelo**: 800 tabelas com a **estrutura canônica** + tabelas fiscais nacionais de referência (**NCM** ~10,6k, **CEST** ~19k, `NCM_IMPLANTACAO`) + ruído de Data Pump (`SYS_EXPORT_SCHEMA_*`, `SYS_IMPORT_FULL_*`).
- ⚠️ **Descompasso com [ADR-003](../../00-orientation/canonical-decisions.md)** (db-per-tenant): o legado faz **schema-per-tenant no mesmo banco**. A migração precisa **separar** schemas em bancos lógicos por cliente. Não é rediscussão do ADR — é trabalho de migração a dimensionar (seção H).

### Volume — onde está o dado quente (amostra: schema `COLUMBIA`, ~135M linhas/830 tabelas)
Maiores tabelas por linhas / tamanho aproximado:

| Tabela | Linhas | ~Tam | Natureza |
|--------|-------:|-----:|----------|
| `MOVIMENTACAO_DIARIA` | 16,5M | 300 MB | movimento (quente) |
| `VENDAS` | 4,0M | **1.795 MB** | **venda (o coração)** |
| `NF_PROD` | 3,0M | 1.132 MB | itens de nota fiscal (quente) |
| `CARTAO` | 3,8M | 682 MB | pagamentos cartão |
| `APURACAO_ICMS_DETALHES` | 5,5M | 281 MB | fiscal (quente em fechamento) |
| `HISTORICO_PDV` | 2,8M | 229 MB | histórico de caixa |
| `ESTOQUE_DIARIO` | 1,8M | 165 MB | estoque |
| `BKP_*`, `AUDIT_*`, `HISTORICO_*` | vários M | — | **cópias de backup/auditoria/histórico** que inflam a contagem |

- **Dado quente** = vendas / itens / cartão / movimentação / estoque / apuração fiscal. **Cadastros são frios e pequenos**: `BANCOS` 718, `PRODUTOS` ~139k.
- **Objetos por schema** (COLUMBIA): **830 tabelas, 369 views, 92 triggers, 507 sequences, 21 procedures, 9 functions, 0 packages**. As **507 sequences** (sequence-por-tabela) e **92 triggers** são o grosso do trabalho estrutural Oracle→Postgres; **314 FKs** confirmam um schema **relacional de verdade**.
- **As 369 views são, em boa parte, views de pesquisa `GET_<TABELA>`** (ex.: `GET_BANCOS` = projeção de colunas para o grid de busca do form-base `frmPesquisa`). Ou seja: tabela = dado; `GET_<TABELA>` = a leitura que a tela lista. No alvo viram as queries de listagem dos recursos. Ver [form-base-cadmaster.md](form-base-cadmaster.md).

### Censo de schemas — quantos clientes **ativos** de verdade? (dimensiona a migração)

Levantamento por dicionário (read-only): **83 owners não-sistema**, cada um com ~600–875 tabelas (o "schema-cliente"). Mas **não são 83 clientes**:

- **~3 não-tenant** (poucas tabelas): `SUPNAIN`, `OJVMSYS`, `DBSFWUSER`.
- **~8 vazios/modelo** (`VENDAS` = 0 linhas): `METADADOSSICOM` (modelo), `RAFAEL`, `C_ALOCERVEJA`, `ROSADAS`, `CARIOCA`, `AZM_MERCADOLOGICO`, `ARROZDOPADRE`, `COMACVIEW`.
- **Muitos são variantes/cópias do mesmo cliente** (inflam a contagem): sufixos `_SPED`/`_VIEW`/`_DEMO`/`_DEBUG`/`_CARTAO`/`_MANIFESTO`/`_ESTOQUE`/`_APP`/`_LARISSA`/`_PROD`/`_LOJAS`/`_FILIAL`. Ex.: **COMAC** tem 6 schemas (`COMAC`, `COMAC1408`, `COMAC_SPED`, `COMAC_VIEW`, `COMACVIEW`, `COMAC_APP`); **PINHEIRAO** tem 5; **MIRO** tem 3; há pares matriz/filial e `*2026`/`*SPED` de processamento fiscal.
- **Recência** (proxy: data da última coleta de estatística de `VENDAS`): **~11 schemas com stats em 2026** (claramente vivos — ex.: `PINHEIRAO` 11,9M linhas, stats **2026-06-23**; `SUPSANTOS` 2026-06-18; `COMAC1408`, `MERCADO`, `DOCEMANIA`, `BOMPRECO`, `BARBOSA`, `AVENIDA2026`, `DIADIA`, `SANTOS_LOJAS`); mais **~25–30 com stats em 2025**; o resto com stats de 2024 (vários no mesmo dia `2024-01-18`, cara de **restore/arquivo dormente**).

> **Estimativa de dimensionamento:** os 99 owners ≠ 99 clientes. Colapsando variantes e removendo vazios/cópias, o banco atual abriga da ordem de **algumas dezenas de negócios distintos**, dos quais **~25–35 parecem ativos** (stats 2025–2026) — **muito** longe dos "900 clientes" do alvo (que é escala-meta, não estado atual). Isso reduz drasticamente o tamanho da **fábrica de cutover** da Fase 1.
>
> **Caveat:** `last_analyzed` é proxy imperfeito (depende do job de stats). Para "ativo" preciso, medir `max(data)` em `VENDAS` por schema (query mais pesada) — fica como item da seção H. Mesmo assim, a ordem de grandeza (dezenas, não centenas) é robusta.

> Recomendação de método (canon): qualquer afirmação de volume/índice/plano deve passar pelo **MCP de Postgres/banco** ou pelo `EXPLAIN` no banco-sombra ([../../00-orientation/how-agents-work.md](../../00-orientation/how-agents-work.md)). Os números acima vêm de **estatística de dicionário** (`all_tables.num_rows`) — bons para ordem de grandeza, a refinar com contagem real no banco-sombra de extração.

---

## F) Risco-coroa (fiscal / TEF / periféricos)

Tudo presente e **concentrado** — tratar como trilha de risco dedicada desde já ([mission-and-principles.md](../../00-orientation/mission-and-principles.md)).

- **Fiscal documentos**: NF-e (~48 arquivos), NFC-e (~10), SAT/CF-e (~3), via **ACBr** (`ACBrNFe` 194 refs). Telas/units: `uCadNFE`, `uNFCe`, `uDmNFCe`, `CalculaNFe`, `uValidacoesNFe`, `uProcessaNotaFiscal`, `uExportaNFe`, `uImportaNfeManifesto`, `uConfigLegislacaoNFe`.
- **Fiscal apuração/obrigações**: **SPED** (`Uspedfiscal`, `UspedPisCofins`, `UPendenciasSPED`), **Sintegra** (`Usintegra`), **PIS/COFINS** (`UapuracaoPISCOFINS`, `uConsolidacaoPisCofins`), **ICMS/ST** (`uApuracaoICMSInter`, `uDMApuracaoICMSST`), **Redução Z/ECF** (`UCadReducaoZ`, `uImportaReducaoZ`) — resquício de ECF antigo.
- **TEF**: módulo isolado no PDV (`vendas-master/fonte/Tef/`): `uTEF.pas` + diálogos de cheque/dígitos/sim-não/mensagem (~25 arquivos citam TEF). Padrão de TEF discado/dedicado.
- **Periféricos** (via ACBr): **impressora** ESC/POS (`ACBrPosPrinter` 70), **balança** (`ACBrBAL`, `BalancaLeader.pas`, `UArquivoBalanca`, `UexportaBalanca`), DANFE.
- **Legislação parametrizável**: existe `parametros`/`uConfigLegislacaoNFe` — alinha com [ADR-010](../../00-orientation/canonical-decisions.md) (fiscal pinável/parametrizável por UF). Confirmar profundidade da parametrização (seção H).

> Nada disto entra na Fase 1. Mas o **NCM/CEST** (no `METADADOSSICOM`) e a parametrização fiscal precisam de dono cedo, pois atravessam produto, estoque e venda.

---

## G) Candidatos a tela-piloto (Fase 1 — cadastro simples de retaguarda)

Critérios: cadastro de retaguarda, **fora do risco-coroa**, baixo volume, poucas condicionais, dependências rastreáveis, exercita o **caminho real** (form-base + datamodule + Oracle + teclado) sem o peso fiscal. Todos herdam de `TfrmCadMaster`, então o piloto também **valida o form-base** que destrava o resto.

| # | Candidato | `.pas`/`.dfm` (linhas) | Tabela / volume | Por que (e ressalvas) |
|---|-----------|------------------------|------------------|------------------------|
| **1 — recomendado** | **`uCadBancos`** (Cadastro de Bancos) | 80 / 224 | `BANCOS` — 718 linhas, **13 colunas** flat (PK `CODBCO`), sem FK de entrada | Menor superfície de regra; CRUD puríssimo já lido de ponta a ponta; SQL semente trivial. **Trigger `REM_BANCOS` já inspecionada**: é CDC de replicação para `REMESSA_SERVER` (efeito a reproduzir, ver seção I). Ótimo para exercer o pipeline inteiro (dossiê→DS `/ds-create-crud`→NestJS→paridade) com risco mínimo. **Travado como piloto da Fase 1.** |
| **2** | **`uCadOperacoesConta`** (Operações de Conta) | 49 / 114 | cadastro pequeno (financeiro) | Menor `.pas` de todos; CRUD enxuto. **Ressalva**: confirmar tabela/uso e se alimenta lançamentos (efeito a jusante). |
| **3** | **`uCadFormaPgto`** (Formas de Pagamento) | 519 / 1.769 | cadastro pequeno | Levemente mais rico (regras de parcela/condição), ainda baixo risco; bom **segundo** piloto para exercer condicional/validação de verdade. |

**Evitar como piloto**: `UCadProduto` (8.819 linhas — núcleo de tudo), `UcadAliquota` (toca fiscal), qualquer `*NF*`/`*Sped*`/`*ICMS*` (risco-coroa).

> **Recomendação:** começar por **`uCadBancos`** — depois de inspecionar a trigger `REM_BANCOS`. É o menor caminho honesto que prova a fundação (form-base, datamodule→repository, conexão por tenant, camada de teclado, harness de paridade) sem tocar o fiscal.

---

## H) Lacunas e perguntas (decisões de produto — não inferíveis do código)

1. **"Balcão"** — o prompt cita 3 frentes, mas o código mostra 2 executáveis (retaguarda, PDV/vendas). Balcão é um **modo de vendas** (pré-venda/atacarejo) ou um produto à parte? Escopo da Fase 1 depende disso.
2. **Tenancy origem→alvo** — legado é **schema-per-tenant no mesmo Oracle**; alvo é **db-per-tenant** ([ADR-003](../../00-orientation/canonical-decisions.md)). **Parcialmente respondido** (ver censo na §E): ~83 owners, mas só **~25–35 parecem clientes ativos** (o resto é vazio/cópia/variante SPED-VIEW-DEMO/dormente). Confirmar com o time a **lista oficial de clientes ativos** e medir `max(data)` de `VENDAS` por schema para cravar. Isso dimensiona a fábrica de migração e o cutover.
3. **Trigger `REM_BANCOS` (e as ~92 por schema)** — confirmar se são **replicação** (há sync entre lojas/edge?), auditoria ou regra. Se replicação, isso informa a [arquitetura edge↔nuvem](../../01-architecture/) e o sync offline ([ADR-008](../../00-orientation/canonical-decisions.md)).
4. **Parametrização fiscal** — quão parametrizável por UF/município é hoje (tabela `parametros`, `uConfigLegislacaoNFe`)? Define quanto do motor fiscal é dado vs código (impacta [ADR-010](../../00-orientation/canonical-decisions.md), fiscal pinável).
5. **Banco-sombra de extração** — para a frente B de [../dynamic-sql-extraction.md](../dynamic-sql-extraction.md) (capturar SQL real via log), precisamos de uma **cópia de dados representativos**. Usar um dump de um schema-cliente (ex.: `COLUMBIA`) num Postgres/Oracle de teste? Qual cliente serve de referência?
6. **Acesso ao banco em produção** — o cliente atual (`metadadossicom`) lê dicionário/estatística, mas **não** validei `SELECT` de dados nas tabelas dos schemas-cliente. Para fixtures de paridade precisamos de leitura de dados num ambiente não-produtivo.
7. **TEF — adquirentes e modelo** — quais bandeiras/adquirentes e qual TEF (dedicado/discado/API)? Define a camada de drivers no Electron e a certificação.
8. **Versão fiscal "viva"** — a legislação muda no ano; qual a referência fiscal atual certificada para pinar ([ADR-010](../../00-orientation/canonical-decisions.md))?

---

## I) Aprofundamento do piloto — `uCadBancos` + o contrato de `TfrmCadMaster`

O piloto escolhido. Lição de "contexto é tudo": a tela tem **80 linhas**, mas herda de `TfrmCadMaster` (`uCadMaster.pas`, 1.806 linhas, ISO-8859) um **contrato CRUD rico**. Migrar esse form-base **uma vez** é o equivalente legado do `/ds-create-crud` do alvo ([ADR-014](../../00-orientation/canonical-decisions.md)).

### Convenções documentadas no próprio form-base (do cabeçalho do `.pas`)
- **Soft-delete**: tabelas que não excluem fisicamente usam `INDR`/`INDR_USUARIO`/`INDR_DATA` e filtram `COALESCE(B.INDR,'I') <> 'E'`. *(A `BANCOS` **não** tem `INDR` → faz **hard delete**; a trigger `REM_BANCOS` tem ramo DELETE coerente.)*
- **Mestre/detalhe**: marcador `/*<PRINCIPAL>TABELA</PRINCIPAL>*/` no fim da SQL + providerflags de chave + `SetBeforeUpdateRecord`. *(BANCOS é tabela única → não usa.)*

### Comportamentos transversais que o `btnGravarClick` herdado executa (a reproduzir no alvo)
Ao salvar um banco, o legado faz — **fora** do `uCadBancos.pas`, no form-base + global + DB:
1. **RBAC por form+ação**: `dmPrincipal.PossuiAcessoForm(Self.Name,'BTNGRAVAR')` — permissão data-driven por nome de form e ação.
2. **Validação de obrigatórios**: `ValidaObrigatorios(cdsPrincipal)`.
3. **Injeção de tenant/operador a partir de estado global**: `CODEMPRESA := dmPrincipal.EmpresaCODEMPRESA`, `CODOPERADOR := dmPrincipal.OperadorCODOPERADOR` (quando `FPreencheEmpresa/Operador`). ← o ponto de **isolamento de tenant** que no alvo vira contexto request-scoped fail-closed.
4. **Apply do delta** via ClientDataSet: `cdsPrincipal.ApplyUpdates(0)` → dispara `BeforeUpdateRecord` (provider) → INSERT/UPDATE no Oracle → **dispara a trigger `REM_BANCOS`** (replicação).
5. **Histórico dinâmico**: `SetaHistorico_Dinamico(...)` grava em **`HISTORICO_DINAMICO`** (~4,1M linhas no schema amostrado) — auditoria genérica de mudança de campo.
6. **Carimbo de operador/alteração**: `SetaOperadorAlteracao(...)` preenche `USULTALTERACAO`/`DTULTIMALTERACAO` (colunas que existem na `BANCOS`); ramifica por `Modulo` ('RETAGUARDA' vs 'CONTROLE-SICOM').
7. **Log de aplicação**: `TLog.GravaLog(doInserir/doAlterar, ...)`.
8. **Hook pós-gravar**: `EventoDepoisGravar` (evento opcional da subclasse).

> Ou seja, o dossiê do piloto **não** é "uma tabela de 13 colunas". É: o **contrato do form-base** (RBAC, obrigatórios, tenant/operador, apply via provider, histórico, log, carimbo) + o **CDC de replicação** (`REMESSA_SERVER`). Esse é o tamanho real da Fase 1 — e o que a torna o piloto certo: prova **toda a fundação** num domínio de risco mínimo.

### O que o piloto valida da fundação do alvo
Form-base→engine CRUD reutilizável · datamodule→repository sem estado · conexão global→conexão por tenant · `PreencheEmpresa`→contexto de tenant fail-closed · taborder/Enter/F-keys (`FormKeyDown`, `edtCodigoExit`)→camada de teclado ([ADR-010](../../00-orientation/canonical-decisions.md)) · trigger de replicação→sync explícito · `SearchEngineApollo`→subsistema de pesquisa · harness de paridade sobre o `ApplyUpdates` real.

---

## Anexos — como foi medido (reprodutível, read-only)

- **Código**: `find`/`grep`/`wc` sobre `/Library/SicomGit` (contagens de arquivo/linha, censo de tipos de componente, censo `ACBr*`, leitura integral de `uCadBancos.pas` e sementes de SQL).
- **Banco**: `python-oracledb` (thin) em venv isolado; só `SELECT` em `USER_TABLES`/`ALL_TABLES`/`ALL_TAB_COLUMNS`/`ALL_OBJECTS`/`ALL_TRIGGERS`/`ALL_CONSTRAINTS` (dicionário e estatística) — **nenhuma** escrita, **nenhum** DDL, **nenhum** dado de cliente alterado. Scripts em scratchpad da sessão.

## Ver também

- [form-base-cadmaster.md](form-base-cadmaster.md) — **o contrato do form-base `TfrmCadMaster`** (engine CRUD reutilizável por ~101 telas): ciclo de vida, teclado, views `GET_*`, replicação, mestre-detalhe, palette de campos.
- [pdv-architecture.md](pdv-architecture.md) — **arquitetura do PDV** (loader+DLL, camadas BO/VO, **offline-first já existente** = DB local embarcado + central Oracle + replicação, TEF/fiscal/periféricos).
- [entity-parceiros.md](entity-parceiros.md) — **mapa da entidade `PARCEIROS`** (party polimórfico de 169 colunas, 31 tabelas dependentes, mestre-detalhe com nested datasets, decisão de modelagem party).
- [plano-fase-1.md](plano-fase-1.md) — **plano de Fase 0→1** informado pelo recon: o que a fundação precisa conter, ordem de entidades, e onde o recon refina o roadmap canônico.
- [oracle-to-postgres-recon.md](oracle-to-postgres-recon.md) — **aterramento Oracle→PG** (ADR-011) com tipos/sequences/views/triggers reais; alerta dos ~81 triggers de lógica/auditoria.
- [../../04-screen-dossier/dossiers/retaguarda/uCadBancos.md](../../04-screen-dossier/dossiers/retaguarda/uCadBancos.md) — dossiê (rascunho) do piloto.
- [../delphi-anatomy.md](../delphi-anatomy.md) — parsear `.dfm` (texto confirmado) → scaffold/teclado/sementes.
- [../dynamic-sql-extraction.md](../dynamic-sql-extraction.md) — a stack provider/cds exige extração em duas frentes.
- [../hidden-coupling-traps.md](../hidden-coupling-traps.md) — os ~323 datamodules + conexão global = o trabalho central.
- [../business-rule-extraction.md](../business-rule-extraction.md) — a regra está no `.pas` (PL/SQL é leve).
- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — ADR-003/004 (tenancy), ADR-010 (fiscal/teclado), ADR-011 (Oracle→PG), ADR-012 (dossiê).
- [../../04-screen-dossier/](../../04-screen-dossier/) — destino do piloto: o dossiê de tela.
