# Dossiê — `TfrmCadProduto` (Cadastro de PRODUTO — a maior tela do Apollo: identidade + fiscal + preço por empresa + estoque + composição/kit + balança/nutricional + logística)

| Campo | Valor |
|---|---|
| **Status** | **`rascunho`** — recon **ESTÁTICA** (`UCadProduto.pas` 8.819 linhas + `UCadProduto.dfm` 18.423 linhas + datamodule **ATIVO** `udmCadProduto.pas` 3.383 linhas + `.dfm` 9.840 linhas) **+ DICIONÁRIO Oracle read-only** (validado em `pinheirao@dbhomologacao`), feita por **4 agentes** e consolidada nos ANCHORS da recon. **Pendente** para sair de `rascunho`: **golden RUNTIME (captura V$SQL/REMESSA_SERVER)**, **plano de implementação** e **código**. É **a tela-monstro** da retaguarda: a maior do sistema, com ~15 abas, ~14 detalhes 1:N, arquitetura fiscal de 3 camadas (PRODUTOS↔MULTI_PRECO↔DET_ALIQUOTA), 5 triggers Oracle e o motor de preço já portado (a reusar, não reescrever). |
| **Autor / Revisor** | agentes Analista de Legado (Claude — recon estática + dicionário, 4 agentes) / *pendente — revisor independente ([../../../08-agents/review-loop.md](../../../08-agents/review-loop.md))* |
| **Versão do dossiê** | v1 — 1º dossiê da entidade `PRODUTOS` (a maior tela; agregado multi-tabela com cálculo fiscal **delegado** ao módulo `precificacao` já portado) |
| **Data** | 2026-06-26 |
| **Commit do legado analisado** | `/Library/SicomGit/retaguarda-master` (branch `*-master`, sem hash versionado) |

> **Por que esta tela:** `PRODUTOS` é, ao lado de `PARCEIROS`, a entidade central do ERP — **213 colunas físicas**, **43.117 linhas** `[Oracle-dict]`. Alimenta PDV (cupom/preço/tributação offline), estoque, NF, composição/kit, balança. A tela é gigante (8.819 linhas `.pas` / 18.423 `.dfm`) porque agrega **3 camadas de dados** (config global → preço por empresa → alíquota por UF) e **~14 sub-tabelas 1:N**. Migrar `PRODUTOS` destrava o coração do PDV e da fiscalização.
>
> ⚠️ **Correções confirmadas (não repetir erros comuns):**
> 1. **A TELA NÃO CALCULA preço/imposto.** O motor histórico está **morto/comentado** dentro do form (`GeraCusto` `[.pas:L6532]`, `CalculaPrecos` `[.pas:L3999]`, `MargemL` `[.pas:L6179]`). O cálculo real vive na modal `TfrmPrificacaoCusto` + `TMargemPreco` (`uMargemPreco`) e **JÁ FOI PORTADO** para `/Library/Apollo/apps/api/src/modules/precificacao`. **REUSAR via injeção; NÃO reescrever.** `[.pas:L3999,6179,6532]`
> 2. **Arquitetura fiscal de 3 camadas** (não é uma tabela só): (1) **PRODUTOS** = identidade + config fiscal **global** (sem `IDEMPRESA`); (2) **MULTI_PRECO** = preço + tributação **efetiva por empresa** (1:N por `IDEMPRESA`, 137.530 linhas); (3) **DET_ALIQUOTA** = ICMS por `(ALIQUOTA,UF)` **compartilhado** (238 linhas, **JÁ MIGRADO** em `007_tributacao.sql`). A coluna `ALIQUOTA` do produto é **FK-código** (CHAR(3), ex.: `T01`/`STB`) para `DET_ALIQUOTA`, não um número. `[Oracle-dict]` + `[ANCHORS]`
> 3. **DM ativo é `udmCadProduto` (FireDAC, `TDmCadProduto`/`DmCadProduto`).** `uRDmCadProduto` é **ÓRFÃO**; `DmOld/udmCadProduto` é **MORTO** (DBExpress, fora do build); `Objetos/Classes/Produtos.pas` é **stub** (só confirma PK lógica `PRODUTOS=IDPRODUTO`, `MULTI_PRECO=(IDPRODUTO,IDEMPRESA)`). `[ANCHORS]`
> 4. **Oracle (dicionário, read-only):** PK **`IDPRODUTO`** por sequence **`ID_IDPRODUTO` app-side, SEM trigger BEFORE INSERT**. **GLOBAL** (PRODUTOS não tem `IDEMPRESA`; quem tem é MULTI_PRECO/ESTOQUE). NOT NULL: `CODFOR, ALIQUOTA, CODBARRA, DESCRICAO, UNIDADE, BALANCA`. Único DEFAULT relevante: `CONTROLE_VALIDADE='S'`. Flags `CHAR(1)` são **tri-state S/N/NULL** com **dados sujos** (`TIPOPIS` `'Z'`/`'z'`; `SERVICO` mistura `'0'`/`'N'`; `ORIGEMPROD` quase tudo NULL). Inativação por flag `ATIVO`='S'/'N' (grade pinta inativo de vermelho); **DELETE é FÍSICO** (`btnExcluir` só checa `NF_PROD.CODPRODUTO`). `[Oracle-dict]` + `[ANCHORS]`

---

## 1. Identidade

