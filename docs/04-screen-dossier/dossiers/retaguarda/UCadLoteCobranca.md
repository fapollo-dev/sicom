# Dossiê — `frmCadLoteCobranca` (Cadastro de Lote de Cobrança — MESTRE-DETALHE)

| Campo | Valor |
|---|---|
| **Status** | **`em-revisão`** — tela **construída fiel** (master-detalhe ponta a ponta: backend agregado transacional + web `CadMaster` + picker multi-seleção; smoke do agregado **verde**). A **pendência-coroa** é o **golden de RUNTIME do legado** — em especial a **fórmula de juros/total** (`sqqITENS_LOTECOB`), hoje **transcrita** do `.dfm` mas **não certificada** contra o ERP rodando. |
| **Autor / Revisor** | agente Analista de Legado (Claude) / *pendente — revisor independente ([../../08-agents/review-loop.md](../../08-agents/review-loop.md))* |
| **Versão do dossiê** | v0 (recon estática + dicionário Oracle + impl. master-detalhe verde) — casada com as migrations 005/014/015/016 e o módulo `cobranca` |
| **Data** | 2026-06-25 |
| **Commit do legado analisado** | `/Library/SicomGit/retaguarda-master` (branch `*-master`, sem hash versionado) |

> **Por que esta tela:** é uma das **7 herdeiras mestre-detalhe** ([form-base-cadmaster.md §5b](../../03-legacy-analysis/recon/form-base-cadmaster.md)) e a **primeira documentada** dessa família. Ela exercita o que o CRUD de tabela única (uCadBancos/uCadOperacoesConta) não cobre: **save de agregado** (header `LOTE_COBRANCA` + N itens `ITENS_LOTECOB` numa transação), **exclusão em cascata**, e um detalhe cujo grid é **quase todo LIVE-JOIN** — só `CODRCB` é coluna persistida; duplicata, cliente, datas, valor e **juros/total** vêm de um JOIN `ARECEBER→PARCEIROS→PARCEIROS_END` com **cálculo financeiro embutido na própria SELECT**. Além disso introduz dois padrões novos: o **picker multi-seleção** (`btnAddIten` → `frmPesquisa('GET_ARECEBER')` com `HabilitaMultiselecao`) e o **lookup do "Cobrador"** (`SegFornecedor`/F3 sobre `PARCEIROS` com `FUN='S'`).
>
> ⚠️ **Limite desta versão:** o **valor financeiro** (JUROS/TOTAL) é o risco-coroa. A fórmula está **transcrita verbatim** do `sqqITENS_LOTECOB` (`.dfm`) para a view `get_itens_lotecob` (016) e a view `get_areceber` (015) — Oracle→Postgres com `CURRENT_DATE - TRUNC(DTVENC)` → `CURRENT_DATE - dtvenc::date`, `COALESCE`, `GREATEST(0,…)`. Mas **não foi vista rodando** com captura V$SQL: divergência de 1 centavo reprova paridade (risco financeiro). Marcar **"needs runtime golden"** até a captura.

---

## 1. Identidade

