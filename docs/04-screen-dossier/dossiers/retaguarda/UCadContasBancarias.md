# Dossiê — `frmCadContasBancarias` (Cadastro de Contas Bancárias / Contas Correntes)

| Campo | Valor |
|---|---|
| **Status** | **`em-revisão`** — tela **completada fiel** (aba mestre "Contas Correntes" inteira: 17 colunas editáveis, FK→BANCOS, escopo por empresa, flags S/N, grupos Boleto e Arquivo remessa). Recon do `.pas`/`.dfm`/datamodule + estrutura de `CONTAS_BANCARIAS` confirmada contra homologação (`pinheirao@dbhomologacao`). Implementação Fase 0 **completa e verde** (engine declarativo, smoke + integração). **Pendência para `paridade-verde`/`concluído`: golden de runtime certificado do legado** (captura V$SQL) — hoje os golden são resultado do **novo** (≠ piloto Bancos, que tem captura V$SQL/REMESSA_SERVER). **DEFERIDO** (não construído nesta fase): (a) o **lookup FK Plano de Contas** (`CODLANCCONTABIL`→`GET_PLANO_CONTAS`) e (b) a **aba mestre-detalhe "Liberação de operadores"** (`CONTAS_BANCARIAS_OP`) — só serão construídos quando `PLANO_CONTAS`/`OPERADORES` migrarem. |
| **Autor / Revisor** | agente Analista de Legado (Claude) / *pendente — revisor independente ([../../08-agents/review-loop.md](../../08-agents/review-loop.md))* |
| **Versão do dossiê** | v1 — 3ª tela (1ª **mestre-detalhe** herdeira de `TfrmCadMasterDetalhe`; aba detalhe deferida) |
| **Data** | 2026-06-25 |
| **Commit do legado analisado** | `/Library/SicomGit/retaguarda-master` (branch `*-master`, sem hash versionado) |