| Campo | Valor |
|---|---|
| **Form (`.pas` / `.dfm`)** | `retaguarda-master/fonte/Units/UCadProduto.pas` (8.819 linhas) + `UCadProduto.dfm` (18.423 linhas) `[.dfm]`. Datamodule de dados **ATIVO**: `retaguarda-master/fonte/Units/udmCadProduto.pas` (3.383 linhas) + `udmCadProduto.dfm` (9.840 linhas) — classe `TDmCadProduto`, instância global `DmCadProduto` (**FireDAC**). |
| **Classe do form** | `TfrmCadProduto` — **herda `TfrmCadMasterDetalhe`** (→ `TfrmCadMaster`) `[.pas:L? — class TfrmCadProduto = class(TfrmCadMasterDetalhe)]` (uses `uCadMasterDetalhe`, `uCadMaster`). Mesma família dos pilotos/`uCadClientes`, porém **a maior e mais rica** de todas. |
| **Datamodules/units mortos ou órfãos (registrar p/ ignorar)** | `uRDmCadProduto` = **ÓRFÃO** (não referenciado pelo form ativo); `DmOld/udmCadProduto.*` = **MORTO** (DBExpress, versão antiga, fora do build); `Objetos/Classes/Produtos.pas` = **stub** (só confirma PK lógica). Ignorar nos três entregáveis. `[ANCHORS]` |
| **Módulo de domínio** | `cadastro` (transversal-coroa: comercial + **fiscal** + **estoque** + **precificação** + indústria/produção + logística + balança). |
| **Função no negócio** | CRUD do **produto** em toda a sua complexidade: identidade (DESCRICAO/CODBARRA/UNIDADE/marca/famílias), **config fiscal global** (NCM, CEST, ALIQUOTA-código, IDPISCOFINS, CODFIGURAFISCAL, CODFCP, MVA, ANP/GLP), **preço/custo/markup por empresa** (MULTI_PRECO), **estoque** por empresa/depósito, **composição/kit** (BOM produto↔produto), **decomposição** (partida), **ficha técnica/nutricional/receita** (balança), **códigos auxiliares/embalagens** (CODAUXILIAR), **fator de conversão**, **referência por fornecedor**, **pai↔filho/variações** (auto-referência), **logística** e **histórico de movimentações**. |
| **Frequência / criticidade** | **alta** frequência e **criticidade-coroa** — **caminho de PDV** (o preço/NCM/CST/alíquota daqui entram no cupom **offline**) e **fiscal** (NCM/CEST/CST/ICMS-ST). Mexer aqui toca PDV, NF, estoque, financeiro. **Risco de centavos**: o motor portado usa `round2` half-up; o legado usava `RoundTo(-2)` (half-to-even) — divergência de 1 centavo reprova paridade (ver [§5](#5-regras-de-negócio--o-porquê)/[§9](#9-casos-de-teste-golden--capturados-do-legado)). |
| **Rota-alvo (web)** | `/cadastro/produto` (lista) · `/cadastro/produto/:idproduto` (edição) — abas como sub-rotas/sub-forms. Sub-recurso de preço por empresa: `…/:idproduto/preco?empresa=`. |
| **Casca-alvo** | `browser` — cadastro de retaguarda/nuvem; sem device próprio. É **teclado-pesada** (F3 lookup, **F5 PLU balança**, **F8 EAN interno**, Insert grupo-preço). **`F5` é reservado pelo Chromium** ⇒ se algum power-user usar a geração de PLU por F5 em desktop, justificaria **Electron**; default `browser`. O **resultado** alimenta a carga do PDV (ver [§10 offline](#10-alvo-a-especificação-de-implementação)). |

---

## 2. UI — inventário de componentes (`.dfm` → React)

Herança visual de `TfrmCadMasterDetalhe`: cabeçalho + `pnlCabecalho` (código + pesquisa + navegador + filtro de situação) + rodapé de ações (`&Gravar`/`&Editar`/E`&`xcluir/`&Adicionar`/`&Cancelar`/`&Sair`) + `PageControl` master com abas + abas extras. O corpo é um `TPageControl` (`cxPageControl`) com **~15 abas** (várias com page-controls aninhados). **`.dfm` de 18.423 linhas** — inventário **completo** é pendência do parser do `.dfm` ([keyboard-ux-layer.md §6](../../../02-stack-and-standards/keyboard-ux-layer.md)); abaixo, a estrutura confirmada na recon. `[.dfm]`

### 2.1 Abas do PageControl master (ordem, caption, conteúdo) `[.dfm]` + `[ANCHORS]`

| # | Aba | Caption (`&`) | Conteúdo (grupos/campos-chave) | Detalhe / bind |
|---|---|---|---|---|
| 1 | **Principal** | `&Principal` | identificação (DESCRICAO/CODBARRA/UNIDADE/marca/famílias) + **custo/venda/markup/ICM_EFETIVO** + `cmbALIQUOTA` (FK-código DET_ALIQUOTA) + checks `ATIVO`/`PROMOCAO`/`PIS`/`BALANCA` | identidade/fiscal ← `cdsProduto` (PRODUTOS); **preço/custo/markup ← `cdsMulti_Preco_Update` (MULTI_PRECO)** |
| 2 | **Descrições** | `&Descrições` | descrição completa, **resumida**, **web**, **balança** (auto-preenchidas) | `cdsProduto` |
| 3 | **Tributação** | `&Tributação` | sub-abas: **Códigos auxiliares** (CODAUXILIAR), **Referência Fornecedor** (CODREFERENCIA_FOR), **Fator de Conversão** (FATOR_CONVERSAO ⚠ FK=`CODPRODUTO`), **Outros**, **Fornecedores Desassociados** (PRODUTOS_FORN_DESASSOCIADOS), **Produção**, **Filhos** (auto-ref) | múltiplos cds (ver [§4](#4-dados--toda-query-a-alma-do-dossiê)) |
| 4 | **Composição** | `&Composição` | kit/BOM produto↔produto (COMPOSICAO, `IDPRODUTO_01`) + markup de composição | `cdsComposicao` |
| 5 | **Decomposição** | `Decomposição` | partida → itens (DECOMPOSICAO); valida 100% | `cdsDecomposicao` (`tbsDecomposicao` `[.dfm:L7688]`) |
| 6 | **Balança** | `&Balança` | nutricional / receita / outras | `cdsBalanca`/nutricional |
| 7 | **Receita** | `&Receita` | ficha técnica (RECEITA_PROD) | `cdsReceita_Prod` |
| 8 | **Histórico das Movimentações** | `&Histórico…` | grid read-only de movimentações (SQL dinâmica) | `cdsHistorico` |
| 9 | **Indústria** | `&Indústria` | dados de indústria/produção | `cdsProduto` |
| 10 | **Cadastro Logístico** | `Cadastro &Logístico` | dados logísticos (peso/volume/embalagem) | `cdsProduto` |
| 11 | **Estoque** | `&Estoque` | saldo por empresa/depósito (ESTOQUE + ESTOQUE_DEP + ESTOQUE_PROD) | `cdsEstoque`/`cdsEstoque_Dep` |

> **Pendência:** ordem/caption verbatim e abas condicionais por config exigem o parser do `.dfm` (15 abas + sub-abas aninhadas). Acima = estrutura confirmada na recon; refinar antes de `paridade-verde`.

### 2.2 Campos-chave (bind correto — identidade/fiscal vs preço) `[.dfm]` + `[ANCHORS]`

| Componente | DataField | Origem (cds → tabela) | Nota |
|---|---|---|---|
| `edtDESCRICAO` | `DESCRICAO` | `cdsProduto` → PRODUTOS | NOT NULL; proíbe `;` e `|` (BR-03/BR-13) |
| `edtCODBARRA` | `CODBARRA` | `cdsProduto` → PRODUTOS | NOT NULL; EAN-13 (DV `CalculaDVCodBarra`); proíbe `*`; checa duplicidade |
| `cmbUNIDADE` | `UNIDADE` | `cdsProduto` → PRODUTOS | NOT NULL (FK lookup UNIDADE) |
| `edtNCMSH` | `NCMSH` | `cdsProduto` → PRODUTOS | obrigatório/8 dígitos por config `PREEN_NCM` (BR-01) |
| `edtCEST` | `CEST` | `cdsProduto` → PRODUTOS | obrigatório se alíquota `STB`/`CEST_OBRIGATORIO` (BR-04) |
| `cmbALIQUOTA` | `ALIQUOTA` | `cdsProduto` → PRODUTOS (**FK-código** DET_ALIQUOTA) | CHAR(3); `OnExit` carrega PIS/COFINS por `IDPISCOFINS` `[.pas:L4143]` |
| `edtICM_EFETIVO` | `ICM_EFETIVO` | derivado/MULTI_PRECO | usado p/ derivar `CODFIGURAFISCAL` no uso-consumo `[.pas:L2914]` |
| `edtVRCUSTO` / `edtVRVENDA` / `edtMARKUP` / `edtMARGEM` | `VRCUSTO*`/`VRVENDA`/`MARKUP`/`MARGEM*` | **`cdsMulti_Preco_Update` → MULTI_PRECO** | preço/custo **por empresa** (não em PRODUTOS) |
| `chkATIVO` | `ATIVO` | `cdsProduto` → PRODUTOS | S/N (inativo = vermelho na grade) |
| `chkPROMOCAO` / `chkPIS` / `chkBALANCA` | `PROMOCAO`/`PIS`/`BALANCA` | `cdsProduto`/MULTI_PRECO | `BALANCA` NOT NULL |
| `edtIDPRODUTO_PAI` | `IDPRODUTO_PAI` | `cdsProduto` (auto-ref) | exibição gated por config `EXIBE_CAMPO_PRODUTO_PAI`; venda filho = `VRVENDA×FATOR_FILHO` `[.pas:L6138]` |
| `edtHASHPAF` | `HASHPAF` | `cdsProduto` | gravado no `BeforePost` (`getHASH_Produtos` externo) `[.pas:L8619]` |

### 2.3 Combos de lista fixa (Items↔Values verbatim)

`[N/A — pendente parser do .dfm]` — os combos de domínio fechado (ex.: `ORIGEMPROD`, `TIPOPIS`, `SERVICO`, modos de markup) precisam ser extraídos verbatim do `.dfm` (18.423 linhas). **Atenção à sujeira de dados** (`TIPOPIS` `'Z'`/`'z'`; `SERVICO` `'0'`/`'N'`; `ORIGEMPROD` quase tudo NULL) — o enum do alvo precisa de **fallback** tolerante (espelhar `uCadClientes` BR-08). `[ANCHORS]` + `[Oracle-dict]`

**Notas de reflow:** layout absoluto `Left/Top` → **não copiar pixels**. As ~15 abas → componente de abas; sub-abas (Tributação tem 7 sub-abas) → abas aninhadas. `TGroupBox` → `<fieldset>`. `TDBGrid`/`cxGrid` de detalhe (composição/estoque/cod.aux/etc.) → `<DataGrid>` teclado-first ([keyboard-ux-layer.md §5](../../../02-stack-and-standards/keyboard-ux-layer.md)). **Crítico no reflow:** deixar explícito na UI **de onde vem cada número** — identidade/fiscal de `cdsProduto` (global) vs preço/custo de `cdsMulti_Preco_Update` (por empresa) — porque um mesmo "produto" tem preço diferente por empresa.

---

## 3. Eventos

Handlers próprios de `UCadProduto.pas`. O ciclo CRUD (gravar/editar/excluir/pesquisar/navegar/RBAC/teclado) é herdado de `TfrmCadMaster`/`TfrmCadMasterDetalhe` ([§7](#7-dependências), [form-base-cadmaster.md](../../../03-legacy-analysis/recon/form-base-cadmaster.md)). Defaults/auditoria de dataset vivem em `udmCadProduto.pas` (DM ativo, FireDAC). Linhas confirmadas por spot-check.

| Componente.Evento | `.pas` | O que faz (passo a passo) | Toca SQL? | Estado externo? | Vira (alvo) |
|---|---|---|---|---|---|
| `btnGravarClick` | `[.pas:L2608]` | **toda** a validação antes do `inherited` (ver [§5](#5-regras-de-negócio--o-porquê): NCM obrigatório/8 díg, `;` na descrição, CEST p/ STB, custo≠0, venda>0, PIS/COFINS p/ não-SN, decomposição=100%, pai≠filho, venda≥custo, código de barras, IBGE…) → `inherited` (pipeline form-base: ApplyUpdates + histórico + RBAC) | sim (NCM/CEST/dup + escrita) | sim ([§6](#6-efeitos-colaterais--estado-externo)) | validações no DTO/service + `POST/PUT` + replicação |
| `cdsProdutoBeforePost` (e/ou `btnGravar` pré-post) | `[.pas:L8614-8619]` | `HASHPAF := getHASH_Produtos(...)` (hash externo do produto p/ PAF-ECF) gravado no campo `HASHPAF` (`cdsPrincipal.FindField('HASHPAF')`) | — | chama função externa | gerar HASHPAF no service (BR-12) |
| `btnExcluirClick` | `[.pas:L2536]` | checa `NF_PROD.CODPRODUTO` (se há nota com o produto) → bloqueia; senão **DELETE FÍSICO** (dispara `DEL_PRODUTO` cascata) | sim | sim (cascata trigger) | guarda de exclusão + (rever soft-delete no alvo) (BR-14) |
| `cmbALIQUOTAExit` | `[.pas:L4143]` | carrega PIS/COFINS por `IDPISCOFINS` ligado à alíquota; (no uso-consumo) deriva `CODFIGURAFISCAL` de `ALIQUOTASAIDA`/`ICM_EFETIVO` `[.pas:L2914]` | sim (lookup) | — | onBlur → resolver tributação (reusa `precificacao`) (BR-05) |
| `CalculaDVCodBarra` | `[.pas:L3962]` | DV de EAN-13: 12 dígitos, pesos 3/1 do fim, `DV=(10−sum%10)%10` | — | — | helper EAN no DTO/service (BR-06) |
| `MontaCodigoBarra` (F8) | `[.pas:L7196]` | gera EAN interno: `'7' + ConcatenaLeft(GetID('CODBARRA_AUX'),11,'0') + DV` | sim (sequence) | consome sequence | endpoint "gerar EAN interno" (BR-07) |
| `RetornarCodigoBarraLivre` (F5) | `[.pas:L7669]` | retorna 1º PLU de balança livre na faixa `0001`–`9999` | sim (varre PLUs) | — | endpoint "PLU livre" (BR-08) |
| `CalcularVendaComposicao(PeloMarkup)` | `[.pas:L4020]` | venda do kit a partir do custo dos componentes; `RoundTo(-2)`; markup sobre custo (=modo D) | — (em memória) | — | **reusar `PrecoService` modo D** (BR-09) |
| pai↔filho venda | `[.pas:L6138]` | `VRVENDA_PAI := VRVENDA × FATOR_FILHO` | — | — | derivação de venda do filho (BR-10) |
| `NCMValido` | `[.pas:L7960]` | NCM existe em `NCM` e `VIGENCIA_INICIO ≤ hoje ≤ VIGENCIA_FIM` | sim (NCM) | — | validar NCM vigente (reusa `012_ncm`) (BR-02) |
| `MargemL` | `[.pas:L6179]` | **MORTO/comentado** — cálculo de margem | — | — | **N/A — usar `PrecoService` portado** |
| `CalculaPrecos(Evento)` | `[.pas:L3999]` | **MORTO/comentado** — recalc preço por evento (custo/markup/venda) | — | — | **N/A — usar `PrecoService`/`FiscalPricingService`** |
| `GeraCusto` | `[.pas:L6532]` | **MORTO/comentado** — composição de custo | — | — | **N/A — motor portado** |
| auto-descrições | `[.pas:L5538]` | preenche descrição resumida/web/balança a partir da completa; proíbe `|` (`'Não é permitido o caractere (|)…'` `[.pas:L5546]`) | — | — | derivação no service (BR-13) |
| `btnGravarCodAuxiliarClick` | `[.pas:L3357]` | grava barras auxiliares/embalagem (CODAUXILIAR) | sim | — | sub-recurso cod.auxiliar |
| `btnGravarItemReceitaClick` | `[.pas:L3370]` | grava item de receita (RECEITA_PROD) | sim | — | sub-recurso receita |
| `btnEditarClick` / `btnAdicionarRegistroClick` | `[.pas:L2418]` / form-base | entra em edição/insert (seed de detalhes) | — | — | entrar em edição / novo |
| **DM** `cdsProdutoNewRecord` | `[udmCadProduto.pas]` | defaults do novo: `IDPRODUTO := GetID('IDPRODUTO')` (sequence `ID_IDPRODUTO`), `ATIVO='S'`, `CONTROLE_VALIDADE='S'` (DEFAULT Oracle), flags `='N'`/NULL | sim (sequence) | consome sequence | defaults do insert (BR-11) |
| **DM** `cdsProdutoBeforePost` (auditoria) | `[udmCadProduto.pas]` | carimbo de auditoria (`AUDIT_PRODUTOS` é trigger; app pode também carimbar usuário/data) | — | lê operador | auditoria (cruzar trigger `AUDIT_PRODUTOS`) |
| **DM** `cds<detalhe>NewRecord` (Multi_Preco/Estoque/CodAux/Composicao/Decomposicao/Receita/FatorConv/CodRef/…) | `[udmCadProduto.pas]` | herdam `IDPRODUTO` do master + PK por `GetID(...)`; MULTI_PRECO/ESTOQUE herdam `IDEMPRESA` | sim | sequences | defaults dos detalhes |

> **Achados (que "olhar a tela" perderia):**
> 1. **O motor de cálculo do form está MORTO** (`CalculaPrecos`/`MargemL`/`GeraCusto` comentados) — quem calcula é a modal `TfrmPrificacaoCusto`+`TMargemPreco`, **já portada** em `apps/api/src/modules/precificacao`. Não reimplementar a partir do `.pas` morto.
> 2. **Preço NÃO está em PRODUTOS** — vive em **MULTI_PRECO** (por `IDEMPRESA`), bindado por `cdsMulti_Preco_Update`. A aba Principal mistura campos de duas tabelas.
> 3. **Geração de código de barras tem 3 modos** distintos: EAN-13 com DV (`CalculaDVCodBarra`), EAN interno F8 (`MontaCodigoBarra`, prefixo `'7'`), e PLU de balança F5 (`RetornarCodigoBarraLivre`, 0001-9999) — cada um vira endpoint próprio.
> 4. **`ALIQUOTA` é código, não número** — `cmbALIQUOTAExit` resolve PIS/COFINS/figura fiscal a partir do código (FK p/ DET_ALIQUOTA + IDPISCOFINS).
> 5. **`HASHPAF` no BeforePost** — escrita-fantasma via `getHASH_Produtos` externo (PAF-ECF); paridade tem de reproduzir.

---

## 4. Dados — TODA query (a alma do dossiê)

> **Aviso de procedência:** o SELECT master e os nested vivem no `udmCadProduto.dfm` (9.840 linhas) — o inventário **verbatim completo** é pendência (não cabe re-ler exaustivamente; a recon consolidou estrutura/chaves/relacionamentos nos ANCHORS). As SQLs abaixo são **reconstruções** a partir do dicionário Oracle + recon; marcadas `[inferido até runtime/parser]` onde a forma exata depende do `.dfm`/captura V$SQL. As **chaves e relacionamentos** são `[Oracle-dict]`/`[ANCHORS]` confiáveis.

### Q1 — `cdsProduto` (master PRODUTOS) — `[udmCadProduto.dfm SQL.Strings]` `[inferido até parser]`
- **Origem:** `TFDQuery` (FireDAC) `Connection=dmPrincipal.FDConexao` → provider → `cdsProduto` (master dos nested).
- **Quando dispara:** abrir/editar por código (`cdsProduto.Params['IDPRODUTO']` ou `CODBARRA`).
- **SQL base (Oracle, reconstrução — 213 colunas físicas + LEFT JOINs de família/marca/unidade/ncm/fornecedor):**
  ```sql
  SELECT P.IDPRODUTO, P.DESCRICAO, P.CODBARRA, P.UNIDADE, P.CODFOR,
         P.NCMSH, P.CEST, P.CEST_OBRIGATORIO, P.ALIQUOTA, P.IDPISCOFINS,
         P.CODFIGURAFISCAL, P.CODFCP, P.MVA, P.ORIGEMPROD, P.TIPOPIS, P.SERVICO,
         P.ATIVO, P.PROMOCAO, P.BALANCA, P.CONTROLE_VALIDADE, P.HASHPAF,
         P.IDPRODUTO_PAI, P.FATOR_FILHO,
         P.CODGRUPO, P.CODSUBGRUPO, P.CODDPTO, P.CODSECAO, P.CODGRUPOPRECO,
         P.CODMARCA, /* … +~190 colunas … */
         G.DESCRICAO  AS DESCGRUPO,    SG.DESCRICAO AS DESCSUBGRUPO,
         DP.DESCRICAO AS DESCDPTO,     SE.DESCRICAO AS DESCSECAO,
         GP.DESCRICAO AS DESCGRUPOPRECO,
         M.DESCRICAO  AS DESCMARCA,    N.DESCRICAO  AS DESCNCM
  FROM PRODUTOS P
  LEFT JOIN FAMILIAS_PROD G  ON (G.CODFAMILIA  = P.CODGRUPO      AND G.TIPO='G')
  LEFT JOIN FAMILIAS_PROD SG ON (SG.CODFAMILIA = P.CODSUBGRUPO   AND SG.TIPO='S')
  LEFT JOIN FAMILIAS_PROD DP ON (DP.CODFAMILIA = P.CODDPTO       AND DP.TIPO='D')
  LEFT JOIN FAMILIAS_PROD SE ON (SE.CODFAMILIA = P.CODSECAO      AND SE.TIPO='O')
  LEFT JOIN FAMILIAS_PROD GP ON (GP.CODFAMILIA = P.CODGRUPOPRECO AND GP.TIPO='R')
  LEFT JOIN MARCAS        M  ON (M.CODMARCA    = P.CODMARCA)
  LEFT JOIN NCM           N  ON (N.NCMSH       = P.NCMSH)
  WHERE P.IDPRODUTO = :IDPRODUTO
  ```
- **Nota crítica de modelagem:** **`FAMILIAS_PROD` é tabela ÚNICA** com discriminador `TIPO` (`G`=grupo / `S`=subgrupo / `D`=depto / `O`=seção / `R`=grupo-de-preço), keyed por `CODFAMILIA`. PRODUTOS aponta para ela **5 vezes** (`CODGRUPO`/`CODSUBGRUPO`/`CODDPTO`/`CODSECAO`/`CODGRUPOPRECO`). `[Oracle-dict]`+`[ANCHORS]`
- **Params:** `:IDPRODUTO` (`ftInteger`/`ftLargeint`).
- **Mutações:** leitura (Q1) + escrita (INSERT/UPDATE/DELETE) em `PRODUTOS` + cascata para os detalhes nested.
- **PK por SEQUENCE app-side `ID_IDPRODUTO`** `[Oracle-dict]` — `GetID('IDPRODUTO')` no `NewRecord`; **sem trigger BEFORE INSERT**. → PG `nextval('seq_produto_idproduto')`.
- **Triggers AFTER (escrita-fantasma, cruzar [§6](#6-efeitos-colaterais--estado-externo)):** `REM_PRODUTO` (replicação → `REMESSA_SERVER`; **no UPDATE só replica se ~12 colunas fiscais/identidade mudam**: `CODBARRA`/`ALIQUOTA`/`UNIDADE`/`DESCRICAO`/`NCMSH`/`CEST`/`IDPRODUTO_PAI`…); `AUDIT_PRODUTOS`; `DEL_PRODUTO` (cascata DELETE em VENDAS/ESTOQUE/ESTOQUE_DEP); `UPDATE_CODAUXILIAR` (sincroniza `CODBARRA`→`CODAUXILIAR`); `UPDATE_PRODUTOS_FILHOS` (txn autônoma, propaga campos fiscais do pai p/ filhos via `IDPRODUTO_PAI`). `[Oracle-dict]`+`[ANCHORS]`
- **SQL-alvo (PG, Kysely):** `read = select … from produtos p <left joins familias_prod×5/marcas/ncm> where p.idproduto=$1`. Oracle→PG: `NVL`→`COALESCE`, `ROWNUM`→`LIMIT`, `(+)`→`LEFT JOIN`, sequence Oracle → `nextval`. **Decisão:** 213 colunas — podar vestigiais só após survey multi-tenant (espelhar política de `PARCEIROS`).

### Q2 — Lista / Pesquisa (view `GET_PRODUTOS`) — `[Oracle-dict]` + `[ANCHORS]`
- **Origem:** form-base `btnPesquisaClick` abre `frmPesquisa` sobre a **view `GET_PRODUTOS`** (usada também pelos lookups de `uCadClientes` para `CODREFERENCIA_FOR`). Filtro de situação por `ATIVO`.
- **Fragmentos (alvo):** filtro do usuário (descrição/código de barras), `ATIVO IN ('S'|'N'|'S','N')` (`rdgAtivo`/F6), limit. **Escopo:** lista é global, mas o preço exibido é por empresa (MULTI_PRECO).
- **Alvo:** `GET /cadastro/produto?busca=…&ativo=…&empresa=…` + `GET /cadastro/produto/:id`.

### Q3 — `cdsMulti_Preco_Update` (MULTI_PRECO — preço/custo/tributação por empresa) — `[ANCHORS]` `[inferido até parser]`
- **Master-detail:** por `IDPRODUTO`; 1:N por `IDEMPRESA` (137.530 linhas, ~100 colunas).
- **Colunas-chave:** `VRCUSTO*`/`VRVENDA`/`MARKUP`/`MARGEM*`/`PROMOCAO` + tributação **efetiva por empresa**: `ALIQUOTASAIDA`/`CST`/`IDPISCOFINS`/`CODFIGURAFISCAL`/`FCP_SAIDA`. PK lógica `(IDPRODUTO,IDEMPRESA)` `[Objetos/Classes/Produtos.pas stub]`.
- **Mutação:** leitura + escrita por empresa. **É aqui que a aba Principal grava preço/custo/markup.**

### Q4 — `DET_ALIQUOTA` (ICMS por (ALIQUOTA,UF) — compartilhado, **JÁ MIGRADO**) — `[Oracle-dict]` + `[007_tributacao.sql]`
- **Relação:** `PRODUTOS.ALIQUOTA` (código CHAR(3)) → `DET_ALIQUOTA` (chave `(ALIQUOTA,UF)`, 238 linhas).
- **Colunas:** `ICM`/`ICM_EFETIVO`/`BASE`/`CST`/`CSOSN`. **Regra de código** `[ANCHORS]`: só códigos que começam com `'T'` carregam ICMS de saída; `'STB'`/`'NTB'`/`'IST'` → ICMS 0; empresa `'SN'` (Simples) zera ICMS/FCP.
- **Alvo:** **JÁ EXISTE** — `TributacaoRepository.resolverAtual(aliquota, uf)` em `apps/api/src/modules/precificacao/tributacao.repository.ts:L35` (lê `det_aliquota`). **NÃO reescrever.**

### Q5–Q14 — Sub-tabelas 1:N (chave por `IDPRODUTO`, salvo nota) — `[Oracle-dict]` + `[ANCHORS]`

| Q | cds / tabela | Chave / relação | Conteúdo |
|---|---|---|---|
| Q5 | `cdsCodAuxiliar` / **CODAUXILIAR** | PK `CHAVEAUX`; por `IDPRODUTO` | barras auxiliares/embalagens (`FATOREMB`/`CODUNIDADE`); trigger `UPDATE_CODAUXILIAR` sincroniza `CODBARRA`→`CODAUXILIAR` |
| Q6 | `cdsEstoque` / **ESTOQUE** + **ESTOQUE_DEP** + **ESTOQUE_PROD** | por `IDPRODUTO` + `IDEMPRESA` | saldo por empresa/depósito |
| Q7 | `cdsMulti_Preco` / **MULTI_PRECO** + **MULTI_PRECO_ATACAREJO** | (`IDPRODUTO`,`IDEMPRESA`) | preço (ver Q3) + atacarejo |
| Q8 | `cdsLotePreco` / **LOTEPRECO** | por `IDPRODUTO` | histórico/fila de preço (66k linhas) |
| Q9 | `cdsComposicao`/`cdsDecomposicao` / **COMPOSICAO** + **DECOMPOSICAO** | produto↔produto via `IDPRODUTO_01` | kit/BOM + partida (valida 100%) |
| Q10 | `cdsReceita_Prod` / **RECEITA_PROD** | por `IDPRODUTO` | ficha técnica |
| Q11 | `cdsFatorConversao` / **FATOR_CONVERSAO** | ⚠ **FK = `CODPRODUTO`** (não `IDPRODUTO`) | DE/PARA/FATOR |
| Q12 | `cdsCodReferencia_For` / **CODREFERENCIA_FOR** | por `IDPRODUTO` + `CODFOR` | ref/EAN por fornecedor (`TIPOREF` P/E) |
| Q13 | `cdsProdForn` / **PRODUTOS_FORN_DESASSOCIADOS** + **PRODUTOS_ANP** | por `IDPRODUTO` | fornecedores desassociados; ANP/combustível |
| Q14 | `cdsImagens`/`cdsLoteValidade` / **PRODUTOS_IMAGENS** + **LOTE_PRODUTO_VALIDADE** | por `IDPRODUTO` | imagens BLOB; lotes/validade |

### Q15 — Histórico de movimentações (DINÂMICA, read-only) — `[.pas montada]` `[inferido até runtime]`
- Montada por período/empresa/produto; `CommandText` + `Open`. Read-only. Forma final depende de captura V$SQL.

### Queries inline (`.pas`, escritas/checagens) `[.pas]`
- `btnExcluirClick` → `SELECT … FROM NF_PROD WHERE CODPRODUTO=<idproduto>` (trava de exclusão, BR-14) `[.pas:L2536]`.
- `NCMValido` → `SELECT 1 FROM NCM WHERE NCMSH=<ncm> AND VIGENCIA_INICIO<=SYSDATE AND VIGENCIA_FIM>=SYSDATE` `[.pas:L7960]` (BR-02).
- `RetornarCodigoBarraLivre` → varredura de PLUs ocupados na faixa 0001-9999 `[.pas:L7669]` (BR-08).
- `MontaCodigoBarra` → `GetID('CODBARRA_AUX')` (sequence) `[.pas:L7196]` (BR-07).
- `cmbALIQUOTAExit` → lookup PIS/COFINS por `IDPISCOFINS` `[.pas:L4143]` (BR-05).

> **Regra de ouro:** as **chaves/relacionamentos** (PK, FKs, FAMILIAS_PROD discriminador, MULTI_PRECO por empresa, FATOR_CONVERSAO via `CODPRODUTO`, triggers) são `[Oracle-dict]`/`[ANCHORS]` **confiáveis**. A **forma verbatim** do SELECT master/nested e a SQL **dinâmica** (Q15) são `[inferido até parser/runtime]` — exigem parser do `.dfm` + captura **V$SQL** para `paridade-verde`. Não declarar paridade sem isso.

---

## 5. Regras de negócio (o *porquê*)

| ID | Regra | Gatilho | Lógica (verbatim/confirmada) | *Porquê* | Procedência |
|---|---|---|---|---|---|
| BR-01 | **NCM obrigatório + 8 dígitos (config `PREEN_NCM`)** | `btnGravar` | `''`/`'C'`→exige 8 díg; `'G'`→2 díg; vazio → `'O NCM é obrigatorio!'`; tamanho errado → `'O NCM deve ter 8 dígitos.'` | NCM é base da tributação na NF | `[.pas:L2690,2697]` (+L5814) |
| BR-02 | **NCM tem de estar vigente** | `NCMValido`/gravar | NCM existe em `NCM` e `VIGENCIA_INICIO ≤ hoje ≤ VIGENCIA_FIM` | NCM revogado reprova a NF | `[.pas:L7960]` |
| BR-03 | **Descrição sem `;`** | `btnGravar` | `'A descrição do produto não pode conter o caractere ";"'` | `;` quebra layouts/integrações | `[.pas:L2681]` |
| BR-04 | **CEST obrigatório p/ alíquota STB** | `btnGravar` | `'Para alíquota do tipo "STB", a informação do CEST é obrigatória.'` | ST exige CEST na NF | `[.pas:L2740]` |
| BR-05 | **Alíquota carrega PIS/COFINS + figura fiscal** | `cmbALIQUOTAExit` | resolve PIS/COFINS por `IDPISCOFINS`; no uso-consumo deriva `CODFIGURAFISCAL` de `ALIQUOTASAIDA`/`ICM_EFETIVO` | `ALIQUOTA` é código fiscal, não número; encadeia tributação | `[.pas:L4143,2914]` |
| BR-06 | **DV de EAN-13** | EAN | 12 dígitos, pesos 3/1 a partir do fim, `DV=(10−(sum mod 10)) mod 10` | EAN inválido falha na leitura PDV | `[.pas:L3962]` |
| BR-07 | **Geração de EAN interno (F8)** | F8 | `'7' + ConcatenaLeft(GetID('CODBARRA_AUX'),11,'0') + DV` | produtos sem EAN comercial precisam de código interno (prefixo 7) | `[.pas:L7196]` |
| BR-08 | **PLU de balança livre (F5)** | F5 | 1º código livre na faixa `0001`–`9999` | balança usa PLU curto; não pode colidir | `[.pas:L7669]` |
| BR-09 | **Venda de composição/kit** | edição composição | venda = custo dos componentes + markup (modo D); `RoundTo(-2)` | preço do kit deriva dos itens | `[.pas:L4020]` |
| BR-10 | **Venda do filho deriva do pai** | edição pai/filho | `VRVENDA_PAI := VRVENDA × FATOR_FILHO` | variações precificam proporcional ao pai | `[.pas:L6138]` |
| BR-11 | **Defaults do novo produto** | novo (DM) | `IDPRODUTO:=GetID('IDPRODUTO')` (sequence `ID_IDPRODUTO`), `ATIVO='S'`, `CONTROLE_VALIDADE='S'` (DEFAULT Oracle) | estado inicial consistente; PK por sequence app-side | `[udmCadProduto.pas]`+`[Oracle-dict]` |
| BR-12 | **HASHPAF no BeforePost** | BeforePost/gravar | `HASHPAF := getHASH_Produtos(...)` (função externa) | exigência PAF-ECF (integridade do produto no cupom) | `[.pas:L8614-8619]` |
| BR-13 | **Descrição sem `|`; auto-preenche resumida/web/balança** | digitação/gravar | proíbe `|` (`'Não é permitido o caractere (|) na descrição do produto!'`); deriva descrições curtas | layouts de cupom/balança/web têm tamanho fixo | `[.pas:L5538,5546]` |
| BR-14 | **Não excluir produto com NF; DELETE físico** | `btnExcluir` | se existe `NF_PROD.CODPRODUTO` → bloqueia; senão **DELETE FÍSICO** (dispara `DEL_PRODUTO` cascata em VENDAS/ESTOQUE) | integridade fiscal; histórico não pode perder a referência | `[.pas:L2536]`+`[Oracle-dict]` |
| BR-15 | **Custo ≠ 0 / Custo Rep. ≠ 0** | `btnGravar` | `'O Custo deve ser diferente 0. Verifique'`; `'O Custo Rep. deve ser diferente 0. Verifique'` | custo zero quebra markup/margem | `[.pas:L2758,2766]` |
| BR-16 | **Valor de venda > 0** | `btnGravar` | `'Informe um Valor de Venda Válido! Deve ser maior que 0 '` (config `VrVendaObrigatorio`) | produto sem preço não vende | `[.pas:L2776]` |
| BR-17 | **Venda ≥ custo (config `BLOQ_VENDA_MAIOR_CUSTO`)** | `btnGravar` | `'Valor de Venda não pode ser menor que Valor de Custo'` | bloqueio comercial opcional contra prejuízo | `[.pas:L2886]` |
| BR-18 | **PIS/COFINS obrigatório p/ não-SN** | `btnGravar` | `'Para empresas não enquadradas como simples nacional, é obrigatório informar os dados de PIS/COFINS.'`; `'Natureza PIS/Cofins deve ser informado'` | regime normal apura PIS/COFINS | `[.pas:L2831,2837,2708]` |
| BR-19 | **Decomposição = 100% da partida** | `btnGravar` | `'A decomposição não atingiu 100% da partida, verifique'` | partida tem de fechar (balanço de massa) | `[.pas:L2820]` |
| BR-20 | **Produto pai ≠ filho** | `btnGravar` | `'O produto pai deve ser diferente do produto filho.'` | auto-referência circular inválida | `[.pas:L2846]` |
| BR-21 | **Código de barras: obrigatório, sem `*`, único** | `btnGravar`/gravar cod.aux | `'Informe o código de barras!'`; `'Não é permitido o uso do caracter (*) na composição do código de barras. Verifique!'`; checa duplicidade (`SegCodBarra`/`SegCodBarra_CodAux`) | EAN é chave de leitura no PDV; duplicado vende produto errado | `[.pas:L4903,4921]` |
| BR-22 | **Seção/Depto/Grupo/SubGrupo obrigatórios (config)** | `btnGravar` | `'Informe a Seção/Departamento/Grupo/SubGrupo...'` (config `SecaoDeptoGrupoSubObrigatorio`) | classificação merceológica obrigatória por rede | `[.pas]` (msg verbatim ANCHORS) |
| BR-23 | **Inativação por flag, não delete** | edição | `ATIVO='S'/'N'`; grade pinta inativo de **vermelho** | mantém histórico; tira do PDV sem apagar | `[Oracle-dict]`+`[ANCHORS]` |
| BR-24 | **Tri-state e dados sujos nos flags** | migração/leitura | flags `CHAR(1)` são S/N/**NULL**; `TIPOPIS` tem `'Z'`/`'z'`; `SERVICO` mistura `'0'`/`'N'`; `ORIGEMPROD` quase tudo NULL | domínio **não é fechado** nos dados reais | `[Oracle-dict]`+`[ANCHORS]` |
| BR-25 | **Geração de código de barras por config** | novo/F8 | `CodBarra AUTOMATICO` × manual (config `D`) | redes que geram EAN interno vs que digitam | `[ANCHORS]` (config-driven) |

> **Cálculos — REUSAR, não reescrever:** o cálculo de preço/imposto **não vive nesta tela** (motor morto: `CalculaPrecos`/`MargemL`/`GeraCusto` comentados `[.pas:L3999,6179,6532]`). O motor real está **portado** em `apps/api/src/modules/precificacao`:
> - `PrecoService` (`preco.service.ts`): `calcularMargem`/`calcularValorVenda` modos **`D`** (markup sobre custo) e **`M`** (margem sobre venda), com guardas de divisão por zero; arredonda com **`round2` (half-up)**.
> - `FiscalPricingService` (`preco-fiscal.service.ts`): `precoAtual(custo, margem, t)` = preço **"por dentro"** (ICMS_ef + PIS + COFINS + FCP + desp), modo final/líquido, SN; + ICMS-ST via MVA; + Reforma IBS/CBS/IS.
> - `TributacaoRepository` (`tributacao.repository.ts`): `resolverAtual(aliquota, uf)` = `DET_ALIQUOTA`; `resolverIndexador(ncm)` = `INDEXADOR_TRIBUTARIO`; `resolverReforma(uf, data)`.
> - `PrecificacaoProdutoService` (`precificacao-produto.service.ts`): orquestra produto (alíquota-código + custo + margem).
>
> ⚠️ **RISCO DE CENTAVOS (coroa):** o legado usa `RoundTo(-2)` do Delphi = **half-to-even (banker's)**; o motor portado usa `round2` = **half-up** (`Math.round((v+EPSILON)*100)/100`, `preco.service.ts:L20`). **Divergência de 1 centavo em casos `.xx5` reprova paridade.** CONFIRMAR no runtime e alinhar a política de arredondamento (decidir half-even no motor OU aceitar a divergência documentada). `[.pas:L4020 RoundTo]` vs `[preco.service.ts:L20]`
>
> **Gaps do motor (do ANCHORS):** FCP por UF (tabela `FCP` ausente), PIS/COFINS via tabela `PISCOFINS` (ausente; hoje input manual), IRPJ/CSLL/DespOp via `EMPRESAS` (ausente). Esses insumos precisam de migração para o motor fechar sem input manual.

---

## 6. Efeitos colaterais + estado externo

> A seção que salva da armadilha de acoplamento ([hidden-coupling-traps.md](../../../03-legacy-analysis/hidden-coupling-traps.md)).

| Item | Tipo | Alvo | Quem setou / consome | Mapeamento alvo |
|---|---|---|---|---|
| `dmPrincipal.FDConexao` | usa | conexão Oracle **global** | boot | conexão **por tenant** request-scoped |
| `dmPrincipal.EmpresaCODEMPRESA` | lê | empresa logada | login | `currentTenant().empresaId` (carimba `IDEMPRESA` em MULTI_PRECO/ESTOQUE) |
| `dmPrincipal.OperadorCODOPERADOR` | lê | operador logado | login | contexto p/ auditoria |
| `dmPrincipal.Sessao.ValorConfiguracao(...)` | lê | configs (`PREEN_NCM`, `SecaoDeptoGrupoSubObrigatorio`, `VrVendaObrigatorio`, `BLOQ_VENDA_MAIOR_CUSTO`, `CodBarra AUTOMATICO`, `BloquearPrecificacao`/`MARKUPFIXO`, `SINCRONIZA_PRECO_NF`, `EXIBE_CAMPO_PRODUTO_PAI`, SimplesNacional `'SN'`) | configuração | feature flags por tenant/empresa |
| `dmPrincipal.GetID(<seq>)` | grava (consome) | sequences (`IDPRODUTO`/`ID_IDPRODUTO`, `CODBARRA_AUX`, `CHAVEAUX`, + PKs dos detalhes) | NewRecord dos cds | `nextval` por entidade |
| `getHASH_Produtos(...)` | grava | coluna `HASHPAF` | BeforePost | gerar hash no service (PAF-ECF) |
| **trigger `REM_PRODUTO`** | grava (indireto) | fila `REMESSA_SERVER` | AFTER I/U/D; **no UPDATE só enfileira se ~12 colunas fiscais/identidade mudam** (`CODBARRA`/`ALIQUOTA`/`UNIDADE`/`DESCRICAO`/`NCMSH`/`CEST`/`IDPRODUTO_PAI`…) | **outbox de sync** com a condição de colunas no UPDATE `[Oracle-dict]` |
| **trigger `AUDIT_PRODUTOS`** | grava (indireto) | auditoria | AFTER I/U/D | audit log do engine |
| **trigger `DEL_PRODUTO`** | grava (indireto) | cascata DELETE em `VENDAS`/`ESTOQUE`/`ESTOQUE_DEP` | AFTER DELETE | cascata explícita em transação |
| **trigger `UPDATE_CODAUXILIAR`** | grava (indireto) | `CODAUXILIAR` | sincroniza `CODBARRA`→`CODAUXILIAR` | replicar sync no service |
| **trigger `UPDATE_PRODUTOS_FILHOS`** | grava (indireto) | filhos via `IDPRODUTO_PAI` | **txn autônoma**, propaga campos fiscais do pai p/ filhos | propagação pai→filhos no service (atenção à txn autônoma) |
| `NCM`/`MARCAS`/`FAMILIAS_PROD`/`UNIDADE`/`DET_ALIQUOTA`/`PISCOFINS`/`FIGURA_FISCAL`/`PARCEIROS`(fornecedor) | lê | tabelas FK/lookup | LEFT JOIN / `frmPesquisa` | FK + lookups (vários **já migrados**) |
| `NF_PROD` | lê | trava de exclusão | BR-14 | checagem server-side |
| modal `TfrmPrificacaoCusto`/`TMargemPreco` (`uMargemPreco`) | usa | **motor de preço** (separado da tela) | abertura modal | **`precificacao` (já portado)** via injeção |
| `frmPesquisa` (views `GET_*`) | usa | lookups F3 | F3 nos códigos | `<SelectField>`/modal de busca |

- **Conexão/transação:** conexão global `dmPrincipal`; no alvo, a gravação (PRODUTOS + MULTI_PRECO + ESTOQUE + ~14 detalhes + auditoria + HASHPAF + outbox) roda em **uma transação** escopada por tenant. **Cascata** master→detalhes e **propagação pai→filhos** (trigger `UPDATE_PRODUTOS_FILHOS`, txn autônoma) precisam ser fiéis.
- **Ordem de abertura assumida:** login + empresa + operador. Sem empresa, MULTI_PRECO/ESTOQUE não carimbam `IDEMPRESA`. Vira tenant context.

> **Diferenças que mais importam:** (1) **replica condicional** — `REM_PRODUTO` no UPDATE só enfileira se ~12 colunas fiscais/identidade mudam (não basta `replica:true`; é replica-se-mudou-coluna-X). (2) **DELETE é físico + cascata `DEL_PRODUTO`** (≠ soft-delete de PARCEIROS) — decisão de design no alvo. (3) **propagação pai→filhos** em txn autônoma. (4) **HASHPAF** (escrita-fantasma PAF-ECF). (5) **preço por empresa** (MULTI_PRECO) — a "mesma" gravação escreve N linhas.

---

## 7. Dependências

| Dependência | Tipo | Como é usada | Vira (alvo) |
|---|---|---|---|
| `TfrmCadMasterDetalhe` (→ `TfrmCadMaster`) | **herança** | CRUD mestre-detalhe: gravar/editar/excluir/pesquisar/navegar, RBAC, histórico, log, carimbo, teclado (F3/F6/Esc), `ListaDetalhes`, `SetaDataset`, view `GET_*` | **engine CRUD reutilizável** + `AggregateConfig` por detalhe ([form-base-cadmaster.md](../../../03-legacy-analysis/recon/form-base-cadmaster.md)) |
| `TDmCadProduto` (`udmCadProduto`, **FireDAC**) | datamodule **ativo** | master `cdsProduto` + ~14 nested (MULTI_PRECO/ESTOQUE/CODAUX/COMPOSICAO/DECOMPOSICAO/RECEITA/FATOR_CONV/CODREF_FOR/IMAGENS/LOTE/…); defaults/auditoria | `CrudConfig` + `AggregateConfig` (sem estado) |
| `udmPrincipal` (`dmPrincipal`) | datamodule global | conexão, empresa, operador, configs, `GetID`, `RetornarValores`, `ShowPesquisa`, `GetMultiEmpresa` | tenant context + providers + serviços |
| **`TfrmPrificacaoCusto` + `TMargemPreco` (`uMargemPreco`, `uPrecificacaoPDV`)** | modal + classe | **motor de preço/custo/markup/imposto** (fora da tela) | **REUSAR `precificacao` (já portado)** via injeção — **não reescrever** |
| `uPesquisa` (`frmPesquisa`) | form modal | lookups F3 sobre `GET_*` (unidade/família/marca/ncm/fornecedor/alíquota/produto) | `<SelectField>`/modal de busca |
| `udmIntegracaoProduto` / `uClientModuleFiscal` / `uTransProd` | units | integração de produto / cliente fiscal / transferência | serviços de domínio (a mapear) |
| `FuncoesApollo` (`RetornarValores`,`Mensagem`,`ConcatenaLeft`,`ValidaDocumento`,`iif`) | unit utilitária | helpers/lookups | helpers/serviços |
| `SearchEngineApollo` (`SegFornecedor`/`SegCodGrupo`/`SegCodBarra`/`SegSubGrupo`/`SegDepartamento`/`SegCodBarra_CodAux`) | componente | lookups + checagem de duplicidade de código de barras | serviços de busca/validação |
| `frx*` (FastReport) / `cxGrid` / `JvDBGrid` / `JvThumbImage` / `frxExportXLS/PDF/XML` | libs | grids, relatórios (etiqueta/ficha), imagens BLOB, exportação | `<DataGrid>`/export server-side/upload |
| `NCM`/`MARCAS`/`FAMILIAS_PROD`/`UNIDADE`/`DET_ALIQUOTA`/`PISCOFINS`/`FIGURA_FISCAL`/`PARCEIROS` | tabelas FK | JOINs/lookups | FK + views (vários migrados) |
| `NF_PROD` | tabela (trava) | integridade de exclusão (BR-14) | checagem |
| **Mortos/órfãos** `uRDmCadProduto`/`DmOld/udmCadProduto`/`Objetos/Classes/Produtos.pas` | — | não usados (órfão/morto/stub) | ignorar |

**Reuso já migrado (confirmado):** `marcas` (`006_marcas.sql`), `ncm` (`012_ncm.sql`), `tributacao`/DET_ALIQUOTA (`007_tributacao.sql`), `indexador_tributario` (`008_indexador_tributario.sql`), `preco` (`011_preco.sql`), `cidades` (`013_cidades.sql`), `parceiros`/fornecedor (`014`–`019`) + **módulo `precificacao` inteiro**.

**Falta migrar:** `PRODUTOS`, `MULTI_PRECO`, `FAMILIAS_PROD`, `UNIDADE`, `PISCOFINS`, `FCP`, `FIGURA_FISCAL`, `ESTOQUE`(+DEP/PROD), `CODAUXILIAR`, `COMPOSICAO`/`DECOMPOSICAO`/`RECEITA_PROD`, `FATOR_CONVERSAO`, `LOTEPRECO`, `CODREFERENCIA_FOR`, `PRODUTOS_IMAGENS`, `LOTE_PRODUTO_VALIDADE`, `PRODUTOS_ANP`.

---

## 8. TabOrder + mapa de atalhos/mnemônicos

> Extraído do `.dfm` ([keyboard-ux-layer.md §6](../../../02-stack-and-standards/keyboard-ux-layer.md)). Memória muscular é critério de aceite (ADR-010).

**Foco inicial / TabOrder:** **`[N/A — pendente parser do .dfm]`** — `.dfm` de 18.423 linhas com ~15 abas; a sequência exata `TabOrder` por aba é **dado**, output do `extract-dfm-mnemonics.ts`, não digitada à mão. Pendência para `paridade-verde`.

**Mnemônicos `&`:** abas e ações do rodapé têm `&` (herdadas do form-base: `&Gravar`/`&Editar`/E`&`xcluir/`&Adicionar`/`&Cancelar`/`&Sair`); abas: `&Principal`/`&Descrições`/`&Tributação`/`&Composição`/`&Balança`/`&Receita`/`&Estoque`… Extrair verbatim no parser.

**Atalhos (F-keys/Ctrl) — confirmados na recon `[ANCHORS]`:**

| Atalho | Ação | Origem | Escopo | Reservado pelo browser? (→ Electron) |
|---|---|---|---|---|
| `F3` | lookup (`frmPesquisa`: unidade/família/marca/ncm/fornecedor/alíquota/produto) | `*KeyUp`/`*KeyDown` + form-base | campo/tela | não |
| `F5` | **gerar PLU de balança livre** (`RetornarCodigoBarraLivre`) | `[.pas:L7669]` | tela | **sim** → casca Electron se usado |
| `F8` | **gerar EAN interno** (`MontaCodigoBarra`) | `[.pas:L7196]` | tela | não |
| `Insert` | grupo de preço | `[ANCHORS]` | grid/aba | não |
| `F6` | filtro situação (ativo/inativo/todos, `rdgAtivo`) | form-base | tela | não |
| `Enter` | avança / confirma | form-base | tela | não |
| `Esc` | cancelar/sair (bloqueado em insert/edit pelo form-base) | form-base | tela | não |
| (ShortCut `121`=F10 detectado no `.dfm:L16112`) | a confirmar no parser | `[.dfm:L16112]` | — | — |

---

## 9. Casos de teste (golden) — capturados do legado

> ⚠️ **PENDÊNCIA RUNTIME — NÃO HÁ GOLDEN CAPTURADO AINDA.** A recon foi **estática** (`.pas`/`.dfm`/DM ativo) + **dicionário Oracle read-only** (validado em `pinheirao@dbhomologacao`, 43.117 produtos / 137.530 linhas MULTI_PRECO). Para `paridade-verde`/`concluído` é obrigatório **capturar V$SQL + REMESSA_SERVER** com o ERP legado rodando ([dynamic-sql-extraction.md](../../../03-legacy-analysis/dynamic-sql-extraction.md)). Cobertura derivada das [§4](#4-dados--toda-query-a-alma-do-dossiê)/[§5](#5-regras-de-negócio--o-porquê): cada caminho condicional e cada BR precisa de ≥1 caso.

**Casos a capturar (mínimo):**

| ID | Cobre (BR/Q) | Input (estado + campos) | Ação | Output esperado a capturar | SQL/efeito a observar |
|---|---|---|---|---|---|
| G-01 | BR-06 (EAN DV) | CODBARRA com 12 díg | calcular DV | dígito verificador EAN-13 correto (capturar p/ vários códigos) | `CalculaDVCodBarra` |
| G-02 | BR-07 (EAN interno F8) | produto sem EAN, F8 | gerar | `'7' + 11 díg (sequence) + DV`; sequence `CODBARRA_AUX` avança | `GetID('CODBARRA_AUX')` |
| G-03 | BR-08 (PLU balança F5) | produto balança, F5 | gerar | 1º PLU livre 0001-9999 | varredura PLUs |
| G-04 | BR-01 (NCM) | NCM vazio / 5 díg | gravar | `'O NCM é obrigatorio!'` / `'O NCM deve ter 8 dígitos.'` | — |
| G-05 | BR-02 (NCM vigência) | NCM revogado | gravar | bloqueia (NCM fora de vigência) | `SELECT … FROM NCM … VIGENCIA` |
| G-06 | BR-04 (CEST STB) | alíquota=`STB`, CEST vazio | gravar | `'Para alíquota do tipo "STB", a informação do CEST é obrigatória.'` | — |
| G-07 | BR-15/16/17 (custo/venda) | custo=0 / venda=0 / venda<custo (config) | gravar | mensagens verbatim (BR-15/16/17) | — |
| G-08 | BR-18 (PIS/COFINS não-SN) | empresa não-SN, PIS/COFINS vazio | gravar | `'Para empresas não enquadradas como simples nacional…'` | — |
| G-09 | BR-19 (decomposição) | partida <100% | gravar | `'A decomposição não atingiu 100% da partida, verifique'` | — |
| G-10 | BR-20 (pai≠filho) | pai = filho | gravar | `'O produto pai deve ser diferente do produto filho.'` | — |
| G-11 | BR-21 (cod.barra) | CODBARRA com `*` / duplicado | gravar | `'Não é permitido o uso do caracter (*)…'` / erro de duplicidade | `SegCodBarra`/`SegCodBarra_CodAux` |
| G-12 | **preço via `precificacao`** (modo D) | custo=10,00; markup=30 | calcular venda | venda = 13,00 (modo D: `custo+custo·markup/100`) — **conferir half-even vs half-up** | comparar `PrecoService.calcularValorVenda` |
| G-13 | **preço via `precificacao`** (modo M) | custo=10,00; margem=30 | calcular venda | venda = 14,29 (modo M: `custo/(100−margem)·100`) — **caso `.xx5` p/ arredondamento** | comparar `PrecoService` |
| G-14 | **alíquota por UF** (DET_ALIQUOTA) | ALIQUOTA=`T01`, UF=`SP` vs `STB` | resolver | ICMS efetivo `T*`≠0; `STB`/`NTB`/`IST`→0; SN→0 | `TributacaoRepository.resolverAtual` |
| G-15 | BR-05 (alíquota→PIS/COFINS/figura) | trocar `cmbALIQUOTA` | sair do campo | PIS/COFINS por `IDPISCOFINS`; `CODFIGURAFISCAL` derivado | lookup `[.pas:L4143,2914]` |
| G-16 | BR-09 (composição/kit) | kit com 2 itens, custos X/Y, markup | calcular | venda do kit (`RoundTo(-2)`) | `CalcularVendaComposicao` |
| G-17 | BR-10 (pai→filho) | pai com `FATOR_FILHO` | derivar | `VRVENDA_PAI = VRVENDA × FATOR_FILHO` | `[.pas:L6138]` |
| G-18 | Q1 + escrita + replica | gravar produto novo | gravar | INSERT PRODUTOS (sequence) + MULTI_PRECO por empresa + **`REM_PRODUTO` enfileira** + `AUDIT_PRODUTOS` + `HASHPAF` | V$SQL + REMESSA_SERVER |
| G-19 | §6 replica condicional | editar só campo NÃO-fiscal (ex.: obs) vs editar `NCMSH` | gravar | UPDATE de campo não-fiscal **NÃO** enfileira; UPDATE de `NCMSH` **enfileira** | REMESSA_SERVER (condição de colunas) |
| G-20 | BR-14 (exclusão) | produto com NF_PROD vs sem | excluir | com NF → bloqueia; sem NF → DELETE físico + cascata `DEL_PRODUTO` | V$SQL + cascata |
| G-21 | §6 propagação pai→filhos | editar campo fiscal do pai | gravar | filhos atualizados via `UPDATE_PRODUTOS_FILHOS` (txn autônoma) | V$SQL nos filhos |

---

## 10. Alvo (a especificação de implementação)

> **RECOMENDAÇÃO ANCORADA NOS DADOS:** a tela é um **CRUD/config sobre `PRODUTOS` + sub-recursos** (um **agregado** grande), **REUSANDO o módulo `precificacao` já portado** para **qualquer cálculo** de preço/imposto (injeção — **não reescrever** o motor morto do `.pas`). Dada a dimensão (213 colunas, ~14 detalhes, 3 camadas fiscais, 5 triggers), a migração é **FASEADA**.

**Recorte FASEADO (recomendado):**
- **F1 — núcleo:** `PRODUTOS` core (identidade + config fiscal global) + **lookups** (unidade / família×5 / marca / ncm / fornecedor / alíquota) + **CODAUXILIAR** + **validações** (EAN DV/duplicidade/sem `*`, NCM obrigatório+vigência, CEST p/ STB, obrigatórios por config). PK por sequence; multi-tenant (`empresaScoped` onde aplicável); `marcas`/`ncm`/`det_aliquota` já migrados.
- **F2 — preço por empresa:** `MULTI_PRECO` (+ATACAREJO) **reusando `precificacao`** (`PrecoService` D/M, `FiscalPricingService.precoAtual`, `TributacaoRepository.resolverAtual/Indexador`). Aqui se decide a **política de arredondamento** (half-even vs half-up — risco de centavos).
- **F3 — estoque:** `ESTOQUE` (+DEP/PROD) por empresa/depósito.
- **F4 — composição/kit/nutricional/logística:** `COMPOSICAO`/`DECOMPOSICAO` (valida 100%), `RECEITA_PROD`, balança/nutricional, cadastro logístico, pai↔filho (auto-ref + `UPDATE_PRODUTOS_FILHOS`).
- **F5 — replicação + golden + integrações:** trigger `REM_PRODUTO` (outbox **condicional por colunas**) + **golden runtime** + integração NF/`LOTEPRECO`/grupo-preço + `DEL_PRODUTO` (cascata) + HASHPAF.

**Backend (NestJS + Kysely):**
- Módulo: `cadastro`. Recurso **`produto`** (aggregate-root, global) com sub-recursos: **`preco`** (MULTI_PRECO, por empresa, **reusa `precificacao`**), `estoque`, `cod-auxiliar`, `composicao`/`decomposicao`, `receita`, `fator-conversao`, `cod-ref-fornecedor`, `imagens`, `lote-validade`, `anp`.
- Endpoints:
  | Método+rota | Origem | DTO (zod) | Mutação? |
  |---|---|---|---|
  | `GET /cadastro/produto?busca=&ativo=&empresa=` | Q2 (`GET_PRODUTOS`) | `ProdutoFilterDto` | leitura |
  | `GET /cadastro/produto/:id` | Q1 (+nested) | — | leitura |
  | `POST /cadastro/produto` | btnGravar | `ProdutoUpsertDto` (identidade+fiscal+detalhes aninhados) | escrita (cascata + outbox condicional + HASHPAF) |
  | `PUT /cadastro/produto/:id` | btnGravar | `ProdutoUpsertDto` | escrita (outbox só se mudou coluna fiscal/identidade; propaga pai→filhos) |
  | `DELETE /cadastro/produto/:id` | btnExcluir | — | escrita (BR-14 guard NF_PROD; **DELETE físico + cascata** — rever se vira soft-delete) |
  | `GET/PUT /cadastro/produto/:id/preco?empresa=` | Q3 (MULTI_PRECO) | `PrecoUpsertDto` | escrita (**reusa `precificacao`**) |
  | `POST /cadastro/produto/:id/codbarra/ean-interno` (F8) | BR-07 | — | escrita (sequence CODBARRA_AUX) |
  | `GET /cadastro/produto/plu-livre` (F5) | BR-08 | — | leitura |
  | lookups: `…/aliquota` (DET_ALIQUOTA), `…/ncm`, `…/familia`, `…/marca`, `…/unidade`, `…/fornecedor` | Q-aux | — | leitura (vários já migrados) |
- **Regras p/ service:** BR-02 (NCM vigência), BR-05 (alíquota→PIS/COFINS/figura), BR-09/10 (composição/pai-filho via `precificacao`), BR-12 (HASHPAF), BR-14 (guard NF_PROD + cascata), replicação condicional `REM_PRODUTO`, propagação `UPDATE_PRODUTOS_FILHOS`. **Regras p/ DTO/zod:** BR-01 (NCM obrigatório/8), BR-03/13 (descrição sem `;`/`|`), BR-04 (CEST p/ STB), BR-06 (EAN DV), BR-15/16/17 (custo/venda), BR-18 (PIS/COFINS não-SN), BR-19 (decomposição 100%), BR-20 (pai≠filho), BR-21 (cod.barra), BR-22 (classificação obrigatória), BR-24 (enums **tolerantes** à sujeira S/N/NULL).
- **Cálculo:** **NÃO reimplementar** — injetar `PrecoService`/`FiscalPricingService`/`TributacaoRepository`/`PrecificacaoProdutoService`. **Decidir arredondamento** (risco de centavos).
- **Configs (config-driven `D`):** `PREEN_NCM`, `SecaoDeptoGrupoSubObrigatorio`, `VrVendaObrigatorio`, `BLOQ_VENDA_MAIOR_CUSTO`, `CodBarra AUTOMATICO`, `BloquearPrecificacao`/`MARKUPFIXO`, `SINCRONIZA_PRECO_NF`, `EXIBE_CAMPO_PRODUTO_PAI`, SimplesNacional `'SN'` → feature flags por tenant/empresa.

**Frontend (React):**
- Rota `/cadastro/produto?busca=…` (lista) + `/:id` (form com ~15 abas, sub-abas em Tributação). Aba **Principal** mistura identidade (`produto`) e preço (`preco?empresa=`) — deixar a origem explícita. Combos de domínio como `<SelectField>` (valores verbatim do parser, com fallback p/ sujeira). `<DataGrid>` teclado-first para os detalhes (composição/estoque/cod.aux). F3/F5/F8/Insert ([§8](#8-taborder--mapa-de-atalhosmnemônicos)) via `ShortcutScope`; máscara/DV de EAN; Enter-avança e taborder do engine (após parser).

**Decisões offline (PDV/Electron — ADR-008):**
- Cadastro roda **na nuvem/retaguarda**, **não** no PDV. Mas o **resultado alimenta a carga do PDV**: `CODBARRA`/`DESCRICAO`/`UNIDADE`/`NCMSH`/`CEST`/`ALIQUOTA`/`CST`/preço (MULTI_PRECO por empresa) — tudo que o cupom calcula **offline**. A replicação real (`REM_PRODUTO`, **condicional por coluna**) já modela o fluxo nuvem→edge→PDV. → o contrato do delta é backward-compatible (ADR-009); a **condição de colunas** define **o que** propaga ao caixa; o **teste de paridade fiscal** (G-12/13/14) tem de rodar **no motor que o PDV usa offline**, não só na API.

---

## Lacunas (para sair de `rascunho`)

**✅ Confirmado (`[.pas]`/`[.dfm]`/`[Oracle-dict]`/recon, spot-check de linhas):** tela viva `TfrmCadProduto` (herda `TfrmCadMasterDetalhe`); DM ativo `udmCadProduto` (FireDAC), mortos/órfãos identificados; arquitetura fiscal 3 camadas (PRODUTOS↔MULTI_PRECO↔DET_ALIQUOTA); `ALIQUOTA`=código FK; `FAMILIAS_PROD` única com discriminador `TIPO` (5 apontamentos); ~14 sub-tabelas 1:N (incl. `FATOR_CONVERSAO` via `CODPRODUTO`); 5 triggers Oracle (`REM_PRODUTO` condicional/`AUDIT_PRODUTOS`/`DEL_PRODUTO`/`UPDATE_CODAUXILIAR`/`UPDATE_PRODUTOS_FILHOS`); motor de cálculo **morto** no form (`CalculaPrecos:L3999`/`MargemL:L6179`/`GeraCusto:L6532`) e **portado** em `precificacao`; derivações vivas (EAN DV:L3962 / EAN interno:L7196 / PLU:L7669 / composição:L4020 / pai-filho:L6138 / NCMValido:L7960 / HASHPAF:L8619 / cmbALIQUOTAExit:L4143); **todas as mensagens PT verbatim** de `btnGravarClick:L2608` (linhas L2681–L2886, L4903/L4921, L5546); sequence `ID_IDPRODUTO` sem trigger; DELETE físico; flags tri-state + dados sujos; reuso já migrado (006/007/008/011/012/013/014–019 + módulo `precificacao`).

**🟡 Inferido (pendente parser/runtime):** SELECT master/nested **verbatim** (parser do `.dfm` de 18.423 + 9.840 linhas); ordem/caption exatos das ~15 abas e sub-abas; TabOrder por aba; combos de domínio verbatim; SQL **dinâmica** de histórico (Q15); forma exata do enfileiramento `REM_PRODUTO`; pipeline de escrita delta + cascata + propagação pai→filhos.

**Pendências (não marcar paridade sem elas):**
1. **Captura RUNTIME (V$SQL + REMESSA_SERVER)** dos casos G-01..G-21 — fecha [§4](#4-dados--toda-query-a-alma-do-dossiê)/[§9](#9-casos-de-teste-golden--capturados-do-legado). **Prioridade:** EAN DV, NCM vigência, CEST STB, **preço via `precificacao`** (modos D/M + arredondamento), **alíquota por UF** (DET_ALIQUOTA), replica condicional, cascata DELETE.
2. **Parser do `.dfm`** — inventário completo de componentes (§2), TabOrder + mnemônicos (§8), combos verbatim (§2.3).
3. **Decisão de arredondamento** (half-even Delphi vs half-up motor portado) — risco de centavos.
4. **Migração das dependências** ainda ausentes (PRODUTOS, MULTI_PRECO, FAMILIAS_PROD, UNIDADE, PISCOFINS, FCP, FIGURA_FISCAL, ESTOQUE, CODAUXILIAR, COMPOSICAO/DECOMPOSICAO/RECEITA, FATOR_CONVERSAO, LOTEPRECO) + survey multi-tenant antes de podar colunas vestigiais.
5. **Plano de implementação + código** (agregado `produto` faseado F1→F5, reusando `precificacao`).
6. **Revisão independente** + **paridade verde** que exercita o caminho real ([parity-harness.md](../../../06-testing-quality/parity-harness.md)), incl. teclado.

## Ver também

- [dossier-template.md](../../dossier-template.md) · [dossier-process.md](../../dossier-process.md) · [README.md](../../README.md)
- [uCadClientes.md](uCadClientes.md) — a outra tela-coroa (PARCEIROS); mesma família `TfrmCadMasterDetalhe`, mesma profundidade.
- [form-base-cadmaster.md](../../../03-legacy-analysis/recon/form-base-cadmaster.md) — contrato de `TfrmCadMaster`/`TfrmCadMasterDetalhe`.
- `apps/api/src/modules/precificacao/` — **motor de preço/imposto já portado** (`preco.service.ts`, `preco-fiscal.service.ts`, `tributacao.repository.ts`, `precificacao-produto.service.ts`) — **reusar**.
- migrations `007_tributacao.sql` (DET_ALIQUOTA) · `008_indexador_tributario.sql` · `011_preco.sql` · `012_ncm.sql` · `006_marcas.sql`.
- [../../../03-legacy-analysis/dynamic-sql-extraction.md](../../../03-legacy-analysis/dynamic-sql-extraction.md) — capturar SQL/golden em runtime (fecha §4/§9).
- [../../../03-legacy-analysis/business-rule-extraction.md](../../../03-legacy-analysis/business-rule-extraction.md) · [../../../03-legacy-analysis/hidden-coupling-traps.md](../../../03-legacy-analysis/hidden-coupling-traps.md) · [../../../02-stack-and-standards/keyboard-ux-layer.md](../../../02-stack-and-standards/keyboard-ux-layer.md)
- [../../../00-orientation/canonical-decisions.md](../../../00-orientation/canonical-decisions.md) — ADR-008/010/011/012.