| Campo | Valor |
|---|---|
| **Form (`.pas` / `.dfm`)** | `retaguarda-master/fonte/Units/UCadLoteCobranca.pas` (223 linhas) + `UCadLoteCobranca.dfm` (1.498 linhas — a maior parte é o `TfrxReport` embutido) `[.dfm]` |
| **Classe do form** | `TfrmCadLoteCobranca` — **herda `TfrmCadMasterDet`** (`uCadMasterDet.pas`, variante mestre-detalhe sobre `TfrmCadMaster`) via herança visual (`inherited frmCadLoteCobranca`) `[.dfm:L1]`, `[.pas:L15]` |
| **Módulo de domínio** | `financeiro` (cobrança/contas a receber) — agrupa títulos `ARECEBER` num "lote" entregue a um **Cobrador** |
| **Função no negócio** | O operador monta um **lote de cobrança**: escolhe o **Cobrador** (um `PARCEIRO` com `FUN='S'`), a data de **Emissão** (default hoje) e **adiciona títulos a receber** (multi-seleção via picker) que comporão o lote. O grid mostra, por título, duplicata/cliente/vencimento/valor e o **juro e total calculados em tempo real** pela carência do cliente. Gera os relatórios FastReport (geral e agrupado por bairro) para o cobrador rodar. |
| **Frequência / criticidade** | **média** frequência (rotina de cobrança), **alta** criticidade financeira — os valores de **juros/total** exibidos/relatados são dinheiro (base do que o cobrador recebe). **Não é caminho de PDV.** **Não toca fiscal**, mas toca **cálculo financeiro** (juros). |
| **Rota-alvo (web)** | `cobranca/lotes-md` (lista) + `cobranca/lotes-md/:id` (form mestre-detalhe) — **já implementada** sobre o pilar `<CadMaster>` (ver [Paridade com o novo](#paridade-com-o-novo)). |
| **Casca-alvo** | `browser` — tela de retaguarda/financeiro, sem device, sem teclas reservadas críticas. **F3** (abre lookup de cobrador) **não** é reservada pelo Chromium ⇒ replicável no browser. (Electron só se entrar no pacote power-user; não há requisito próprio.) |

---

## 2. UI — inventário de componentes (`.dfm` → React)

Herança visual de `TfrmCadMasterDet`: o `.dfm` herda do form-base `imgCabecalho`, `lblTitulo`, `pnlGeral` (área dos campos do master), `pnlCabecalho` (`edtCodigo`+`DBNavigator1`), `pnlRodapeMaster` (botões de ação Gravar/Cancelar/Editar/Excluir/Adicionar + `btnOutros`), `stbHints`, `ppmBotaoOutros`. Caption do título: `'Lotes de Cobrança'` `[.dfm:L17]`. Abaixo, os controles **próprios** desta tela. Dois agrupamentos: o **master** (em `pnlGeral`, bind `dtsPrincipal` → `cdsLoteCobranca`) e o **detalhe** (`pnlItens` → `pnlCab` com botões + `DbGridDados` bind `dtsItens` → `cdsITENS_LOTECOB`).

| Controle (`.dfm`) | Tipo VCL | Left,Top,W,H | Caption/label | DataField (`DataSource`) | → React (DS) | Nota de reflow |
|---|---|---|---|---|---|---|
| `pnlGeral` | `TPanel` | herdado, H=48 | — | — | container do master | linha de cabeçalho do master |
| `lblCODFOR` | `TLabel` | 5,2,45,13 | `Cobrador` (sem `&`) · `FocusControl=edtCODFOR` | — | `<label>` do `<SelectField>` | master, col 1 |
| `edtCODFOR` | `TDBEdit` | 6,18,55,21 | Hint `Informe o Código do Cobrador ou Consulte com (F3)` | `CODPARCEIRO` (`dtsPrincipal`) | `<SelectField>` (lookup) | master, col 1 — código do cobrador |
| `btnLocFornecedor` | `TBitBtn` | 65,18,28,24 | (glyph lupa) · `TabStop=False` | — | embutido no `<SelectField>` (lookup) | abre `frmPesquisa('GET_PARCEIROS')` |
| `edtRAZAO` | `TJvDBMaskEdit` | 99,18,276,21 | — · `ReadOnly=True` `Enabled=False` `Color=clBtnFace` | `RAZAO` (`dtsPrincipal`) | rótulo do option do `<SelectField>` | master — só exibe a razão (não editável) |
| `Label14` | `TLabel` | 399,2,38,13 | `Emissão` (sem `&`) · `FocusControl=edtDTVENC` | — | `<label>` do `<DateField>` | master, col 2 |
| `edtDTVENC` | `TJvDBDateEdit` | 399,18,89,21 | `DefaultToday=True` `ShowNullDate=False` | `DATA` (`dtsPrincipal`) | `<DateField>` (default hoje) | master, col 2 — Emissão |
| `pnlItens` | `TPanel` | 0,118,802,295 `Align=alClient` | — | — | container do detalhe | área do grid de itens |
| `Label1` | `TLabel` | 0,0,802,13 `Align=alTop` | `   Documentos para Cobrança` (azul) | — | `<legend>`/cabeçalho de seção | título da seção detalhe |
| `pnlCab` | `TPanel` | 0,13,85,282 `Align=alLeft` | — | — | barra de ações do detalhe | coluna esquerda de botões |
| `btnAddIten` | `TBitBtn` | 0,0,85,25 `Align=alTop` | `&Adicionar` (Alt+A) · Hint `Adicionar registro Dod. Lote` | — | `<Button label="Adicionar &títulos">` | abre picker multi-seleção |
| `btnExcluirItem` | `TBitBtn` | 0,25,85,25 `Align=alTop` | `E&xcluir` (Alt+X) · Hint `Excluir registro Doc do Lote` | — | ação "Remover" por linha (ícone) | remove item corrente |
| `DbGridDados` | `TJvDBUltimGrid` | 85,13,717,282 `Align=alClient` | `ReadOnly=True` `AlternateRowColor` | (`dtsItens` → `cdsITENS_LOTECOB`) | `<DataTable>` read-only (DS) | grid de itens — 13 colunas (abaixo) |

**O grid de itens `DbGridDados` (o achado de UI desta tela)** `[.dfm:L427-539]` — **`ReadOnly=True`** (não se edita célula; a edição é por adicionar/remover linha inteira), `Options` inclui `dgConfirmDelete`, `dgCancelOnExit`. Colunas (verbatim, na ordem do `.dfm`):

| # | `FieldName` | `Title.Caption` | Width | Tipo (origem) | Persistido? |
|---|---|---|---|---|---|
| 0 | `CODRCB` | `Código` | — | inteiro (FK→ARECEBER) | **SIM** (única coluna STORED do item) |
| 1 | `DUPLICATA` | `Duplicata` | 60 | string (live-join ARECEBER) | não |
| 2 | `DTVENDA` | `Emissão` | 60 | data (live-join ARECEBER) | não |
| 3 | `DTVENC` | `Venc.` | 60 | data (live-join ARECEBER) | não |
| 4 | `TXJUROS` | `Tx. Juros` | 50 | numérico (live-join ARECEBER) | não |
| 5 | `JUROS` | `Juro` | — | **calculado na SELECT** | não (computado) |
| 6 | `TOTAL` | `Total` | — | **calculado na SELECT** | não (computado) |
| 7 | `CODPARCEIRO` | `Cód.Cliente` | 50 | inteiro (live-join PARCEIROS) | não |
| 8 | `RAZAO` | `Cliente` | 100 | string (live-join PARCEIROS) | não |
| 9 | `ENDERECO` | `Endereço` | 100 | string (live-join PARCEIROS_END) | não |
| 10 | `BAIRRO` | `Bairro` | — | string (live-join PARCEIROS_END) | não |
| 11 | `CIDADE` | `Cidade` | 64 | string (live-join PARCEIROS_END) | não |
| 12 | `UF` | (sem caption) | 64 | char(2) (live-join PARCEIROS_END) | não |

> **No alvo:** `DbGridDados` → `<DataTable>` read-only (`apps/web/src/features/lotes-md/LotesCobrancaCadMaster.tsx`), com colunas `codrcb/duplicata/razao/dtvenc/valor/juros/total` (subconjunto exibido) + ação "Remover" por linha (`Trash2`). O `btnAddIten` vira `<Button label="Adicionar &títulos">` que abre o `<AddTitulosModal>`. `edtCODFOR`+`btnLocFornecedor`+`edtRAZAO` colapsam num **único** `<SelectField label="&Cobrador">` (lookup de parceiros FUN='S' que mostra `"cod - razão"`). `edtDTVENC` → `<DateField label="&Emissão">` com default hoje.

**Componentes não-visuais do `.dfm`** (importam para Dados/Eventos): `cdsTempClonado: TClientDataSet` `[.dfm:L552]` (recebe a multi-seleção do picker); `dtsItens: TDataSource` → `cdsITENS_LOTECOB` `[.dfm:L558]`; `SegFornecedor: TSearchEngineApollo` `[.dfm:L563]` (busca/valida cobrador, ver Q3); `rptLoteCobranca: TfrxReport` + 3 `TfrxDBDataset` `[.dfm:L604]` (relatórios). `dtsLoteCob`/`frxDBDatasetPrincipal` alimentam o relatório.

**Notas de reflow:** layout absoluto `Left/Top` → master em **grid fluido de 2 colunas** (Cobrador largo + Emissão) e detalhe em **seção com toolbar + grid**, preservando ordem de leitura e taborder (seção 8); **não** copiar pixels. O glyph BMP embutido do `btnLocFornecedor`/botões é descartável (ícone do DS).

---

## 3. Eventos

Handlers próprios de `UCadLoteCobranca.pas` (o ciclo de gravar/excluir/pesquisar/navegar é herdado de `TfrmCadMasterDet`/`TfrmCadMaster` — ver seção 7). Diferente das telas de tabela única, esta tela **sobrescreve bastante** porque o detalhe é montado em código (picker + append manual).

| Componente.Evento | `.pas` | O que faz (passo a passo) | Toca SQL? | Toca estado externo? | Vira (alvo) |
|---|---|---|---|---|---|
| `FormCreate` | `[.pas:L186-196]` | `inherited`; cria `DMCadLoteCobranca`; `SetaDataset(edtCodigo, cdsLoteCobranca, 'CODLOTECOB', 'LOTE_COBRANCA')` (wira o master ao form-base: PK `CODLOTECOB`, tabela `LOTE_COBRANCA`); cria `ListaDetalhes := TList.Create` e **`ListaDetalhes.Add(cdsITENS_LOTECOB)`** — registra o detalhe para a cascata de gravação/exclusão | indireto (abre datasets) | cria datamodule; usa conn global | montagem do form + bind do recurso agregado |
| `FormClose` | `[.pas:L179-184]` | `inherited`; `FreeAndNil(DMCadLoteCobranca)` | — | libera datamodule | desmontagem/cleanup |
| `btnAddItenClick` | `[.pas:L86-130]` | **(o coração da tela)** monta `filtro` por empresa: se `EmpresaFECHAMENTO_CAIXA='S'` → `IDEMPRESA=<emp> AND CONSILIADO='S'`, senão só `IDEMPRESA=<emp>`; abre `frmPesquisa('GET_ARECEBER', …, filtro, cdsTempClonado)` com `ClonarDatasetCodigos=True` e **`HabilitaMultiselecao=True`**; após confirmar, **itera `cdsTempClonado`** e, para cada código **não** já presente (`cdsITENS_LOTECOB.Locate('CODRCB', …)`), faz `Append` + preenche **todas** as colunas de exibição (RAZAO, DTVENC, DTVENDA, VALOR, TXJUROS, **JURO**, **TOTAL**, CODRCB, DUPLICATA, CODPARCEIRO, ENDERECO, BAIRRO, CIDADE, UF, TELEFONE) a partir do picker + `Post` | **sim** (Q2 picker + abre Q1detalhe) | lê `dmPrincipal.Empresa*`; muta cds detalhe | `<AddTitulosModal>` (multi-seleção) + append com dedupe por `codrcb` |
| `btnExcluirItemClick` | `[.pas:L132-138]` | `inherited`; se `cdsITENS_LOTECOB` ativo e tem linhas → `cdsITENS_LOTECOB.Delete` (remove item corrente) | — | muta cds detalhe | ação "Remover" por linha (`remove(idx)` do field-array) |
| `btnLocFornecedorClick` | `[.pas:L140-148]` | `inherited`; abre `frmPesquisa('GET_PARCEIROS', edtCODFOR→CODIGO, edtRAZAO→RAZAO, 'FUN=''S''')` — busca **cobrador** (parceiro FUN='S'), devolve código e razão | **sim** (Q4 GET_PARCEIROS) | — | lookup do `<SelectField>` Cobrador (GET `cobranca/cobradores`) |
| `edtCODFORExit` | `[.pas:L150-161]` | `inherited`; `if not Continuar then Exit`; se `cdsPrincipal.Active` → **`SegFornecedor.Open(False)`** (valida o código digitado: existe parceiro com `CODPARCEIRO=<digitado>` e `FUN='S'`? senão erro "Fornecedor não encontrado…") | **sim** (Q3 SegFornecedor) | lê `dsBuscas` | `assertCobradorValido` (FUN='S') no submit/blur |
| `edtCODFORKeyUp` | `[.pas:L163-171]` | `inherited`; se `Key=VK_F3` → chama `btnLocFornecedorClick` | (indireto Q4) | — | F3 abre o lookup do cobrador |
| `edtDTVENCExit` | `[.pas:L173-177]` | `inherited`; `SetaFoco(btnAddIten)` — ao sair da Emissão, foco vai para "Adicionar" | — | move foco | Enter/Tab da Emissão foca o botão Adicionar |
| `RelatrioGeral1Click` | `[.pas:L211-221]` | `inherited`; carrega `Relatorios\lote_cobranca.fr3`, injeta logo, `imprimir(rptLoteCobranca)` | lê datasets do report | I/O arquivo (.fr3, logo) | export server-side (relatório geral) |
| `RelatrioAgrupadopor1Click` | `[.pas:L198-209]` | `inherited`; **`cdsITENS_LOTECOB.IndexFieldNames := 'BAIRRO;RAZAO'`** (ordena por bairro), carrega `lote_cobrancaBairro.fr3`, logo, imprime | — | I/O arquivo | export server-side (agrupado por bairro) |
| `ActionList1Update` | `[.pas:L74-84]` | `inherited`; habilita `btnExcluirItem` só se master ativo **e** em insert/edit **e** detalhe ativo com linhas; habilita `btnAddIten` só se master ativo **e** em insert/edit | — | — | enabled/disabled condicional dos botões do detalhe |
| `cdsITENS_LOTECOBNewRecord` (DM) | `[uDMCadLoteCobranca.pas:L76-79]` | ao **inserir** item: `cdsITENS_LOTECOBCODILOTCOB := dmPrincipal.GetID('CODILOTCOB')` — gera a **PK do item** app-side (sequence) | sim (GetID) | consome sequence | PK do item via sequence (`seq_ilotecob_codilotcob`) |
| `DataModuleCreate` (DM) | `[uDMCadLoteCobranca.pas:L81-84]` | `TFormata.AjustaData(Self)` — ajusta máscaras/formatos de data dos campos | — | — | formatação de data (DS/locale) |

> **Achados (a leitura "olhando a tela" perderia):**
> 1. **O detalhe é montado por código no `btnAddItenClick`, não por digitação no grid.** O grid é `ReadOnly`; o operador **só** adiciona via picker multi-seleção e remove via botão. Todas as colunas de exibição (inclusive **JURO/TOTAL já calculados**) são **copiadas do picker** (`cdsTempClonado`) para o cds do detalhe no append `[.pas:L110-124]` — o picker (`GET_ARECEBER`) já traz os campos calculados. Ou seja: **o juro/total mostrado vem do picker no append e da view no read** — duas fontes da **mesma** fórmula (Q2 e Q1detalhe), que **precisam bater** (paridade).
> 2. **Dedupe por `CODRCB` no append** `[.pas:L107]`: `if not cdsITENS_LOTECOB.Locate('CODRCB', …)` — um título já no lote **não** é re-adicionado. Replicado no alvo (`onConfirmar` faz `Set(jaSelecionados)`).
> 3. **PK do item por `GetID('CODILOTCOB')`** `[uDMCadLoteCobranca.pas:L78]` — sequence app-side (não trigger). No alvo: `seq_ilotecob_codilotcob`.
> 4. **Filtro do picker depende de `FECHAMENTO_CAIXA`** `[.pas:L91-95]` — regra escondida: só quando a empresa está em fechamento de caixa o picker exige `CONSILIADO='S'`. Ver [BR-05](#5-regras-de-negócio).
> 5. **`SegFornecedor.Open(False)` no `edtCODFORExit`** valida o cobrador digitado (FUN='S') **antes** de prosseguir — é a checagem que o alvo replica em `assertCobradorValido` (Q3, BR-02).
> 6. **Não há `btnGravarClick`/`btnExcluirClick` próprios** — a gravação do agregado (header+itens, cascata) é 100% `inherited` de `TfrmCadMasterDet` (nested datasets → provider único → uma transação) ([form-base §5b](../../03-legacy-analysis/recon/form-base-cadmaster.md)).

---

## 4. Dados — TODA query

### Q1 — `sqqLoteCobranca` (MASTER: leitura de 1 lote por código) — `[.dfm SQL.Strings]`
- **Origem:** `retaguarda-master/fonte/DmOld/uDMCadLoteCobranca.dfm` `[.dfm:L6-46]` — `TSQLQuery sqqLoteCobranca`, `SQLConnection = dmPrincipal.Conexao` (global), via `dspLoteCobranca` (`TDataSetProvider`) → `cdsLoteCobranca` (`TClientDataSet`).
- **Quando dispara:** ao abrir/editar um lote pelo código (via `SetaDataset`/`AbreDataset` do form-base, param `CODIGO`).
- **SQL base (Oracle, verbatim do `.dfm`):**
  ```sql
  SELECT
    L.CODLOTECOB,
    L.CODPARCEIRO,
    L.DATA,
    P.RAZAO
  FROM LOTE_COBRANCA L
  LEFT JOIN PARCEIROS P ON (P.CODPARCEIRO = L.CODPARCEIRO)
  WHERE L.CODLOTECOB =:CODIGO
  ```
- **Params:** `:CODIGO` (`ftInteger`, `ptInput`) — origem: `edtCodigo` / chave da pesquisa. `[.dfm:L8-13]`
- **Fragmentos condicionais:** nenhum (estática pura). **Achado-chave:** `RAZAO` vem por **LEFT JOIN PARCEIROS** e tem `ProviderFlags=[]` `[.dfm:L41-45]` → é **só exibição, NÃO armazenada** em `LOTE_COBRANCA` (a tabela master só guarda `CODLOTECOB`, `CODPARCEIRO`, `DATA`). Confirma `[Oracle-dict]`.
- **Campos/ProviderFlags (definem a DML do provider do master):** `[.dfm:L26-45]`
  | Campo | Tipo | ProviderFlags | Required |
  |---|---|---|---|
  | `CODLOTECOB` | `TIntegerField` | `pfInUpdate, pfInWhere, pfInKey` | True |
  | `CODPARCEIRO` | `TIntegerField` | `pfInUpdate` | True |
  | `DATA` | `TSQLTimeStampField` | `pfInUpdate` | True |
  | `RAZAO` | `TStringField` (Size 150) | `[]` (não persiste) | — |
- **Mutações:** leitura (Q1) + escrita do master (INSERT/UPDATE/DELETE via provider, cascata pelo `TfrmCadMasterDet`).
- **PK `CODLOTECOB` por SEQUENCE app-side** `[Oracle-dict]`: PK gerada por sequence (mesmo padrão das demais herdeiras; no detalhe é `GetID('CODILOTCOB')`). → No alvo: `seq_lotecob_codlotecob` / `nextval`.
- **SQL-alvo (Postgres, Kysely):** `get_lote_cobranca` (view) já faz `LEFT JOIN parceiros` p/ expor `razao` + `qtd_itens` (migration 016). Oracle→PG: `(+)` já era `LEFT JOIN`; `NUMBER`→`integer`, `TIMESTAMP`→`timestamptz`, `VARCHAR2(150)`→`varchar(150)`. `read`/`readEnriched` no repositório (`lote-cobranca.repository.ts:L29-68`).

### Q1detalhe — `sqqITENS_LOTECOB` (DETALHE: itens do lote + juros/total) — `[.dfm SQL.Strings]` — ⚠️ **a query crítica**
- **Origem:** `uDMCadLoteCobranca.dfm` `[.dfm:L92-145]` — `TSQLQuery sqqITENS_LOTECOB`, `DataSource = dtsLoteCobranca` (master-detalhe), via nested dataset `cdsLoteCobrancasqqITENS_LOTECOB` (`TDataSetField`) → `cdsITENS_LOTECOB`.
- **Quando dispara:** quando o master carrega (nested dataset abre junto com `cdsLoteCobranca`), param `CODLOTECOB`.
- **SQL base (Oracle, verbatim do `.dfm`):**
  ```sql
  SELECT
      I.CODLOTECOB,  I.CODRCB, I.CODILOTCOB,
      P.CODPARCEIRO, P.RAZAO,
      R.DTVENDA, R.DTVENC, R.DUPLICATA, R.VALOR, R.TXJUROS,
     CAST(
       CASE WHEN(CURRENT_DATE - TRUNC(R.DTVENC)) < P.TOLERANCIA THEN 0
            ELSE
            CAST((COALESCE((R.TXJUROS / CAST(30 AS NUMERIC(13, 8))) *
                 (CAST(CASE WHEN(CURRENT_DATE -CAST(R.DTVENC AS DATE)) < 0 THEN 0 ELSE (CURRENT_DATE -TRUNC(R.DTVENC)) END AS INTEGER)) *
                 (R.VALOR) / 100, 0)) AS NUMERIC(13, 2))
       END AS DECIMAL(13,2)) JUROS,

     CAST(
       CASE WHEN(CURRENT_DATE -TRUNC(R.DTVENC)) < P.TOLERANCIA THEN R.VALOR ELSE
           ((
            COALESCE((R.TXJUROS / CAST(30 AS NUMERIC(13, 8))), 0) *
            COALESCE((CAST(CASE WHEN(CURRENT_DATE -CAST(R.DTVENC AS DATE)) < 0 THEN 0
                             ELSE (CURRENT_DATE -CAST(R.DTVENC AS DATE))
                           END AS INTEGER)) * (R.VALOR) / 100, 0))  +
            R.VALOR) END
     AS NUMERIC(13, 2)) TOTAL,
      E.ENDERECO, E.BAIRRO, E.CIDADE, E.UF, E.TELEFONE
  FROM ITENS_LOTECOB I
  LEFT JOIN ARECEBER R ON (R.CODRCB = I.CODRCB)
  LEFT JOIN PARCEIROS P ON (P.CODPARCEIRO = R.CODPARCEIRO)
  LEFT JOIN PARCEIROS_END E ON (E.CODEND = P.CODEND)
  WHERE I.CODLOTECOB =:CODLOTECOB
  ```
- **Params:** `:CODLOTECOB` (`ftInteger`, `ptInput`). `[.dfm:L95-100]`
- **Fragmentos condicionais:** nenhum na SELECT (estática), **mas a fórmula É um condicional financeiro** (o `CASE` da carência) — ver [BR-01](#5-regras-de-negócio).
- **Achado-chave (procedência das colunas) `[Oracle-dict]`:** de `ITENS_LOTECOB` só vêm `CODLOTECOB`, `CODRCB`, `CODILOTCOB` — **`CODRCB` é a única coluna de negócio STORED do item** (FK→ARECEBER); `CODILOTCOB` é a PK (sequence); `CODLOTECOB` é a FK ao master. **Todo o resto** (`DUPLICATA`, `DTVENDA/DTVENC`, `VALOR`, `TXJUROS`, `CODPARCEIRO/RAZAO`, `ENDERECO/BAIRRO/CIDADE/UF/TELEFONE`, e os calculados `JUROS/TOTAL`) é **LIVE-JOIN** de `ARECEBER → PARCEIROS → PARCEIROS_END`. **Nenhuma** dessas colunas tem `pfInUpdate` no cds de detalhe (só `CODILOTCOB`/`CODLOTECOB`/`CODRCB` têm) `[.dfm:L240-256]` — confirma que o item persiste **apenas** `codrcb`.
- **Fórmula JUROS/TOTAL (transcrita verbatim) `[inferido — runtime golden PENDENTE]`:**
  - `atraso = CURRENT_DATE − DTVENC::date`
  - **se** `atraso < TOLERANCIA` (carência do cliente) ⇒ `JUROS = 0`, `TOTAL = VALOR`
  - **senão** ⇒ `JUROS = (TXJUROS/30) * GREATEST(0, atraso) * VALOR / 100`; `TOTAL = VALOR + JUROS`
  - Notas fiéis: carência é **estritamente `<`** (atraso menor que tolerância zera o juro); o nº de dias é **re-clampado a ≥0** com `GREATEST(0,…)` (no Oracle, `CASE WHEN … < 0 THEN 0`); `30` é divisor fixo (juro proporcional ao mês de 30 dias); arredondamento `NUMERIC(13,2)`.
  - **⚠️ Risco-coroa:** a transcrição Oracle→PG troca `TRUNC(R.DTVENC)`/`CAST(R.DTVENC AS DATE)` por `r.dtvenc::date` e `CURRENT_DATE`; a fórmula depende de **`CURRENT_DATE`** (volátil — o mesmo lote dá juros diferentes amanhã). **Precisa de golden RUNTIME** com data fixada para certificar 1-centavo (ver [Casos de teste](#9-casos-de-teste-golden)).
- **Mutações:** leitura. A escrita do detalhe é só `INSERT/DELETE` de `ITENS_LOTECOB(CODILOTCOB, CODLOTECOB, CODRCB)` (provider, via nested dataset).
- **Tabelas tocadas:** `ITENS_LOTECOB` (CRUD do item), `ARECEBER`/`PARCEIROS`/`PARCEIROS_END` (LEFT JOIN, só leitura). Estrutura `[Oracle-dict]`: `ARECEBER(codrcb PK, codparceiro, **CODEMPRESA** ⚠️não IDEMPRESA, dtvenda, dtvenc, duplicata varchar(20), valor numeric(13,2), txjuros numeric(13,2), consiliado char(1))`; `PARCEIROS(codparceiro, razao varchar(150), FUN char(1), TOLERANCIA int, codend)`; `PARCEIROS_END(codend, endereco(150), bairro(50), cidade(60), uf char(2), telefone(20))`.
- **SQL-alvo (Postgres):** view `get_itens_lotecob` (migration 016) = **transcrição literal** da SELECT acima; lida por `readEnriched` (`lote-cobranca.repository.ts:L52-68`). Oracle→PG: `TRUNC(DTVENC)`/`CAST(… AS DATE)`→`dtvenc::date`, `CAST(30 AS NUMERIC(13,8))`→`30.0`, `CASE … <0 THEN 0`→`GREATEST(0,…)`, `(+)`→`LEFT JOIN`.

### Q2 — Picker `GET_ARECEBER` (btnAddIten → frmPesquisa multi-seleção) — `[.pas:L97 montada]`
- **Origem:** `UCadLoteCobranca.pas` `btnAddItenClick` `[.pas:L86-130]` abre `frmPesquisa('GET_ARECEBER', …, filtro, cdsTempClonado)` com `ClonarDatasetCodigos=True` e `HabilitaMultiselecao=True` sobre a **VIEW `GET_ARECEBER`** (documentos a receber).
- **Quando dispara:** clique em `btnAddIten` (só habilitado em insert/edit do master, `ActionList1Update`).
- **SQL base + fragmentos condicionais (TODOS os caminhos) `[.pas:L91-95]`:** a SQL base do `frmPesquisa` é `SELECT … FROM GET_ARECEBER WHERE <filtro>`; o **filtro** é montado em runtime:
  | Condição (`.pas`) | Fragmento (WHERE) |
  |---|---|
  | sempre | `IDEMPRESA = <dmPrincipal.EmpresaCODEMPRESA>` |
  | `if EmpresaFECHAMENTO_CAIXA = 'S'` | `+ AND CONSILIADO = 'S'` |
  | senão | (sem o filtro de conciliado) |
- **Params:** empresa (`dmPrincipal.EmpresaCODEMPRESA`), `FECHAMENTO_CAIXA` (flag de sessão da empresa). **Multi-seleção** devolve N linhas em `cdsTempClonado` (campos `CODIGO`, `CLIENTE`, `DATA_VENCIMENTO`, `DATA_VENDA`, `VALOR`, `TXJUROS`, **`JURO`**, **`TOTAL`**, `DUPLICATA`, `CODIGO_CLIENTE`, `ENDERECO_COBRANCA`, `BAIRRO_COBRANCA`, `CIDADE_COBRANCA`, `UF_COBRANCA`, `TELEFONE`) `[.pas:L110-124]`.
- **Achado-chave `[Oracle-dict]`:** o filtro usa o alias **`IDEMPRESA`** da view, mas a coluna física de `ARECEBER` é **`CODEMPRESA`** (≠ IDEMPRESA) — a view `GET_ARECEBER` expõe o nome `IDEMPRESA`/escopo da empresa. A view também **calcula `JURO`/`TOTAL` pela MESMA fórmula** do detalhe (carência por `TOLERANCIA`) — por isso o append copia `JURO`/`TOTAL` prontos.
- **Mutações:** leitura.
- **SQL-alvo (Postgres):** view `get_areceber` (migration 015) com `JURO`/`TOTAL`/`DIAS_ATRAZO`/`DIAS_TOLERANCIA` calculados (mesma fórmula); endpoint `GET /cobranca/areceber` (`lotes-cobranca.controller.ts:L31-40`) **sempre** escopado por empresa do contexto (fail-closed: sem `empresaId` → 403, `lote-cobranca.repository.ts:L105-119`), filtra `consiliado` quando passado, e remove os `codrcb` já no lote (`excluirDoLote`). **Diferença consciente:** o legado filtra `CONSILIADO='S'` só em fechamento de caixa; o alvo recebe `consiliado` como query param (o front passa `'S'` por padrão no `AddTitulosModal.tsx:L37`) — **lacuna**: a decisão "só em fechamento de caixa" não está no servidor (ver [Divergências](#paridade-com-o-novo)).

### Q3 — `SegFornecedor` (valida o Cobrador digitado, FUN='S') — `[.dfm InputParams]` + `[.pas:L158]`
- **Origem:** `TSearchEngineApollo SegFornecedor` `[.dfm:L563-603]`, disparado por `SegFornecedor.Open(False)` no `edtCODFORExit` `[.pas:L158]`.
- **Quando dispara:** ao sair do `edtCODFOR` (código do cobrador digitado).
- **SQL reconstruída (do `InputParams`/`OutputParams`):**
  ```sql
  SELECT RAZAO FROM PARCEIROS
  WHERE CODPARCEIRO = :edtCODFOR   -- InputParam itEqual
    AND FUN = 'S'                  -- InputParam Value='S' itEqual
  ```
  `OutputParams`: `RAZAO → edtRAZAO`. `ErrorMessage = 'Fornecedor não encontrado com o código informado. Verifique!'`, `MsgType=mtError` `[.dfm:L596-600]`.
- **Params:** `:CODPARCEIRO` (= `edtCODFOR`, `ftInteger`); `FUN='S'` (literal). `Required=False` nos dois (não obriga, mas se digitado tem de existir).
- **Mutações:** leitura/validação. Se não acha → mensagem de erro (não cancela explicitamente no `.pas`, mas o `SearchEngine` mostra `mtError`).
- **SQL-alvo (Postgres):** `assertCobradorValido(codparceiro)` (`lote-cobranca.repository.ts:L75-84`): `SELECT codparceiro FROM parceiros WHERE codparceiro=$1 AND fun='S'`; se vazio → `BusinessRuleError('FORNECEDOR_NAO_ENCONTRADO')` (envelope ADR-015, **nunca 500**). Chamado no `criar`/`atualizar` do controller (`lotes-md.controller.ts:L68,79`).

### Q4 — Picker `GET_PARCEIROS` (lookup do Cobrador, F3/lupa) — `[.pas:L143 montada]`
- **Origem:** `btnLocFornecedorClick` `[.pas:L140-148]` abre `frmPesquisa('GET_PARCEIROS', edtCODFOR→'CODIGO', edtRAZAO→'RAZAO', 'FUN=''S''')`.
- **Quando dispara:** clique na lupa (`btnLocFornecedor`) ou **F3** no `edtCODFOR` (`edtCODFORKeyUp`).
- **SQL base:** `SELECT … FROM GET_PARCEIROS WHERE FUN = 'S'` — devolve `CODIGO`→`edtCODFOR`, `RAZAO`→`edtRAZAO`.
- **Params:** filtro literal `FUN='S'`.
- **Mutações:** leitura.
- **SQL-alvo (Postgres):** `listCobradores()` (`lote-cobranca.repository.ts:L90-97`): `SELECT codparceiro, razao FROM parceiros WHERE fun='S' ORDER BY razao`; endpoint `GET /cobranca/cobradores` (`lotes-cobranca.controller.ts:L43-45`) alimenta o `<SelectField>` Cobrador (`useResourceOptions('cobranca/cobradores', …)`, `LotesCobrancaCadMaster.tsx:L34`).

### Q5 — Listagem/pesquisa do master (`frmPesquisa` sobre `GET_LOTE_COBRANCA`) — `[inferido]` (herdado do form-base)
- **Origem:** `TfrmCadMaster.btnPesquisaClick` (herdado) abre `frmPesquisa` sobre a view de listagem do master.
- **SQL-alvo (Postgres):** view `get_lote_cobranca` (migration 016) = `LOTE_COBRANCA L LEFT JOIN PARCEIROS P` expondo `codlotecob, codparceiro, data, razao, qtd_itens`. Endpoint `GET /cobranca/lotes-md` (`lotes-md.controller.ts:L41-57`) via `AggregateEngineService.list`. `[inferido]` — não capturado em runtime para esta tela; herda a forma do form-base.

> **Regra de ouro:** Q1/Q1detalhe/Q3/Q4 são **estáticas e confiáveis** (sementes do `.dfm`/`.pas`). O **valor financeiro** (JUROS/TOTAL — a fórmula de Q1detalhe e Q2) está **transcrito verbatim** mas **NÃO foi visto rodando** (depende de `CURRENT_DATE`): é a pendência-coroa. O **pipeline de escrita do agregado** (nested dataset → provider único → 1 transação; cascata em código) é `[inferido]` do contrato `TfrmCadMasterDet` ([§5b](../../03-legacy-analysis/recon/form-base-cadmaster.md)) — implementado e **verde no smoke do agregado**, mas sem captura V$SQL. ✅ **Confirmado `[Oracle-dict]`** (não inferido): que só `CODRCB` é stored no item; `ARECEBER.CODEMPRESA` (≠ IDEMPRESA); estrutura de PARCEIROS/PARCEIROS_END/ARECEBER; `RAZAO` do master é live-join (não armazenado); a fórmula de juros (transcrita).

---

## 5. Regras de negócio

| ID | Regra | Gatilho | Lógica (verbatim do legado) | *Porquê* | Procedência |
|---|---|---|---|---|---|
| BR-01 | **Cálculo de JUROS/TOTAL por carência** | leitura do detalhe/picker | `atraso = CURRENT_DATE − DTVENC::date`. Se `atraso < PARCEIROS.TOLERANCIA` ⇒ `JUROS=0`, `TOTAL=VALOR`. Senão `JUROS = (TXJUROS/30) * GREATEST(0,atraso) * VALOR/100`, `TOTAL = VALOR + JUROS`. Carência **estritamente `<`**; dias re-clampados a ≥0; divisor fixo 30; `NUMERIC(13,2)` | juro de mora proporcional ao atraso, **com carência** (tolerância do cliente) — define quanto o cobrador efetivamente recebe; é dinheiro | `[.dfm sqqITENS_LOTECOB:L106-139]` + `[Oracle-dict TOLERANCIA]` · **needs runtime golden** |
| BR-02 | **Cobrador deve ser PARCEIRO FUN='S'** | sair do `edtCODFOR` / gravar | `SegFornecedor`: `SELECT RAZAO FROM PARCEIROS WHERE CODPARCEIRO=:cod AND FUN='S'`; não achou → erro `'Fornecedor não encontrado…'` | o "Cobrador" do lote é um fornecedor/cobrador (FUN='S'), não um cliente — integridade do papel | `[.dfm SegFornecedor:L563-603]` + `[.pas:L158]` |
| BR-03 | **Emissão (DATA) default = hoje** | novo registro | `edtDTVENC.DefaultToday = True` `[.dfm:L165]` — campo `DATA` inicia com a data corrente | conveniência: a emissão do lote é quase sempre o dia da montagem | `[.dfm:L165]` |
| BR-04 | **Dedupe de título por CODRCB no lote** | adicionar item | `if not cdsITENS_LOTECOB.Locate('CODRCB', <cod>, [])` antes do `Append` — título já no lote **não** é re-adicionado | um mesmo documento não pode entrar duas vezes no mesmo lote (cobraria em dobro) | `[.pas:L107]` |
| BR-05 | **Filtro do picker por empresa (+ conciliado em fechamento de caixa)** | abrir picker (`btnAddIten`) | `filtro := 'IDEMPRESA='+emp`; **se** `EmpresaFECHAMENTO_CAIXA='S'` ⇒ `+ ' AND CONSILIADO=''S'''` | só títulos da empresa corrente; durante **fechamento de caixa**, só documentos **conciliados** (consistência financeira do fechamento) | `[.pas:L91-95]` + `[Oracle-dict CODEMPRESA/CONSILIADO]` |
| BR-06 | **PK do item por sequence app-side** | inserir item | `cdsITENS_LOTECOBNewRecord`: `CODILOTCOB := dmPrincipal.GetID('CODILOTCOB')` | identidade estável do item gerada pelo app (não trigger) | `[uDMCadLoteCobranca.pas:L78]` |
| BR-07 | **Save em agregado / exclusão em cascata** | gravar / excluir lote | `TfrmCadMasterDet`: master + itens via **nested dataset → provider único → 1 transação**; excluir percorre `ListaDetalhes` e apaga itens, depois o master (cascata em código, não FK) | atomicidade: header e itens nascem/morrem juntos; lote sem itens órfãos | `[.pas:L193-194 ListaDetalhes]` + `[form-base §5b]` |
| BR-08 | **RAZAO do master não é armazenada** | leitura master | `sqqLoteCobrancaRAZAO` `ProviderFlags=[]` (LEFT JOIN PARCEIROS) | normalização: a razão é do parceiro, não do lote — evita dado duplicado/defasado | `[.dfm:L41-45]` + `[Oracle-dict]` |
| BR-09 | **Botões do detalhe condicionais ao estado do master** | sempre (`ActionList1Update`) | `btnAddIten`/`btnExcluirItem` só habilitados se master `Active` e em `dsInsert/dsEdit`; Excluir exige detalhe com linhas | não adicionar/remover item fora de edição do lote | `[.pas:L74-84]` |

Para o **cálculo BR-01**, a ordem de operações importa (financeiro): `(TXJUROS/30)` primeiro (taxa diária), depois `* dias_atraso`, depois `* VALOR/100`, e só então `+ VALOR` no total; `COALESCE(…,0)` protege nulos; o `CAST … NUMERIC(13,2)` arredonda **no fim**. Qualquer reordenação ou arredondamento intermediário pode mexer 1 centavo — **reprova paridade**.

> BR-01 e BR-05 dependem de **estado de sessão** (`dmPrincipal.Empresa*`, `FECHAMENTO_CAIXA`) — ver [Efeitos colaterais + estado externo](#6-efeitos-colaterais--estado-externo). BR-01 depende de `CURRENT_DATE` (volátil): o golden tem de fixar a data.

---

## 6. Efeitos colaterais + estado externo

> A seção que salva da armadilha de acoplamento. Aqui o acoplamento crítico é **a empresa/fechamento-de-caixa da sessão** filtrando o picker, e **a data corrente** dentro do cálculo.

| Item | Tipo (lê/grava) | Alvo | Quem setou / quem consome | Mapeamento alvo |
|---|---|---|---|---|
| `dmPrincipal.Conexao` | usa | conexão Oracle **global** | datamodule principal (boot) | conexão **por tenant** request-scoped ([hidden-coupling-traps](../../03-legacy-analysis/hidden-coupling-traps.md)) |
| `dmPrincipal.EmpresaCODEMPRESA` | **lê** | empresa da sessão | login/seleção de empresa | `currentTenant().empresaId` (fail-closed: sem ele → 403, `lote-cobranca.repository.ts:L107`) |
| `dmPrincipal.EmpresaFECHAMENTO_CAIXA` | **lê** | flag de fechamento de caixa | turno/caixa | **lacuna no alvo:** hoje `consiliado` vem como query param do front; a decisão "só em fechamento" não está no servidor |
| `dmPrincipal.OperadorCODOPERADOR` | lê | operador logado | login | `currentTenant().operadorId` (carimbo de auditoria, `repository.ts:L123,133`) |
| `dmPrincipal.PossuiAcessoForm` | lê | RBAC | tabela `PERMISSOES` | guard `@RequerAcesso('FRMCADLOTECOBRANCA', 'BTNGRAVAR'/'BTNEXCLUIR')` (`lotes-md.controller.ts`) |
| `dmPrincipal.GetID('CODILOTCOB')` | grava (consome) | sequence app-side | datamodule | `seq_ilotecob_codilotcob` (migration 005) |
| `CURRENT_DATE` (no cálculo) | lê | relógio do banco | — | `CURRENT_DATE` na view (volátil — golden precisa fixar) |
| `USULTALTERACAO`/`DTULTIMALTERACAO`/`DTCADASTRO` | grava | colunas de `LOTE_COBRANCA` | `SetaOperadorAlteracao` (form-base) | carimbo no `create`/`update` do repositório (`repository.ts:L123-135,149-157`) |
| `LOTE_COBRANCA` / `ITENS_LOTECOB` | grava | tabelas (CRUD) | provider único (nested) | transação escopada (Kysely `transaction()`) |
| Relatórios FastReport (`.fr3`, logo) | lê (I/O arquivo) | disco (`DirAplicacao\Relatorios`, `\images\logorel.jpg`) | clique em "Outros" | export server-side / templating |
| **trigger `REM_*`** | **N/A — assumido NÃO replicado** | — | — | `replica: false` no `loteCobrancaAggregateConfig` (`lote-cobranca.aggregate.ts:L17`) — **confirmar em runtime** se LOTE_COBRANCA/ITENS_LOTECOB têm `REM_*` |
| `HISTORICO_DINAMICO` / `MENUEXPRESS` / `TLog.GravaLog` | grava (indireto) | histórico/telemetria/log | `btnGravarClick` herdado | engine `historico`/audit log `[inferido]` |

- **Conexão/transação:** usa a conexão **global** do `dmPrincipal`; o agregado (header+itens) é aplicado pelo provider único em **uma** transação. No alvo: `dbp.forTenant().transaction()` escopa ao caso de uso (`repository.ts:L124,149,170`).
- **Ordem de abertura assumida:** presume login feito (empresa/operador/permissões em `dmPrincipal`) **e** que a flag `FECHAMENTO_CAIXA` da empresa esteja resolvida (BR-05). Precondições a virarem contexto explícito.

> **A diferença que mais importa: o picker é escopado por EMPRESA da sessão.** O legado injeta `IDEMPRESA=<EmpresaCODEMPRESA>` em todo `GET_ARECEBER`; o alvo torna isso **fail-closed** (sem `empresaId` no tenant context → `UnauthorizedTenantError`/403, nunca devolve títulos de outra empresa). A coluna física é **`CODEMPRESA`** (não IDEMPRESA) `[Oracle-dict]` — a migration 015 deixou isso explícito. A flag `FECHAMENTO_CAIXA` (que liga o filtro `CONSILIADO='S'`) é a **lacuna** mapeada: hoje vive no front como `consiliado='S'` default, não como decisão de sessão no servidor.

---

## 7. Dependências

| Dependência | Tipo | Como é usada | Vira (alvo) |
|---|---|---|---|
| `TfrmCadMasterDet` (`uCadMasterDet.pas`) | **herança** | CRUD de **agregado**: ListaDetalhes, gravação header+itens em 1 transação (nested dataset), exclusão em cascata em código, validação que cascateia | **`AggregateEngineService`** + `AggregateConfig` ([form-base §5b](../../03-legacy-analysis/recon/form-base-cadmaster.md), ADR-014) |
| `TfrmCadMaster` (`uCadMaster.pas`) | herança (avô) | gravar/editar/excluir/pesquisar/navegar, RBAC, carimbo, histórico, log, teclado | engine CRUD base |
| `TDMCadLoteCobranca` (`uDMCadLoteCobranca`) | datamodule | `sqqLoteCobranca`/`sqqITENS_LOTECOB` (master+detalhe, juros), nested dataset, `OnNewRecord` (PK item) | `LoteCobrancaRepository` + views `get_*` (sem estado) |
| `udmPrincipal` (`dmPrincipal`) | datamodule global | conexão, empresa/operador, RBAC, `GetID`, `ShowPesquisa`, `FECHAMENTO_CAIXA` | tenant context + providers |
| `uPesquisa` (`TfrmPesquisa`) | form modal | picker de `GET_ARECEBER` (multi-seleção) e `GET_PARCEIROS` (lookup cobrador) | `<AddTitulosModal>` (multi-seleção) + `<SelectField>` lookup |
| `TSearchEngineApollo` (`SegFornecedor`) | componente | valida o cobrador digitado (FUN='S') | `assertCobradorValido` (repo) |
| `ARECEBER` / `PARCEIROS` / `PARCEIROS_END` | tabelas | live-join do grid de itens + juros/total + endereço de cobrança | migrations 014/015 + views 015/016 |
| `frxReport`/`frxDBDataset` (FastReport) | libs | relatório geral e agrupado por bairro | export server-side (pendente) |

> Diferente das telas de tabela única, esta herda **dois níveis** (`TfrmCadMaster → TfrmCadMasterDet`). A `ListaDetalhes.Add(cdsITENS_LOTECOB)` no `FormCreate` é o que "liga" o detalhe à máquina de agregado do form-base — no alvo, equivale ao `detalhes:[{ tabela:'itens_lotecob', fk:'codlotecob', colunas:['codrcb'], chave:'itens' }]` do `AggregateConfig` (`lote-cobranca.aggregate.ts:L18-20`).

---

## 8. TabOrder + mapa de atalhos/mnemônicos

**TabOrder (controles próprios, sequência exata `[.dfm]`):**

| Ordem | Controle | Campo | Tipo | TabOrder |
|---|---|---|---|---|
| 0 | `edtCODFOR` | CODPARCEIRO (Cobrador) | TDBEdit | `TabOrder=0` `[.dfm:L53]` |
| 1 | `btnLocFornecedor` | (lupa) | TBitBtn | `TabOrder=1` (`TabStop=False`) `[.dfm:L138]` |
| 2 | `edtRAZAO` | RAZAO (read-only) | TJvDBMaskEdit | `TabOrder=2` (`TabStop=False`) `[.dfm:L155]` |
| 3 | `edtDTVENC` | DATA (Emissão) | TJvDBDateEdit | `TabOrder=3` `[.dfm:L173]` |
| 4 | `pnlItens` | (área detalhe) | TPanel | `TabOrder=4` `[.dfm:L218]` → dentro: `pnlCab`(0) com `btnAddIten`(0)/`btnExcluirItem`(1), `DbGridDados`(1) |

> Foco inicial: `edtCodigo` (código do lote, herdado), depois `edtCODFOR`. **Foco programático:** ao sair de `edtDTVENC` (Emissão), o foco vai direto para **`btnAddIten`** (`edtDTVENCExit` → `SetaFoco(btnAddIten)` `[.pas:L176]`) — o fluxo "preencheu cabeçalho → adicione títulos". Replicar essa transição de foco (ADR-010).

**Mnemônicos `&` (Alt+letra) `[.dfm]`:**

| Controle | Caption | Letra | Papel | `FocusControl` |
|---|---|---|---|---|
| `lblCODFOR` | `Cobrador` | — (sem `&`) | focus | `edtCODFOR` |
| `Label14` | `Emissão` | — (sem `&`) | focus | `edtDTVENC` |
| `btnAddIten` | `&Adicionar` | A | action | — |
| `btnExcluirItem` | `E&xcluir` | X | action | — |

> Labels do master **sem `&`** (como nas demais herdeiras). Os mnemônicos dos botões de detalhe (`&Adicionar`/`E&xcluir`) **colidem** com os do rodapé herdado (`&Adicionar`/`E&xcluir` do master) — no Delphi resolve-se por escopo de foco/painel. No alvo, separar escopos (botões do detalhe vs. ação do master). Botões herdados do rodapé: `&Gravar`(Alt+G), `&Editar`(Alt+E), `&Adicionar`(Alt+A), `&Sair`/`&Cancelar`, `&Outros`(Alt+O) ([form-base §4](../../03-legacy-analysis/recon/form-base-cadmaster.md)).

**Atalhos (F-keys / Enter / Esc):**

| Atalho | Ação | Origem | Escopo | Reservado pelo browser? |
|---|---|---|---|---|
| **F3** | abre lookup do Cobrador (`btnLocFornecedorClick`) | `edtCODFORKeyUp` `[.pas:L167]` | campo `edtCODFOR` | não |
| **Alt+O** | abre "Outros" → Relatório Geral / Agrupado por Bairro | herdado (`ppmBotaoOutros`) | tela | não |
| **F6** | cicla filtro ativo | herdado | tela | não (N/A — sem `INDR`) |
| **← / → / ↑ / ↓** em `edtCodigo` | navegação de registro | herdado | campo-código | não |
| **Enter** em `edtCodigo` | carrega pelo código | herdado | campo-código | não |
| **Esc** | protegida durante edição | herdado | tela | não |

> **F3** (lookup do cobrador) é o atalho próprio desta tela — não reservado pelo Chromium ⇒ replicável no browser. No alvo, vive no escopo do `<SelectField>` Cobrador. Mapa herdado é o output do extrator de `.dfm`.

---

## 9. Casos de teste (golden) — capturados do legado

> ⚠️ **Sem golden de RUNTIME certificado do legado.** Os casos G-01..G-05 abaixo são **resultados do NOVO** (smoke do agregado, hoje **verde** — `apps/api/scripts/smoke.ts:L176-226`), provando a construção fiel do master-detalhe. O **golden RUNTIME do legado** — em especial **JUROS/TOTAL exatos** (BR-01, depende de `CURRENT_DATE` + `TOLERANCIA`) — está **PENDENTE**: precisa de captura V$SQL com data fixada. Verde do novo ≠ paridade certificada do valor financeiro.

| ID | Cobre (BR/Q) | Input (estado + campos) | Ação | Output (smoke do NOVO) | SQL real observada |
|---|---|---|---|---|---|
| G-01 | BR-07 (agregado) + Q1/Q1detalhe | header (codparceiro válido + data) + 2 itens (codrcb) | `POST /cobranca/lotes-md` | **201**; `itens.length === 2` | insert header + 2× insert item (1 transação) |
| G-02 | BR-01 (juros) + Q1detalhe enriquecido | lote criado em G-01 | `GET /cobranca/lotes-md/:id` | itens com **colunas de exibição** (duplicata/valor/**juros**/**total**) + `razao` do cobrador | `get_itens_lotecob` (live-join + juros/total) + `get_lote_cobranca` (JOIN parceiros) |
| G-03 | BR-05 (picker empresa) + Q2 | empresa do contexto (x-empresa-id=1) | `GET /cobranca/areceber` | **200**; lista títulos da empresa (>0) | `get_areceber WHERE codempresa=1` |
| G-03b | BR-02 (lookup) + Q4 | — | `GET /cobranca/cobradores` | só `FUN='S'` (com `razao`) | `parceiros WHERE fun='S'` |
| G-04 | BR-02 (cobrador inválido) | `codparceiro` de CLIENTE (FUN='N') | `POST /cobranca/lotes-md` | erro **PT** (status ajustado, **nunca 500**) → `FORNECEDOR_NAO_ENCONTRADO` | `assertCobradorValido` → 0 linhas |
| G-05 | BR-07 (cascata) | lote de G-01 | `DELETE /cobranca/lotes-md/:id` → `GET :id` | **204**; depois 404/vazio (itens+header apagados) | delete itens + delete header (1 transação) |

**Caminhos / regras a CAPTURAR para certificar (runtime golden — pendência-coroa):**
- **G-06 (BR-01 valor exato) — PENDENTE:** fixar data (ex.: `CURRENT_DATE=2026-06-25`), `ARECEBER` com `DTVENC` vencido e a vencer, `PARCEIROS.TOLERANCIA` variado (0, 3, 5). Capturar `JUROS`/`TOTAL` **verbatim do ERP** para cada caso: (a) atraso < tolerância ⇒ juros 0, total=valor; (b) atraso ≥ tolerância ⇒ `(txjuros/30)*atraso*valor/100`; (c) atraso negativo (a vencer) ⇒ juros 0. Comparar 1-centavo com `get_itens_lotecob`/`get_areceber`. **Risco financeiro: divergência reprova.**
- **G-07 (BR-04 dedupe) — PENDENTE:** adicionar o mesmo `CODRCB` duas vezes ⇒ entra **uma** vez.
- **G-08 (BR-05 fechamento de caixa) — PENDENTE:** com `FECHAMENTO_CAIXA='S'`, o picker só traz `CONSILIADO='S'`; sem fechamento, traz todos da empresa.
- **G-09 (replicação) — PENDENTE:** verificar em runtime se `LOTE_COBRANCA`/`ITENS_LOTECOB` disparam `REM_*` (hoje `replica:false` assumido).
- **G-10 (carimbo de auditoria) — PENDENTE:** confirmar `USULTALTERACAO/DTULTIMALTERACAO/DTCADASTRO` carimbados como no form-base.

---

## 10. Alvo (especificação de implementação)

**Backend (NestJS + Kysely — `apps/api/src/modules/cobranca/`):**
- Módulo: `cobranca`. Duas faces convivem: **vertical** (`lotes-cobranca.controller.ts` em `/cobranca/lotes`, via `LotesCobrancaService`) e **declarativa/agregado** (`lotes-md.controller.ts` em `/cobranca/lotes-md`, via `AggregateEngineService` + `LoteCobrancaRepository` p/ o read enriquecido). O **web usa `/cobranca/lotes-md`**.
- Endpoints (derivados de [Dados](#4-dados)/[Eventos](#3-eventos)):
  | Método+rota | Origem (Q/BR) | DTO (zod) | Mutação? |
  |---|---|---|---|
  | `GET /cobranca/lotes-md` | Q5 | — | leitura (lista) |
  | `GET /cobranca/lotes-md/:id` | Q1+Q1detalhe (read enriquecido) | — | leitura (master+itens+juros/total) |
  | `POST /cobranca/lotes-md` | BR-07, BR-02 | `loteCobrancaSchema` | escrita agregada (header+itens, 1 tx) |
  | `PUT /cobranca/lotes-md/:id` | BR-07, BR-02 | `loteCobrancaSchema.partial()` | escrita (substitui itens, 1 tx) |
  | `DELETE /cobranca/lotes-md/:id` | BR-07 | — | escrita (cascata, 204) |
  | `GET /cobranca/areceber` | Q2 (picker) | query `consiliado`/`excluirDoLote` | leitura (escopo empresa, fail-closed) |
  | `GET /cobranca/cobradores` | Q4 (lookup) | — | leitura (FUN='S') |
- Para o **service/engine**: RBAC (BR via `@RequerAcesso('FRMCADLOTECOBRANCA', 'BTNGRAVAR'/'BTNEXCLUIR')`); `assertCobradorValido` FUN='S' (BR-02) **antes** do save; carimbo de operador/data (auditoria); transação escopada (BR-07); `replica:false` (assumido, confirmar runtime). **Juros/total (BR-01) ficam nas VIEWS** (`get_itens_lotecob`/`get_areceber`), não em código — transcrição literal do legado.
- Para o **DTO/zod** (`packages/shared/src/schema/lote-cobranca.schema.ts`): `codparceiro` int obrigatório (BR-02); `data` string ISO obrigatória (BR-03); `itens` array **min 1** de `{ codrcb int }` (só `codrcb` persiste — as colunas de exibição são descartadas no submit pelo `z.object`).

**Frontend (React — `apps/web/src/features/lotes-md/`):**
- Componente `LotesCobrancaCadMaster.tsx` sobre `<CadMaster>` (pilar mestre-detalhe): master = `<SelectField label="&Cobrador">` (lookup `cobranca/cobradores`, mostra `"cod - razão"`) + `<DateField label="&Emissão">` (default `hojeISO()`, BR-03). Detalhe = `<DataTable>` read-only (colunas codrcb/duplicata/razao/dtvenc/valor/juros/total) + `<Button label="Adicionar &títulos">` → `AddTitulosModal.tsx` (Modal + DataTable multi-seleção, busca/filtro, dedupe por `codrcb` BR-04, `consiliado='S'`). `lotesCobrancaApi.ts`: `listAreceber` (picker), tipos `AreceberRow`/`ItemLote`.
- Estado: `useFieldArray('itens')` (append do picker / remove por linha); `useResourceOptions` p/ o lookup. Mapa de teclado (seção 8): F3 no cobrador, `&` nos labels/botões, Enter-avança.
- **Lacuna:** `x-operador-id`/`x-empresa-id`/`x-tenant-id` **fixos** no `lotesCobrancaApi.ts:L14-19` (placeholder de dev) — identidade real virá do contexto de sessão.

**Decisões offline (PDV/Electron):** N/A direto — montagem de lote de cobrança roda na **retaguarda/nuvem** (não é caminho de PDV). Não há escrita offline. O picker `ARECEBER` lê dados transacionais que vivem na nuvem.

---

## Paridade com o novo

> **Implementação master-detalhe existente** em `/Library/Apollo` (monorepo `sicom`: NestJS+Kysely+React). É a **primeira tela mestre-detalhe** construída — exercita o `AggregateEngineService` (agregado transacional + cascata) e dois padrões novos (picker multi-seleção + lookup). **Construída fiel; smoke do agregado verde; golden RUNTIME do legado (juros/total) PENDENTE.**

**Backend:**
- `apps/api/migrations/005_lote_cobranca.sql` — tabelas `lote_cobranca`/`itens_lotecob` (FK `ON DELETE CASCADE`), sequences, RBAC `FRMCADLOTECOBRANCA`.
- `apps/api/migrations/014_parceiros.sql` — `parceiros` (`fun`, `tolerancia`, `codend`) + `parceiros_end` + seeds (cobradores FUN='S' e clientes FUN='N').
- `apps/api/migrations/015_areceber.sql` — `areceber` (**`codempresa`**, não idempresa) + view `get_areceber` (picker, com juros/total/dias_atraso).
- `apps/api/migrations/016_lote_cobranca_full.sql` — view `get_itens_lotecob` (**transcrição literal** do `sqqITENS_LOTECOB`: live-join + juros/total) + `get_lote_cobranca` estendida com `razao`.
- `lote-cobranca.repository.ts` — `read`/`readEnriched`, `assertCobradorValido` (FUN='S'), `listAreceber` (fail-closed por empresa), `listCobradores`, `create`/`update`/`remove` (transação + carimbo).
- `lote-cobranca.aggregate.ts` — `AggregateConfig` (detalhe `itens_lotecob` por `codrcb`, `replica:false`). `lotes-md.controller.ts` (web) + `lotes-cobranca.controller.ts` (vertical).

**Schema — `packages/shared/src/schema/lote-cobranca.schema.ts`:** `loteCobrancaSchema` (`codparceiro`, `data`, `itens.min(1)` de `{codrcb}`) — só `codrcb` persiste (BR-08/colunas de exibição descartadas).

**Frontend — `apps/web/src/features/lotes-md/`:** `LotesCobrancaCadMaster.tsx`, `AddTitulosModal.tsx`, `lotesCobrancaApi.ts` (descritos na seção 10).

**Divergências conhecidas / pendências:**
1. **Golden RUNTIME do legado (BR-01 juros/total) — PENDENCIA-COROA.** A fórmula está **transcrita verbatim**, não certificada contra o ERP rodando; depende de `CURRENT_DATE`. Capturar V$SQL com data fixada e comparar 1-centavo (G-06). É o que mantém o status em **`em-revisão`**.
2. **`FECHAMENTO_CAIXA` → `CONSILIADO='S'` (BR-05).** No legado, o filtro de conciliado liga **só** em fechamento de caixa; no alvo `consiliado` é query param (front passa `'S'` default). Mover a decisão para o servidor/contexto de sessão.
3. **Replicação `REM_*` (BR-09/G-09).** `replica:false` é **assumido** — confirmar em runtime se as tabelas disparam outbox.
4. **Carimbo de auditoria (G-10) / `HISTORICO_DINAMICO` / telemetria.** Carimbo implementado no repositório; histórico/telemetria herdados do engine — confirmar paridade em runtime.
5. **Relatórios FastReport** (geral + agrupado por bairro, `RelatrioGeral1Click`/`RelatrioAgrupadopor1Click`) **não implementados** — export server-side pendente.
6. **`x-operador-id`/`x-empresa-id` fixos** no `lotesCobrancaApi.ts` — placeholder de dev.
7. **Dois controllers convivem** (`/cobranca/lotes` vertical e `/cobranca/lotes-md` agregado) — o web usa `lotes-md`; decidir se o vertical é descartável.

---

## Lacunas (para sair de `em-revisão`)

**✅ Confirmado `[Oracle-dict]`:** Master `LOTE_COBRANCA` guarda só `CODLOTECOB`(PK seq)/`CODPARCEIRO`(Cobrador, PARCEIRO FUN='S')/`DATA`(Emissão, default hoje) — `RAZAO` é LEFT JOIN, **não armazenada**. Detalhe `ITENS_LOTECOB`: única coluna de negócio STORED = `CODRCB`(FK→ARECEBER) + `CODILOTCOB`(PK seq) + `CODLOTECOB`(FK). `ARECEBER` usa **`CODEMPRESA`** (≠ IDEMPRESA): `codrcb, codparceiro, codempresa, dtvenda, dtvenc, duplicata(20), valor numeric(13,2), txjuros numeric(13,2), consiliado char(1)`. `PARCEIROS(codparceiro, razao(150), FUN char(1), TOLERANCIA int, codend)`. `PARCEIROS_END(codend, endereco(150), bairro(50), cidade(60), uf char(2), telefone(20))`. Fórmula juros/total **transcrita** do legado.

**✅ Confirmado do `.pas`/`.dfm` (estática):** herança `TfrmCadMasterDet`; `ListaDetalhes.Add(cdsITENS_LOTECOB)`; `btnAddIten` → `GET_ARECEBER` multi-seleção com filtro empresa(+conciliado em fechamento); dedupe por `CODRCB`; `SegFornecedor` FUN='S'; F3 → lookup; `DefaultToday`; PK item por `GetID`; grid read-only de 13 colunas; fórmula juros/total verbatim na `sqqITENS_LOTECOB`.

**🟡 Inferido / não capturado em runtime:** pipeline de escrita do agregado (nested→provider→1 tx); cascata em código; carimbo de auditoria; `HISTORICO_DINAMICO`/telemetria; replicação `REM_*` (assumida ausente); a SQL final da pesquisa do master.

**Pendências (não marcar `concluído` / `paridade-verde` sem elas):**
1. **Golden RUNTIME de JUROS/TOTAL (BR-01)** com data fixada — certifica a fórmula 1-centavo (risco financeiro). **A pendência-coroa.**
2. **Captura V$SQL** do save do agregado + carimbo + (possível) replicação desta tela.
3. **BR-05 `FECHAMENTO_CAIXA`** no servidor (não só query param do front).
4. **Relatórios FastReport** (geral + por bairro).
5. **Revisão independente** ([../../08-agents/review-loop.md](../../08-agents/review-loop.md)) — autor ≠ revisor.
6. **Paridade verde que exercita o caminho real** ([../../06-testing-quality/parity-harness.md](../../06-testing-quality/parity-harness.md)) — incluindo teclado (F3, mnemônicos, Enter, foco programático Emissão→Adicionar) via Playwright.

## Ver também

- [dossier-template.md](../../dossier-template.md) · [dossier-process.md](../../dossier-process.md)
- [uCadOperacoesConta.md](uCadOperacoesConta.md) · [uCadBancos.md](uCadBancos.md) — herdeiras de tabela única (contraste com mestre-detalhe).
- [form-base-cadmaster.md](../../03-legacy-analysis/recon/form-base-cadmaster.md) — §5b (variante mestre-detalhe `TfrmCadMasterDet`).
- [../../03-legacy-analysis/dynamic-sql-extraction.md](../../03-legacy-analysis/dynamic-sql-extraction.md) — como fechar as seções 4 e 9 (runtime golden, esp. juros/total).
- [../../03-legacy-analysis/business-rule-extraction.md](../../03-legacy-analysis/business-rule-extraction.md) — extrair a regra de cálculo com profundidade (seção 5).
- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — ADR-008/010/011/012/014/015.