> **Por que esta tela:** é a **3ª tela** documentada e a **1ª herdeira de `TfrmCadMasterDetalhe`** (mestre-detalhe), depois dos pilotos magros [uCadBancos](uCadBancos.md) e [uCadOperacoesConta](uCadOperacoesConta.md). Valor de recon: prova o engine declarativo num caso **rico** — **FK/lookup** (`CODBCO`→`BANCOS`), **escopo multi-tenant real** (`IDEMPRESA` carimbado pelo servidor), **17 colunas** (texto, data, memo uppercase, inteiros, flags S/N, combo de lista fixa) e dois grupos visuais (`Boleto`, `Arquivo remessa`). Introduz também o padrão de **partes deliberadamente deferidas** (lookup de Plano de Contas + aba de operadores), que viram TODO explícito quando as dependências migrarem.
>
> ⚠️ **Limite desta versão:** a **tela mestre** está completa e fiel por construção, com smoke + teste de integração verdes ([Casos golden](#9-casos-de-teste-golden--capturados-do-legado)). O que **falta para certificar** é a **captura de runtime do legado** (V$SQL) — o pipeline de escrita (provider/`ApplyUpdates`), o carimbo de auditoria e a SQL final da pesquisa herdam a forma já capturada em Bancos (mesmo form-base), mas **não foram vistos rodando** para esta tela. As **duas partes deferidas** (Plano de Contas / Operadores) estão marcadas `DEFERIDO` em todas as seções.

---

## 1. Identidade

| Campo | Valor |
|---|---|
| **Form (`.pas` / `.dfm`)** | `retaguarda-master/fonte/Units/UCadContasBancarias.pas` (442 linhas) + `UCadContasBancarias.dfm` (1.238 linhas) `[.dfm]`. Datamodule de dados: `uRDmCadContaBancaria.pas` (106 linhas) + `uRDmCadContaBancaria.dfm` (337 linhas) `[.pas:L1]`,`[.dfm]` |
| **Classe do form** | `TfrmCadContasBancarias` — **herda `TfrmCadMasterDetalhe`** (que estende `TfrmCadMaster`) via herança visual (`inherited frmCadContasBancarias`) `[.dfm:L1]`, `[.pas:L33]`. É a 1ª herdeira documentada do form-base **mestre-detalhe**. |
| **Módulo de domínio** | `cadastro` (financeiro/tesouraria) — alimenta movimento de contas, baixas a pagar/receber, geração de boletos (grupo Boleto) e arquivo remessa CNAB (grupo Arquivo remessa). |
| **Função no negócio** | CRUD de **contas correntes bancárias da empresa**: vincula a conta a um **banco** (FK), guarda titular/nº conta/gerente/abertura/telefone/observação, o **plano de contas** contábil de lançamento, parâmetros de **cobrança/boleto** (convênio, carteira, variação, tipo do título, código de transmissão) e do **arquivo remessa**, mais flags (conta interna, exibe no relatório de apuração de caixa, ativo). A aba detalhe **libera operadores** a baixar a pagar/receber por essa conta. |
| **Frequência / criticidade** | **baixa** frequência (cadastro estável), **média** criticidade — não é caminho de PDV nem toca fiscal (sem cálculo/alíquota), mas os parâmetros de boleto/remessa **alimentam geração financeira** (boleto/CNAB) e a flag de operador controla **quem pode baixar título** (impacto operacional/segurança). |
| **Rota-alvo (web)** | `/cadastro/contas-bancarias` (lista) · `/cadastro/contas-bancarias/:cod` (edição) — **já implementada** (aba mestre; ver [Paridade com o novo](#paridade-com-o-novo)). |
| **Casca-alvo** | `browser` — tela de retaguarda, sem device, sem teclas reservadas críticas próprias. (Electron só se entrar no pacote power-user; não há requisito próprio. `F3` dos lookups não conflita com o Chromium.) |

---

## 2. UI — inventário de componentes (`.dfm` → React)

Herança visual: o `.dfm` herda do form-base mestre-detalhe — `imgCabecalho`, `lblTitulo`, `pnlGeral` com `PageControlGeral` (abas `tbsMaster`/`TabSDetalhe`), `pnlCabecalho` (`edtCodigo`+`btnPesquisa`+`DBNavigator1`+`rdgAtivo`), `pnlRodapeMaster` (botões de ação Gravar/Cancelar/Editar/Excluir/Adicionar), `stbHints` (status bar), `cdsHistorico_dinamico`. Título: `'Contas correntes'` `[.dfm:L19]`. Há **duas abas**: **"Contas Correntes"** (`tbsMaster`, mestre) e **"Liberação de operadores"** (`TabSDetalhe`, detalhe — **DEFERIDA**). Bind dos campos do mestre: `DataSource = dtsPrincipal` (herdado → `cdsContaBancaria`).

### Aba "Contas Correntes" (`tbsMaster`) — controles próprios

| Controle (`.dfm`) | Tipo VCL | Left,Top,W,H | Caption/label | DataField | → React (DS) | Nota de reflow |
|---|---|---|---|---|---|---|
| `lblCODBCO` | `TLabel` | 8,2,29,13 | `Banco` (sem `&`) | — | `<label>` do `<SelectField>` | linha 1, label |
| `edtCODBCO` | `TDBEdit` | 8,18,63,21 | — · `OnExit`,`OnKeyUp(F3)` | `CODBCO` | `<SelectField>` (FK→bancos) *(obrigatório)* | linha 1, código do banco |
| `btnBuscaBanco` | `TBitBtn` | 73,15,25,24 | glyph lupa · `OnClick` | — | embutido no `<SelectField>` | abre `GET_BANCOS` |
| `edtBANCO` | `TDBEdit` | 101,18,280,21 | `ReadOnly`, `TabStop=False`, `clBtnFace` | `BANCO` | label do `<SelectField>` (nome) | espelho do nome do banco (não editável) |
| `lblTITULAR` | `TLabel` | 393,2,30,13 | `Titular` | — | `<label>` | linha 1, col 2 |
| `edtTITULAR` | `TDBEdit` | 393,18,375,21 | — | `TITULAR` | `<Field>` (max 50) | col direita |
| `lblNROCONTA` | `TLabel` | 8,42,44,13 | `Nº Conta` | — | `<label>` | linha 2 |
| `edtNROCONTA` | `TDBEdit` | 9,57,89,21 | — | `NROCONTA` | `<Field>` (max 10) | linha 2, col 1 |
| `lblDTABERTURA` | `TLabel` | 154,42,83,13 | `Data de abertura` | — | `<label>` | linha 2 |
| `edtDTABERTURA` | `TJvDBDateEdit` | 154,58,89,21 | `ShowNullDate=False` | `DTABERTURA` | `<DateField>` | linha 2, data |
| `lblFONE1` | `TLabel` | 294,42,42,13 | `Telefone` | — | `<label>` | linha 2 |
| `edtFONE1` | `TDBEdit` | 294,58,89,21 | — | `FONE1` | `<Field>` (max 15) | linha 2 |
| `lblGERENTE` | `TLabel` | 393,42,39,13 | `Gerente` | — | `<label>` | linha 2, col 2 |
| `edtGERENTE` | `TDBEdit` | 393,57,375,21 | — | `GERENTE` | `<Field>` (max 50) | col direita |
| `lblOBS` | `TLabel` | 10,81,58,13 | `Observação` | — | `<label>` | linha 3 |
| `edtOBS` | `TDBMemo` | 8,98,375,158 | `ScrollBars=ssVertical` · `OnKeyPress` (UPPER) | `OBS` | `<TextArea>` (max 300, MAIÚSCULAS) | memo largo, coluna esquerda |
| `LblPlanoContas` | `TLabel` | 393,79,76,13 | `Plano de contas` | — | `<label>` | **DEFERIDO** (lookup) |
| `edtLancContabil` | `TDBEdit` | 393,92,78,21 | `OnExit`,`OnKeyUp(F3)` | `CODIREDUZIDO` | `<Field>` texto livre **(lookup DEFERIDO)** | exibe cód. reduzido do PLC |
| `BtnBuscaPlanoContas` | `TBitBtn` | 473,90,28,23 | glyph lupa · `OnClick` | — | **DEFERIDO** (não renderizado) | abre `GET_PLANO_CONTAS` |
| `EdtDescConta` | `TJvDBMaskEdit` | 504,92,264,21 | `Enabled=False`, `clBtnFace` | `DESCRICAO_PLC` | **DEFERIDO** (descrição do PLC) | espelho da descrição |
| `chbCONTA_PROPRIA` | `TJvDBCheckBox` | 393,115,90,17 | `Conta Interna` · `ReadOnly` · checked='S'/unchecked='N' | `CONTA_PROPRIA` | `<CheckboxField>` S/N | flag |
| `CkbExibeRelApuracaoCaixa` | `TJvDBCheckBox` | 485,115,215,17 | `Exibe no relatório de apuração de caixa` · 'S'/'N' | `EXIBE_REL_APURACAO_CAIXA` | `<CheckboxField>` S/N | flag |
| `CkbAtivo` | `TJvDBCheckBox` | 715,115,50,17 | `Ativo` · `ReadOnly` · 'S'/'N' | `ATIVO` | `<CheckboxField>` S/N | flag |
| `grbBoleto` | `TFlatGroupBox` | 393,131,372,64 | `Boleto` | — | `<fieldset legend="Boleto">` | container |
| ↳ `edtConvenio` | `TDBEdit` | 4,35,65,21 | `Convênio` (`Label2`) | `CONVENIO` | `<NumberField decimais=0>` | inteiro 6/7 (BR-08) |
| ↳ `edtCarteira` | `TDBEdit` | 75,35,49,21 | `Carteira` (`Label3`) | `CARTEIRA_COBRANCA` | `<NumberField decimais=0>` | inteiro |
| ↳ `edtVariacao` | `TDBEdit` | 130,35,49,21 | `Variação` (`Label4`) | `VARIACAO_CARTEIRA` | `<NumberField decimais=0>` | inteiro |
| ↳ `JvDBComboBox1` | `TJvDBComboBox` | 288,35,79,21 | `Tipo do titulo` (`Label5`) | `TIPO_COBRANCA` | `<SelectField>` (1–4) | combo lista fixa (BR-07) |
| ↳ `edtCodTransmissao` | `TDBEdit` | 185,35,97,21 | `Cód. Transmissão` (`Label1`) | `CODIGO_TRANSMISSAO_COBRANCA` | `<Field>` (max 30) | texto |
| `grbArquivoRemessa` | `TFlatGroupBox` | 393,198,372,58 | `Arquivo remessa` | — | `<fieldset legend="Arquivo remessa">` | container |
| ↳ `edtNroConvenioArquivoRem` | `TDBEdit` | 4,29,120,21 | `Convênio` (`lbl1`) | `NROCONVENIO_ARQREM` | `<Field>` (max 12) | texto |

> **O combo `TIPO_COBRANCA` (achado de UI)** `[.dfm:L357-380]`: `TJvDBComboBox` bound a `TIPO_COBRANCA` (NUMBER), lista fechada. Mapa `Items`↔`Values` **verbatim**: `Simples`→`1`, `Descontada`→`2`, `Vendor`→`3`, `Vinculada`→`4`. O usuário vê o rótulo, o banco grava o **inteiro 1–4**. No alvo → `<SelectField>` com `[{value:'1',label:'Simples'}…]` (valores como string no form, persistidos como inteiro). Ver [BR-07](#5-regras-de-negócio).

### Aba "Liberação de operadores" (`TabSDetalhe`) — **DEFERIDA**

> ⚠️ **DEFERIDO — não construído nesta fase** (será feito quando `OPERADORES` migrar). Documentado aqui para fidelidade. É um **mestre-detalhe** (ClientDataSet aninhado `cdsOperador` sobre `CONTAS_BANCARIAS_OP`).

| Controle (`.dfm`) | Tipo VCL | Left,Top | Caption/DataField | → React (alvo deferido) |
|---|---|---|---|---|
| `lblCODGRUPO` | `TLabel` | 85,3 | `Operador` (`FocusControl=edtCodOperador`) | label |
| `edtCodOperador` | `TJvDBMaskEdit` | 85,19 | `CODOPERADOR` · `OnEnter/OnExit/OnKeyUp(F3)` | campo + lookup `GET_OPERADORES` |
| `edtNomeOperador` | `TJvDBMaskEdit` | 212,19 | `NOME` · `ReadOnly`,`Enabled=False` | espelho do nome |
| `btnBuscaOperador` | `TBitBtn` | 178,18 | glyph lupa · `OnClick` | botão de busca |
| `btnAddEnd` | `TBitBtn` | 1,26 | `Inserir` · `OnClick` | adicionar item |
| `btnDelEnd` | `TBitBtn` | 1,51 | `Excluir` · `OnClick` | excluir item |
| `btnSaveEnd` | `TBitBtn` | 1,76 | `Salvar` · `OnClick` | salvar item (com guarda de duplicidade) |
| `btnCancEnd` | `TBitBtn` | 1,102 | `Cancelar` · `OnClick` | cancelar item |
| `GrdOperadores` (`GrdOperadoresDBTV`) | `TcxGrid` | 85,47,668,200 | grid de itens | `<DataGrid>` editável |
| ↳ col `CODOPERADOR` | `TcxGridDBColumn` | — | `Código operador` (não editável) | coluna |
| ↳ col `NOME` | `TcxGridDBColumn` | — | `Operador` (não editável) | coluna |
| ↳ col `CBO_BAIXA_CR` | `TcxGridDBColumn` checkbox | — | `Baixa contas a receber` · 'S'/'N' | coluna checkbox |
| ↳ col `CBO_BAIXA_CP` | `TcxGridDBColumn` checkbox | — | `Baixa contas a pagar` · 'S'/'N' | coluna checkbox |

**Notas de reflow:** layout absoluto `Left/Top` → grid fluido de 2 colunas (no alvo: `grid-cols-1 sm:grid-cols-2`), com os dois `TFlatGroupBox` virando `<fieldset>` de span 2 e o memo OBS ocupando largura cheia. **Não** copiar pixels. As duas abas viram um componente de abas (a aba detalhe **omitida** enquanto deferida).

> **Divergência vs. Bancos (UI):** aqui o `edtCODBCO` é uma **FK real com lookup** (`GET_BANCOS`) com botão de busca **e** F3, e o `edtBANCO` é o espelho `ReadOnly` do nome — padrão de FK/lookup que Bancos (autorreferente) não exercia. O memo `OBS` força **MAIÚSCULAS** via `OnKeyPress` (BR-06), análogo ao uppercase de Bancos.

---

## 3. Eventos

Handlers próprios de `UCadContasBancarias.pas`. O ciclo de gravação/edição/exclusão/pesquisa/navegação é herdado de `TfrmCadMaster`/`TfrmCadMasterDetalhe` (ver [seção 7](#7-dependências)). Os handlers de **operador** (`btnAddEnd/btnDelEnd/btnSaveEnd/btnCancEnd/btnBuscaOperador/edtCodOperador*`) pertencem à **aba detalhe DEFERIDA** — listados, mas fora do escopo construído.

| Componente.Evento | `.pas` | O que faz (passo a passo) | Toca SQL? | Toca estado externo? | Vira (alvo) |
|---|---|---|---|---|---|
| `FormCreate` | `[.pas:L423-430]` | `inherited`; cria `RDmCadContaBancaria`; `SetaDataset(edtCODBCO, cdsContaBancaria, 'CODCONTA', 'CONTAS_BANCARIAS')` (wira o cds, PK `CODCONTA`, tabela, foco inicial em `edtCODBCO`); cria `ListaDetalhes` e adiciona `cdsOperador` (registra o detalhe) | indireto (abre dataset) | cria datamodule; usa conn global | montagem + bind do recurso `/cadastro/contas-bancarias` |
| `FormClose` | `[.pas:L416-421]` | `FreeAndNil(RDmCadContaBancaria)`; `inherited` | — | libera datamodule | desmontagem/cleanup |
| `cdsContaBancaria.OnNewRecord` | `[uRDmCadContaBancaria.pas:L92-96]` | ao **inserir**: `IDEMPRESA := dmPrincipal.EmpresaCODEMPRESA` **e** `ATIVO := 'S'` | — | lê empresa do DM global | carimbo `idempresa` (servidor) + default `ativo='S'` (BR-01/BR-02) |
| `cdsOperador.OnNewRecord` *(DEFERIDO)* | `[uRDmCadContaBancaria.pas:L98-103]` | ao inserir item: `CODCONTA := master.CODCONTA`; `CBO_BAIXA_CR := 'S'`; `CBO_BAIXA_CP := 'S'` | — | herda PK do mestre | default do item de operador (deferido) |
| `edtCODBCO.OnExit` | `[.pas:L277-300]` | se vazio e não está cancelando/buscando → `'Favor entrar com código do banco!'` + foco preso (BR-03); senão `RetornarValores('BANCOS', 'CODBCO', …, 'CODBCO;BANCO;CIDADE;UF;AGENCIA', …)` preenche o nome do banco; se não achar → `'Banco não encontrado…'` | sim (lookup BANCOS) | foco condicional | `onBlur` async + validação FK + 'Banco é obrigatório' |
| `edtCODBCO.OnKeyUp` | `[.pas:L302-308]` | `F3` → `spbCODBCOClick` (abre pesquisa de banco) | abre pesquisa | — | `F3` → modal de busca de banco |
| `spbCODBCOClick` / `btnBuscaBancoClick` | `[.pas:L128-135]`,`[.pas:L144-152]` | abre `frmPesquisa('GET_BANCOS', edtCODBCO→CODIGO, edtBANCO→BANCO)` | sim (view) | — | `<SelectField>` lookup de bancos |
| `edtOBS.OnKeyPress` | `[.pas:L410-414]` | `Key := UpCase(Key)` — força **MAIÚSCULAS** no memo | — | — | `.transform(toUpperCase())` no zod (BR-06) |
| `btnGravarClick` | `[.pas:L191-210]` | **try**: se CONVENIO/CARTEIRA/VARIACAO preenchidos e CONVENIO não-vazio → exige `Length(CONVENIO) ∈ {6,7}`, senão `raise 'Convênio deve ter apenas 6 ou 7 posições. Verifique.'`; depois `inherited` (todo o pipeline do form-base); **except** → `Mensagem(E.Message)` | sim (escrita via provider) | sim ([Efeitos](#6-efeitos-colaterais--estado-externo)) | validação no DTO (BR-08) + `POST/PUT` |
| `edtCodigoKeyDown` | `[.pas:L315-346]` | `F3` → `btnPesquisaClick`; `Enter` → se vazio `btnAdicionarRegistroClick`, senão `AbreDataset(código)`; se achou e `btnEditar.Enabled` → foco em Adicionar; se não achou → `'Produto não encontrado!'`+limpa (texto residual de copy-paste do form-base) | sim (read por código) | — | Enter no campo código (engine) |
| `edtCodigoExit` | `[.pas:L310-313]` | vazio (`//`) — sobrescreve o do form-base para **não** fazer nada | — | — | — |
| `rdgAtivoClick` | `[.pas:L432-440]` | se o controle ativo é `rdgAtivo` → `btnPesquisaClick` (re-filtra a lista pelo F6 ativo/inativo/todos) | sim (re-lista) | — | filtro de situação na lista |
| `edtLancContabilExit` / `edtLancContabilKeyUp` / `BtnBuscaPlanoContasClick` *(DEFERIDO)* | `[.pas:L392-408]`,`[.pas:L169-177]` | lookup de Plano de Contas via `SegPlanoContas`/`GET_PLANO_CONTAS` filtro `(CLASSE='ANALITICA') AND (TIPO='EMPRESA')` | sim (PLANO_CONTAS) | — | **DEFERIDO** (até PLANO_CONTAS migrar) |
| `dtsPrincipalStateChange` *(parcial DEFERIDO)* | `[.pas:L270-275]` | habilita `edtCodOperador`/edição do grid de operadores só em insert/edit | — | UI condicional do detalhe | habilitação do grid (deferido) |
| `btnAddEndClick`/`btnDelEndClick`/`btnSaveEndClick`/`btnCancEndClick`/`dtsOperadorStateChange`/`btnBuscaOperadorClick`/`edtCodOperador*` *(DEFERIDO)* | `[.pas:L137-258]`,`[.pas:L260-268]`,`[.pas:L348-390]` | CRUD do item de operador em memória (`xInsert/xPost/xDelete/xCancel`), com guarda de **operador duplicado** (`OperadorExiste`, [.pas:L212-258]) e lookup `GET_OPERADORES` | sim (lookup OPERADORES) | cds do detalhe | **DEFERIDO** (aba operadores) |

> **Achados (a leitura "olhando a tela" perderia):**
> 1. **`btnGravarClick` próprio** envolve o `inherited` num `try/except` e injeta **uma** validação de negócio antes: o **convênio de 6 ou 7 dígitos** `[.pas:L194-203]`. É a única regra que esta tela acrescenta ao pipeline do form-base. → no alvo, validação no DTO/zod (BR-08).
> 2. **`OnNewRecord` carimba `IDEMPRESA` e `ATIVO='S'`** `[uRDmCadContaBancaria.pas:L92-96]` — **regra no datamodule**, não no form. O `IDEMPRESA` vem de `dmPrincipal.EmpresaCODEMPRESA` (estado global de sessão) → no alvo é carimbado pelo **engine** (`empresaScoped`, fail-closed), **não** é campo da tela (BR-01). `ATIVO='S'` é o default de inclusão (BR-02).
> 3. **FK com lookup** `edtCODBCO.OnExit` faz `RetornarValores('BANCOS',…)` para resolver o nome do banco e validar a existência **antes** de gravar (BR-03) — comportamento que o Postgres garante por FK no alvo.
> 4. **`edtCodigoExit` esvaziado de propósito** `[.pas:L310-313]` — anula o handler do form-base; e `edtCodigoKeyDown` ainda tem a mensagem `'Produto não encontrado!'` (resíduo de cópia), benigna.

---

## 4. Dados — TODA query

### Q1 — `aqqContaBancaria` (leitura do registro mestre + lookups) — `[.dfm SQL.Strings]`
- **Origem:** `uRDmCadContaBancaria.dfm` `[.dfm:L5-18]` — `TFDQuery aqqContaBancaria`, `Connection = dmPrincipal.FDConexao` (global), via `dspContaBancaria` (`TDataSetProvider`) → `cdsContaBancaria` (`TClientDataSet`).
- **Quando dispara:** ao abrir/editar uma conta pelo código (via `SetaDataset`/`AbreDataset` com `cdsContaBancaria.Params['CODIGO']`).
- **SQL base (Oracle, verbatim do `.dfm`):**
  ```sql
  SELECT C.*,
         B.BANCO,
         PLC.DESCRICAO AS DESCRICAO_PLC,
         PLC.CODIEXPANDIDO,
         PLC.CODIREDUZIDO
  FROM CONTAS_BANCARIAS C
  LEFT JOIN BANCOS         B ON (B.CODBCO = C.CODBCO)
  LEFT JOIN PLANO_CONTAS PLC ON (PLC.CODPLANOCONTAS = C.CODLANCCONTABIL)
  WHERE CODCONTA = :CODIGO
  ```
- **Params:** `:CODIGO` (`ftInteger`, `ptInput`) — origem `edtCodigo`/chave da pesquisa. `[.dfm:L21-27]`
- **Fragmentos condicionais:** nenhum (estática pura). Traz `C.*` (todas as colunas físicas, incl. `IDEMPRESA` e auditoria) + nome do banco (LEFT JOIN BANCOS) + descrição/códigos do plano de contas (LEFT JOIN PLANO_CONTAS). **No alvo, o JOIN PLANO_CONTAS é DEFERIDO** (só JOIN BANCOS é reconstruído — ver `get_contas_bancarias`).
- **Campos/ProviderFlags (definem a DML do provider):** `[.dfm:L28-131]` — colunas com `pfInUpdate` entram no INSERT/UPDATE; `CODCONTA` é a chave (`pfInUpdate,pfInWhere,pfInKey`, `Required`); `CODBCO` é `pfInUpdate,Required`; `BANCO`,`DESCRICAO_PLC`,`CODIEXPANDIDO`,`CODIREDUZIDO` têm `ProviderFlags=[]` (são **somente leitura** dos JOINs, não persistem). Tipos do `.dfm` (autoritativos): `TITULAR` Size 50, `NROCONTA` Size 10, `GERENTE` Size 50, `FONE1` Size 15, `OBS` Size 300, `CODLANCCONTABIL` Size 30, `CODIGO_TRANSMISSAO_COBRANCA` Size 30, `NROCONVENIO_ARQREM` Size 12, flags Size 1 (`CONTA_PROPRIA`,`EXIBE_REL_APURACAO_CAIXA`,`ATIVO`), `CONVENIO`/`CARTEIRA_COBRANCA`/`VARIACAO_CARTEIRA`/`TIPO_COBRANCA` inteiros.
- **Pipeline de gravação — `[estático/inferido]` (mesmo contrato do form-base já capturado em Bancos).** O provider gera DML **delta-based** (só colunas tocadas com `pfInUpdate`), bindada, WHERE pela PK. **Não capturado em runtime para esta tela**; herda a forma de [uCadBancos §4](uCadBancos.md). Reconstrução esperada:
  ```sql
  -- INSERT (campos preenchidos; CODCONTA gerado app-side por sequence ID_CODCONTA; IDEMPRESA carimbado)
  insert into "CONTAS_BANCARIAS" ("CODCONTA","CODBCO","IDEMPRESA","TITULAR",...,"ATIVO") values (:1,:2,:3,...)
  -- UPDATE (só a(s) coluna(s) alterada(s); WHERE pela chave)
  update "CONTAS_BANCARIAS" set "TITULAR" = :1 where "CODCONTA" = :2
  -- DELETE (físico — exclusão usa flag ATIVO, não há INDR; ver BR-09)
  delete from "CONTAS_BANCARIAS" where "CODCONTA" = :1
  ```
- **⚠️ Carimbo de auditoria = 2º statement SEPARADO `[inferido — herdado do form-base; colunas REAIS]`.** `CONTAS_BANCARIAS` tem `USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO` **reais** `[Oracle-dict]`, então `SetaOperadorAlteracao` do form-base os carimba após o insert/update:
  ```sql
  UPDATE CONTAS_BANCARIAS SET USULTALTERACAO=<op>, DTULTIMALTERACAO=<ts>, DTCADASTRO=<ts> WHERE CODCONTA=<chave> -- após INSERT
  UPDATE CONTAS_BANCARIAS SET USULTALTERACAO=<op>, DTULTIMALTERACAO=<ts> WHERE CODCONTA=<chave>                    -- após UPDATE
  ```
- **PK `CODCONTA` por SEQUENCE app-side** `[Oracle-dict]`: sequence **`ID_CODCONTA`** existe e **NÃO há trigger** que a aplique → o **aplicativo** busca o próximo valor e insere explicitamente. → no alvo: `seq_conta_codconta` / `nextval` no Postgres (paridade de resultado: código sequencial auto-gerado).
- **Mutações:** leitura (Q1) + escrita (INSERT/UPDATE/DELETE via provider) em `CONTAS_BANCARIAS`.
- **Tabelas / triggers / sequences tocadas:**
  - `CONTAS_BANCARIAS` (CRUD). Tem `IDEMPRESA` (NUMBER) e auditoria **REAL** (`USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO`); PK `CODCONTA`; `CONTA_PROPRIA DEFAULT 'N'`. `[Oracle-dict]`
  - `BANCOS` — só leitura (LEFT JOIN, nome do banco). `[.dfm:L14]`
  - `PLANO_CONTAS` — só leitura (LEFT JOIN, descrição/códigos do plano). **DEFERIDO** no alvo. `[.dfm:L16-17]`
  - **Replicação:** **sem trigger `REM_*`** → **esta entidade NÃO replica** (idem `replica:false` no alvo). `[inferido — consistente com a config do novo]`
- **SQL-alvo (Postgres, Kysely via engine):** `read` = `select * from contas_bancarias where codconta = $1 and idempresa = <empresa>` (escopo multi-tenant); a **lista** usa a view `get_contas_bancarias` (LEFT JOIN BANCOS para o nome). Oracle→PG: `NUMBER`→`integer`, `VARCHAR2`→`varchar`, `CHAR(1)`→`char(1)`, `DATE`→`date`, `TIMESTAMP`→`timestamptz`, sequence Oracle→`seq_conta_codconta`. JOIN PLANO_CONTAS **omitido** (deferido).

### Q2 — Lista / Pesquisa (`btnPesquisa`/`rdgAtivo`/F3) — `[estático]` (view do alvo confirmada; SQL final do legado em runtime)
- **Origem:** form-base `TfrmCadMaster.btnPesquisaClick` abre `frmPesquisa` sobre a **VIEW `GET_CONTAS_BANCARIAS`** (não a tabela crua) — padrão das herdeiras. Os lookups F3 do legado também são views: `GET_BANCOS`, `GET_PLANO_CONTAS` (filtro `CLASSE='ANALITICA' AND TIPO='EMPRESA'`), `GET_OPERADORES`. `[Oracle-dict]`,`[.pas:L131,175,165]`
- **View-alvo (reconstruída, `004_contas_bancarias.sql`):**
  ```sql
  CREATE OR REPLACE VIEW get_contas_bancarias AS
  SELECT c.codconta, c.idempresa, c.codbco, b.banco,
         c.titular, c.nroconta, c.gerente, c.ativo
  FROM contas_bancarias c
  LEFT JOIN bancos b ON b.codbco = c.codbco;
  ```
  Expõe `idempresa` (o engine filtra por empresa), faz LEFT JOIN BANCOS para o **nome do banco** (padrão lookup). A SQL final do grid no legado (`Cast('F')Selecionar, GET_CONTAS_BANCARIAS.* …` + where/order do usuário + filtro `rdgAtivo`) é `[inferido]` por analogia com Bancos.
- **Fragmentos condicionais (alvo, `list` do engine):** filtro `campo+operador+valor` (whitelist `colunasPesquisa`), ordenação (whitelist), `limit(min(limite,500))`, escopo `where idempresa = <empresa>`. **Sem** filtro de soft-delete (não há INDR; ver BR-09). `[crud-engine.service.ts:L45-93]`
- **Alvo:** `GET /cadastro/contas-bancarias` (lista) + `GET /cadastro/contas-bancarias/:cod` (read).

### Q3 — `aqqOperador` (detalhe — liberação de operadores) — `[.dfm SQL.Strings]` — **DEFERIDO**
- **Origem:** `uRDmCadContaBancaria.dfm` `[.dfm:L133-177]` — `TFDQuery aqqOperador`, master-detail (`MasterFields=CODCONTA`).
- **SQL base (Oracle, verbatim):**
  ```sql
  SELECT C.CODCONTA, C.CODOPERADOR, O.NOME, C.CBO_BAIXA_CR, C.CBO_BAIXA_CP
  FROM CONTAS_BANCARIAS_OP C
  LEFT JOIN OPERADORES O ON O.CODOPERADOR = C.CODOPERADOR
  WHERE C.CODCONTA = :CODCONTA
  ```
- **Tabela detalhe `CONTAS_BANCARIAS_OP`** `[Oracle-dict]`: chave **`CODCONTA+CODOPERADOR`**; flags `varchar(1)` (`CBO_BAIXA_CR`, `CBO_BAIXA_CP`) e demais flags de habilitação — inclui a grafia legado **`HABILTIAR`** (sic). `OPERADORES` só leitura (nome).
- **Status:** **DEFERIDO** — não reconstruído no alvo (será mestre-detalhe quando `OPERADORES` migrar). Sem tabela, sem endpoint, sem grid no front por ora.

> **Regra de ouro:** Q1 é estática e confiável (idêntica à semente do `.dfm`); o **pipeline de escrita** (provider), o **carimbo de auditoria** e a **SQL final da pesquisa** são `[inferido]` — herdam a forma já **capturada em runtime no piloto Bancos** (mesmo form-base), mas **não foram vistos rodando para esta tela**. Não declarar paridade certificada sem captura V$SQL desta tela. ✅ Já **confirmado** (`[Oracle-dict]`/`[.dfm]`, não inferido): estrutura da tabela (IDEMPRESA + auditoria real + `CONTA_PROPRIA DEFAULT 'N'`), sequence `ID_CODCONTA` sem trigger, SQL estática de Q1/Q3, tipos/tamanhos das colunas, mapa do combo, filtros dos lookups.

---

## 5. Regras de negócio

| ID | Regra | Gatilho | Lógica (verbatim do legado) | *Porquê* | Procedência |
|---|---|---|---|---|---|
| BR-01 | **`IDEMPRESA` carimbado (multi-tenant)** | novo registro | `cdsContaBancariaIDEMPRESA.AsInteger := dmPrincipal.EmpresaCODEMPRESA.AsInteger` | conta corrente pertence a **uma empresa**; isola dados por tenant; `IDEMPRESA` **não** é entrada do usuário | `[uRDmCadContaBancaria.pas:L94]` + `[Oracle-dict: IDEMPRESA NUMBER]` |
| BR-02 | **Default `ATIVO='S'` ao inserir** | novo registro | `cdsContaBancariaATIVO.AsString := 'S'` | conta nasce ativa | `[uRDmCadContaBancaria.pas:L95]` |
| BR-03 | **Banco (CODBCO) obrigatório + existe** | `edtCODBCO.OnExit`/gravar | se vazio (e não cancelando/buscando) → `'Favor entrar com código do banco!'` + foco preso; senão `RetornarValores('BANCOS',…)`; se não achar → `'Banco não encontrado com o Código informado. Verifique!'` | conta sem banco é inválida; FK→`BANCOS` | `[.pas:L277-300]` + `[.dfm: CODBCO Required=True]` |
| BR-04 | **Permissão de gravar/excluir** por form+ação | ao gravar/excluir | RBAC `PossuiAcessoForm('frmCadContasBancarias','BTNGRAVAR'|'BTNEXCLUIR')` (herdado) | controle de acesso data-driven | `[.pas TfrmCadMaster]` (herdado) + `[004_…sql: permissoes FRMCADCONTASBANCARIAS]` |
| BR-05 | **Campos obrigatórios** | ao gravar | `ValidaObrigatorios(cdsPrincipal)` → `Abort` se faltar. Obrigatórios: `CODBCO`, `CODCONTA` (`Required=True` no dataset; `CODCONTA` por sequence) | integridade do cadastro | `[.pas TfrmCadMaster]` + `[.dfm: Required=True]` |
| BR-06 | **`OBS` em MAIÚSCULAS** | digitação no memo | `edtOBSKeyPress`: `Key := UpCase(Key)` | padronização da observação | `[.pas:L410-414]` |
| BR-07 | **`TIPO_COBRANCA` é lista fixa 1–4** | seleção no combo | `JvDBComboBox1`: `Values=['1','2','3','4']` ↔ `Items=['Simples','Descontada','Vendor','Vinculada']`. Grava o **inteiro** 1–4 | classificar a modalidade de cobrança do boleto | `[.dfm:L357-380]` |
| BR-08 | **Convênio 6 ou 7 dígitos** | `btnGravarClick` | se CONVENIO/CARTEIRA/VARIACAO preenchidos e CONVENIO ≠ vazio → `Length(CONVENIO) ∈ {6,7}`, senão `raise 'Convênio deve ter apenas 6 ou 7 posições. Verifique.'` | layout de convênio bancário exige 6 ou 7 posições (banco/CNAB) | `[.pas:L194-203]` |
| BR-09 | **Sem soft-delete (DELETE físico)** + flag `ATIVO` | ao excluir | `CONTAS_BANCARIAS` **não tem `INDR`** → exclusão **física**; `ATIVO` é flag normal (S/N), filtrável na Pesquisa (`rdgAtivo`) | a inativação é por `ATIVO`, não por exclusão lógica; exclusão remove a linha | `[Oracle-dict: sem INDR]` + `[.pas:L432-440 rdgAtivoClick]` |
| BR-10 | **`CONTA_PROPRIA` DEFAULT 'N'** | inclusão (DB) | coluna `CONTA_PROPRIA DEFAULT 'N'`; checkbox `Conta Interna` 'S'/'N' (`ReadOnly` no `.dfm`) | conta de terceiros por padrão; "interna" é exceção marcada | `[Oracle-dict: DEFAULT 'N']` + `[.dfm:L493-506]` |
| BR-11 *(DEFERIDO)* | **Plano de Contas: classe/tipo** | lookup PLC | filtro `(CLASSE='ANALITICA') AND (TIPO='EMPRESA')` no `GET_PLANO_CONTAS` | só conta analítica de empresa pode ser de lançamento | `[.pas:L175]` — **deferido** |
| BR-12 *(DEFERIDO)* | **Operador não duplicado na conta** | salvar item de operador | `OperadorExiste`: `Locate('CODOPERADOR')` na cds → se já existe `'O operador selecionado já foi cadastrado para esta conta corrente…'` + cancela | um operador não pode ser liberado duas vezes na mesma conta | `[.pas:L212-258]` — **deferido** |
| BR-13 *(DEFERIDO)* | **Item de operador: defaults** | novo item | `CODCONTA := master`; `CBO_BAIXA_CR := 'S'`; `CBO_BAIXA_CP := 'S'` | operador liberado já pode baixar a pagar/receber por padrão | `[uRDmCadContaBancaria.pas:L98-103]` — **deferido** |

> Não há cálculo nem regra fiscal nesta tela. As regras são: o contrato do form-base (BR-04/05/09), a integridade FK (BR-03), o multi-tenant (BR-01), e as particularidades próprias — uppercase de OBS (BR-06), combo 1–4 (BR-07) e o **convênio 6/7** (BR-08, a única validação que o `btnGravarClick` próprio injeta). BR-11/12/13 pertencem às **partes deferidas**.

---

## 6. Efeitos colaterais + estado externo

> A seção que salva da armadilha de acoplamento.

| Item | Tipo | Alvo | Quem setou / consome | Mapeamento alvo |
|---|---|---|---|---|
| `dmPrincipal.FDConexao` | usa | conexão Oracle **global** | datamodule principal (boot) | conexão **por tenant** request-scoped |
| `dmPrincipal.EmpresaCODEMPRESA` | lê | empresa logada | login/seleção de empresa | `currentTenant().empresaId` (carimba `idempresa`, fail-closed) `[crud-engine.service.ts:L100-101]` |
| `dmPrincipal.OperadorCODOPERADOR` | lê | operador logado | login | `currentTenant().operadorId` (carimbo de auditoria) |
| `dmPrincipal.PossuiAcessoForm` | lê | RBAC | tabela `PERMISSOES` | guard/policy por rota+ação (`FRMCADCONTASBANCARIAS`) |
| `USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO` | grava | colunas **reais** de `CONTAS_BANCARIAS` | `SetaOperadorAlteracao` herdado | `stamp()` do engine `[crud-engine.service.ts:L156-167]` |
| **trigger `REM_CONTAS_BANCARIAS`** | **N/A — não existe** | — | — | **sem outbox de sync** (`replica:false`) `[inferido]` |
| `HISTORICO_DINAMICO` | grava (indireto) | tabela de histórico | `SetaHistorico_Dinamico` no `btnGravarClick` herdado | `gravarHistorico` do engine `[crud-engine.service.ts:L116]` |
| `MENUEXPRESS` | grava | telemetria de uso | ao abrir a tela (padrão form-base) `[inferido]` | métrica de uso (opcional no alvo) |
| `TLog.GravaLog` | grava | log de aplicação | `btnGravarClick` herdado `[inferido]` | logging estruturado |
| **`BANCOS`** | lê | tabela FK | LEFT JOIN / `RetornarValores` | FK no Postgres + view com JOIN |
| **`PLANO_CONTAS`** *(DEFERIDO)* | lê | tabela FK | LEFT JOIN / lookup | **deferido** até migrar |
| **`OPERADORES` / `CONTAS_BANCARIAS_OP`** *(DEFERIDO)* | lê/grava | detalhe | aba de operadores | **deferido** até migrar |

- **Conexão/transação:** usa a conexão **global** do `dmPrincipal`; no alvo, a gravação (delta + carimbo + histórico) roda numa **única transação** escopada `[crud-engine.service.ts:L96-119]`. **Sem outbox** (não replica).
- **Ordem de abertura assumida:** presume login feito **e empresa selecionada** (`dmPrincipal.EmpresaCODEMPRESA`); sem empresa, o carimbo `IDEMPRESA` (NOT NULL no alvo) barra a escrita — precondição que vira **tenant context fail-closed**.

> **Diferenças que mais importam:** (1) **multi-tenant real** — diferente de Bancos/OperacoesConta, esta tela carimba `IDEMPRESA` e **filtra leitura/lista por empresa** (`empresaScoped:true`); o estado global `dmPrincipal.EmpresaCODEMPRESA` vira tenant context explícito. (2) **Sem replicação** — não há trigger `REM_*`, então **zero eventos de outbox** (fidelidade, não simplificação). As escritas-sombra restantes (`HISTORICO_DINAMICO`, telemetria, carimbo de auditoria sobre colunas **reais**) seguem o padrão do form-base, `[inferido]` até captura de runtime desta tela.

---

## 7. Dependências

| Dependência | Tipo | Como é usada | Vira (alvo) |
|---|---|---|---|
| `TfrmCadMasterDetalhe` (→ `TfrmCadMaster`) | **herança** | todo o CRUD mestre-detalhe: gravar/editar/excluir/pesquisar/navegar, validação, carimbo, histórico, log, RBAC, teclado, `ListaDetalhes` | **engine CRUD reutilizável** (`CrudConfig`; `AggregateConfig` p/ o detalhe quando voltar) ([../../03-legacy-analysis/recon/form-base-cadmaster.md](../../03-legacy-analysis/recon/form-base-cadmaster.md)) |
| `TRDmCadContaBancaria` (`uRDmCadContaBancaria`) | datamodule | `aqqContaBancaria`→`dspContaBancaria`→`cdsContaBancaria` (mestre) + `aqqOperador`/`cdsOperador` (detalhe); hospeda `OnNewRecord` (IDEMPRESA/ATIVO) | `CrudConfig` + engine (sem estado) |
| `udmPrincipal` (`dmPrincipal`) | datamodule global | conexão, empresa, operador, RBAC, `RetornarValores`, `ShowPesquisa` | tenant context + providers |
| `uPesquisa` (`frmPesquisa`) | form modal | lookups F3: `GET_BANCOS` (ativo), `GET_PLANO_CONTAS`/`GET_OPERADORES` (deferidos) | `<SelectField>`/modal de busca |
| `FuncoesApollo` | unit utilitária | `RetornarValores`, `Mensagem`, `SetaFoco`, `iif` | helpers/serviço |
| `JvDBComboBox` (`TJvDBComboBox`) | lib JVCL | combo `TIPO_COBRANCA` (Values/Items 1–4) | `<SelectField>` |
| `TSearchEngineApollo` (`SegPlanoContas`) *(DEFERIDO)* | componente de busca | lookup de Plano de Contas (`CLASSE='A'`,`TIPO='E'`) | **deferido** |
| **`BANCOS`** | tabela FK | LEFT JOIN + lookup obrigatório | FK + view JOIN no alvo |
| **`PLANO_CONTAS`** *(DEFERIDO)* | tabela FK | LEFT JOIN + lookup | **deferido** |
| **`OPERADORES` / `CONTAS_BANCARIAS_OP`** *(DEFERIDO)* | tabelas (detalhe) | aba "Liberação de operadores" | **deferido** |
| FastReport (`frx*`), AppEvnts, cxGrid | libs | export/UI (herdado, `uses`) | export server-side / DataGrid do DS |

> Esta é a 1ª tela documentada que exercita **FK/lookup** (`BANCOS`) e **escopo por empresa** reais no engine. O detalhe `CONTAS_BANCARIAS_OP` mapeia para `AggregateConfig`/`DetalheConfig` (já previstos no `crud-config.ts`) quando `OPERADORES` migrar.

---

## 8. TabOrder + mapa de atalhos/mnemônicos

**TabOrder da aba "Contas Correntes" (sequência exata `[.dfm]`):**

| Ordem (`TabOrder`) | Controle | Campo | Tipo | Nota |
|---|---|---|---|---|
| 0 | `edtCODBCO` | CODBCO | TDBEdit | foco inicial (`SetaDataset`, `[.pas:L427]`) |
| 1 | `edtTITULAR` | TITULAR | TDBEdit | — |
| 2 | `edtNROCONTA` | NROCONTA | TDBEdit | — |
| 3 | `edtDTABERTURA` | DTABERTURA | TJvDBDateEdit | — |
| 4 | `edtFONE1` | FONE1 | TDBEdit | — |
| 5 | `edtGERENTE` | GERENTE | TDBEdit | — |
| 6 | `edtOBS` | OBS | TDBMemo | — |
| 7 | `edtLancContabil` | CODIREDUZIDO (PLC) | TDBEdit | **DEFERIDO** (lookup) |
| 8 | `BtnBuscaPlanoContas` | — | TBitBtn | **DEFERIDO** |
| 9 | `EdtDescConta` | DESCRICAO_PLC | TJvDBMaskEdit | **DEFERIDO** |
| 10 | `chbCONTA_PROPRIA` | CONTA_PROPRIA | TJvDBCheckBox | flag |
| 11 | `CkbExibeRelApuracaoCaixa` | EXIBE_REL_APURACAO_CAIXA | TJvDBCheckBox | flag |
| 12 | `CkbAtivo` | ATIVO | TJvDBCheckBox | flag |
| 13 | `edtBANCO` | BANCO | TDBEdit | `TabStop=False` (espelho ReadOnly) |
| 14 | `btnBuscaBanco` | — | TBitBtn | `TabStop=False` |
| 15 | `grbBoleto` (Convênio→Carteira→Variação→Cód.Transmissão→Tipo) | — | grupo | sub-taborder 0–4 dentro do grupo |
| 16 | `grbArquivoRemessa` (Nº Convênio) | NROCONVENIO_ARQREM | grupo | sub-taborder 0 |

> Dentro de `grbBoleto` `[.dfm:L330-390]`: `edtConvenio`(0)→`edtCarteira`(1)→`edtVariacao`(2)→`JvDBComboBox1`/Tipo(3)→`edtCodTransmissao`(4). Foco inicial do form: `edtCODBCO`. Replicar a taborder exata (ADR-010).

**Mnemônicos `&` (Alt+letra):** **nenhum nos labels/captions do `.dfm` legado** — os labels (`Banco`,`Titular`,`Nº Conta`,`Data de abertura`,`Telefone`,`Gerente`,`Observação`,`Plano de contas`,`Boleto`,`Arquivo remessa`,`Convênio`,`Carteira`,`Variação`,`Tipo do titulo`,`Cód. Transmissão`) e os checkboxes (`Conta Interna`,`Exibe no relatório…`,`Ativo`) **não têm `&`** `[.dfm]`. Os mnemônicos/atalhos vivem nos **botões herdados** do rodapé: `&Gravar`,`&Editar`,`E&xcluir`,`&Adicionar`,`&Sair`/`&Cancelar` ([form-base-cadmaster.md §4](../../03-legacy-analysis/recon/form-base-cadmaster.md)).

> Nota de paridade no alvo: o app **adiciona** mnemônicos aos campos (`&Banco`,`&Titular`,`Nº &Conta`,`&Gerente`,`Data de &abertura`,`&Telefone`,`&Observação`,`Conta &Interna`,`&Exibe…`,`&Ativo`, e no grupo Boleto `&Convênio`,`Cart&eira`,`&Variação`,`&Tipo do título`,`Cód. &Transmissão`, e Arquivo remessa `…&remessa`) que o legado **não tinha** — melhoria de teclado (ADR-010), divergência benigna (adiciona, não remove memória muscular). `[ContasBancariasCadMaster.tsx]`

**Atalhos (F-keys/Enter/Esc):**

| Atalho | Ação | Origem | Escopo | Reservado pelo browser? |
|---|---|---|---|---|
| `F3` (em `edtCODBCO`) | abre pesquisa de banco (`GET_BANCOS`) | `edtCODBCOKeyUp`→`spbCODBCOClick` `[.pas:L302-308]` | campo | não |
| `F3` (em `edtCodigo`) | abre Pesquisa | `edtCodigoKeyDown` `[.pas:L319]` | tela | não |
| `Enter` (em `edtCodigo`) | vazio→Adicionar; senão carrega por código | `edtCodigoKeyDown` `[.pas:L321-344]` | tela | não |
| `F3` (em `edtLancContabil`/`edtCodOperador`) *(DEFERIDO)* | lookup PLC/operador | `[.pas:L406,388]` | campo | não |
| `F6` | filtro ativo/inativo/todos (`rdgAtivo`) | form-base | tela | não |
| Botões rodapé / `Esc` | Gravar/Editar/Excluir/Adicionar/Sair | form-base | tela | não |

---

## 9. Casos de teste (golden) — capturados do legado

> ⚠️ **Os casos abaixo são resultado do NOVO (smoke + integração verdes), não golden de runtime certificado do legado.** Diferente do piloto Bancos (V$SQL/REMESSA_SERVER capturados), esta tela **ainda não foi exercitada no ERP legado com log de SQL ligado**. As estruturas (✅) vêm de `[Oracle-dict]`/`[.dfm]`; o comportamento do alvo (🟢) é verificado pelo teste de integração `apps/api/test/banco.integration.spec.ts` (bloco "3ª tela — Contas Bancárias via ENGINE", `[L145-163]`) e pelo `scripts/smoke.ts`. **Golden runtime do legado = pendência** para `paridade-verde`.

| ID | Cobre (BR/Q + caminho) | Input (estado + campos) | Ação | Output esperado | Procedência |
|---|---|---|---|---|---|
| G-01 | Q1/Q2 leitura + JOIN BANCOS | seed: 3 contas `idempresa=1` | listar | 3 linhas; a matriz (codbco=1) traz `banco='BANCO DO BRASIL'` via JOIN | 🟢 `banco.integration.spec.ts:L148-152` |
| G-02 | BR-03 FK válido + BR-01 carimbo | `{codbco:2, titular:'NOVA', nroconta:'111', ativo:'S'}` | criar | 201; linha persistida com `codbco=2`; `idempresa` carimbado | 🟢 `…spec.ts:L154-157` |
| G-03 | BR-03 FK inválido | `{codbco:99999, titular:'X', ativo:'S'}` | criar | **rejeitado pelo banco** (FK) → erro (no alvo, 409 PT `REGISTRO_RELACIONADO_INEXISTENTE`, nunca 500) | 🟢 `…spec.ts:L160-163` |
| G-04 | BR-01 multi-tenant (fail-closed) | sem tenant no contexto | listar/criar | bloqueio (idempresa NOT NULL barra escrita; read filtra por empresa) | 🟢 `empresaScoped` `[crud-engine.service.ts:L40,49,101]` |
| G-05 | BR-08 convênio | `convenio` com 5 dígitos | gravar | erro `'Convênio deve ter apenas 6 ou 7 posições. Verifique.'`; 6 ou 7 → ok | ✅ `[.pas:L194-203]` + 🟢 `conta-bancaria.schema.ts:L54-61` |
| G-06 | BR-06 OBS uppercase | `obs='conta movimento'` | gravar | persiste `'CONTA MOVIMENTO'` | ✅ `[.pas:L410-414]` + 🟢 `conta-bancaria.schema.ts:L42-48` |
| G-07 | BR-07 combo | `tipo_cobranca` = Descontada | gravar | grava `2` (inteiro), não `'Descontada'` | ✅ `[.dfm:L357-380]` + 🟢 `TIPO_COBRANCA` |
| G-08 | INSERT (delta) + auditoria | gravar novo | `insert into contas_bancarias (...)` + `stamp()` carimba `DTCADASTRO`/`DTULTIMALTERACAO`; **SEM replicação** | 🟡 inferido (form-base) + ✅ `[Oracle-dict: auditoria real]` |
| G-09 | UPDATE (delta) | editar `titular` | `update … set titular=$1 where codconta=$2`; carimba `USULTALTERACAO`; **SEM replicação** | 🟡 inferido |
| G-10 | DELETE (físico, BR-09) | excluir | `delete from contas_bancarias where codconta=$1` (sem INDR); **SEM replicação** | ✅ `[Oracle-dict: sem INDR]` + 🟡 inferido |
| G-11 | BR-05/BR-03 obrigatórios | sem `codbco` | gravar | 400 (validação antes do banco) `'Banco é obrigatório'` | 🟢 `conta-bancaria.schema.ts:L65` |
| G-12 | BR-04 RBAC | operador sem `FRMCADCONTASBANCARIAS/BTNGRAVAR` | gravar | bloqueio (zero DML) | 🟡 inferido + ✅ `[004_…sql: permissoes]` |

**A capturar para certificar (V$SQL — golden runtime do legado, pendente):** G-08/G-09/G-10 reais, o carimbo de auditoria desta tabela, e a SQL final da pesquisa com filtro/ordenação. **Partes DEFERIDAS (sem golden):** lookup `GET_PLANO_CONTAS` (BR-11) e o detalhe `CONTAS_BANCARIAS_OP` (BR-12/BR-13) — golden só quando construídos.

---

## 10. Alvo (especificação de implementação)

**Backend (NestJS + Kysely — via engine CRUD declarativo, `contas-bancarias.crud.ts`):**
- Módulo: `cadastro` (config declarativa).
- Endpoints (gerados por `createCrudController`):
  | Método+rota | Origem | DTO (zod) | Mutação? |
  |---|---|---|---|
  | `GET /cadastro/contas-bancarias` | Q2 (view get_contas_bancarias) | — | leitura (filtra por empresa) |
  | `GET /cadastro/contas-bancarias/:cod` | Q1 | — | leitura (filtra por empresa) |
  | `POST /cadastro/contas-bancarias` | btnGravar (insert) | `contaBancariaSchema` | escrita (carimba idempresa; **sem outbox**) |
  | `PUT /cadastro/contas-bancarias/:cod` | btnGravar (update) | `atualizarContaBancariaSchema` | escrita (sem outbox) |
  | `DELETE /cadastro/contas-bancarias/:cod` | btnExcluir | — | escrita física (BR-09) |
- Config: `empresaScoped:true` (BR-01), `softDelete:false` (BR-09), `replica:false` (sem `REM_*`), `rbacForm:'FRMCADCONTASBANCARIAS'` (BR-04), PK `codconta` por sequence, `colunasPesquisa:['codconta','banco','titular','nroconta','gerente','ativo']`. FK `codbco`→`bancos` garantida pelo Postgres; auditoria/histórico herdados do engine.
- DTO/zod: `codbco` obrigatório (BR-03); `obs` `.toUpperCase()` (BR-06); `convenio` inteiro 6/7 (BR-08); `tipo_cobranca` ∈ {1,2,3,4} (BR-07); flags S/N; `conta_propria` default 'N' (BR-10), `ativo` default 'S' (BR-02).

**Frontend (React — `ContasBancariasCadMaster.tsx`, via pilar `<CadMaster>`):**
- Rota `/cadastro/contas-bancarias` (lista) + `/:cod` (form). Campos/ordem = seção 2; taborder/Enter-avança/mnemônicos do engine (seção 8).
- `<SelectField>` Banco (lookup via `useResourceOptions('cadastro/bancos')`), `<Field>`/`<DateField>`/`<TextArea>`/`<NumberField>`/`<CheckboxField>`, grupos Boleto e Arquivo remessa em `<fieldset>`. `defaultValues` espelham `OnNewRecord` (`ativo:'S'`, `conta_propria:'N'`).

**Decisões offline (PDV/Electron):** N/A direto — cadastro roda na **retaguarda/nuvem**. **Sem replicação** (entidade sem trigger `REM_*`) → **não há delta de sync** a propagar.

---

## Paridade com o novo

> **Implementação Fase 0 COMPLETA e VERDE** em `/Library/Apollo` (monorepo `sicom`: NestJS+Kysely+React), via **engine CRUD declarativo** (a 3ª tela; a 1ª com FK/lookup + escopo por empresa). **Fiel-por-construção, com smoke + integração verdes; SEM golden de runtime certificado do legado** (≠ piloto Bancos).

**Migração — `apps/api/migrations/004_contas_bancarias.sql`:** cria `contas_bancarias` (17 colunas de negócio + idempresa + auditoria), `seq_conta_codconta` (PK), view `get_contas_bancarias` (LEFT JOIN bancos → nome), seed de 3 contas (`idempresa=1`) e RBAC `FRMCADCONTASBANCARIAS`. `conta_propria DEFAULT 'N'`, `ativo DEFAULT 'S'`. `codlanccontabil` criado **sem FK** (lookup deferido).

**Backend — `apps/api/src/modules/cadastro/contas-bancarias.crud.ts`:** config declarativa (`empresaScoped/softDelete:false/replica:false`, 17 colunas, sem `idempresa`/`codconta` na lista editável). Controller gerado.

**Schema — `packages/shared/src/schema/conta-bancaria.schema.ts`:** `TIPO_COBRANCA` (1–4 fiel ao `.dfm`); `obs` uppercase; `convenio` 6/7; `codbco` obrigatório; flags S/N. Documenta as partes deferidas (Plano de Contas / Operadores).

**Frontend — `apps/web/src/features/contas-bancarias/ContasBancariasCadMaster.tsx`:** aba mestre completa via `<CadMaster>`, com FK de Banco, grupos Boleto/Arquivo remessa e mnemônicos `&` (adição benigna).

**Divergências conhecidas / pendências:**
1. **Golden de runtime do legado (pendência principal de `paridade-verde`)** — fiel por estática + SQL-shape + testes do alvo; só Bancos é runtime-golden. Capturar V$SQL desta tela para certificar G-08/G-09/G-10 e o carimbo de auditoria.
2. **DEFERIDO — FK Plano de Contas (BR-11):** `CODLANCCONTABIL` é texto livre, **sem lookup `GET_PLANO_CONTAS`**, sem botão de busca, sem espelho de descrição. Construir quando `PLANO_CONTAS` migrar (filtro `CLASSE='ANALITICA' AND TIPO='EMPRESA'`).
3. **DEFERIDO — aba Operadores (`CONTAS_BANCARIAS_OP`, BR-12/BR-13):** mestre-detalhe não construído (tabela, endpoint, grid). Construir quando `OPERADORES` migrar (chave `CODCONTA+CODOPERADOR`; flags `varchar(1)` incl. grafia legado `HABILTIAR`; defaults `CBO_BAIXA_CR/CP='S'`; guarda de duplicidade).
4. **`x-operador-id`/contexto de sessão** — identidade real vem do login/tenant context no alvo (placeholder em dev).
5. **Telemetria `MENUEXPRESS` / `HISTORICO_DINAMICO`** — histórico herdado do engine; telemetria de acesso não implementada (decidir manter/descartar).

---

## Lacunas (para sair de `em-revisão`)

**✅ Confirmado (`[Oracle-dict]` + `[.dfm]`/`[.pas]`):** estrutura de `CONTAS_BANCARIAS` (IDEMPRESA + auditoria **real** + `CONTA_PROPRIA DEFAULT 'N'`); PK `CODCONTA` por sequence `ID_CODCONTA` **sem trigger** (app-side); detalhe `CONTAS_BANCARIAS_OP` (chave `CODCONTA+CODOPERADOR`, flags `varchar(1)` incl. `HABILTIAR`); tipos/tamanhos das colunas; SQL estática de Q1 e Q3; mapa do combo `TIPO_COBRANCA` (1–4); filtros dos lookups (`GET_BANCOS`, `GET_PLANO_CONTAS` `CLASSE='ANALITICA'/TIPO='EMPRESA'`, `GET_OPERADORES`); herança `TfrmCadMasterDetalhe`; convênio 6/7; OBS uppercase; defaults `IDEMPRESA`/`ATIVO='S'`.

**🟢 Verificado no alvo (smoke + integração):** seed 3 contas `idempresa=1`; view traz nome do banco via JOIN; create com FK válido carimba; create com FK inválido é rejeitado; multi-tenant fail-closed; validações de DTO (convênio, obrigatório, uppercase, combo).

**🟡 Inferido (form-base, capturado em Bancos mas NÃO nesta tela):** pipeline de escrita delta-based; carimbo de auditoria como 2º statement; `SetaUltimaAlteracao`; SQL final da pesquisa; telemetria `MENUEXPRESS`; `HISTORICO_DINAMICO`; `TLog.GravaLog`.

**🚧 DEFERIDO (construir quando as dependências migrarem):** lookup FK **Plano de Contas** (`PLANO_CONTAS`/`GET_PLANO_CONTAS`, BR-11) e a aba mestre-detalhe **"Liberação de operadores"** (`OPERADORES`/`CONTAS_BANCARIAS_OP`, BR-12/BR-13 + Q3).

**Pendências (não marcar `paridade-verde`/`concluído` sem elas):**
1. **Captura de runtime (V$SQL) do legado** desta tela — fecha as seções 4 e 9 com golden certificado (hoje 🟡/🟢-do-novo).
2. **Construir as partes DEFERIDAS** quando `PLANO_CONTAS`/`OPERADORES` migrarem.
3. **Revisão independente** ([../../08-agents/review-loop.md](../../08-agents/review-loop.md)) — autor ≠ revisor.
4. **Paridade verde que exercita o caminho real** ([../../06-testing-quality/parity-harness.md](../../06-testing-quality/parity-harness.md)) — incl. teclado (taborder, Enter, mnemônicos via Playwright).

## Ver também

- [dossier-template.md](../../dossier-template.md) · [dossier-process.md](../../dossier-process.md)
- [uCadBancos.md](uCadBancos.md) — o piloto runtime-golden (FK autorreferente, replicação `REM_*`); este dossiê reusa seu contrato de form-base e o exercita com FK externa + multi-tenant.
- [uCadOperacoesConta.md](uCadOperacoesConta.md) — 2ª herdeira (combo de lista fixa); mesma tese de engine declarativo.
- [form-base-cadmaster.md](../../03-legacy-analysis/recon/form-base-cadmaster.md) — contrato de `TfrmCadMaster`/`TfrmCadMasterDetalhe`.
- [../../03-legacy-analysis/dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md) — como fechar as seções 4 e 9 (runtime).
- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — ADR-008/010/011/012/014.
