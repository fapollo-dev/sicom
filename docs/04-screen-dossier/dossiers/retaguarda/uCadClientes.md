# Dossiê — `TfrmCadClientes` (Cadastro UNIFICADO de PARCEIROS — Clientes/Fornecedores/Transportadoras/Funcionários/Convênios)

| Campo | Valor |
|---|---|
| **Status** | **`rascunho`** — recon **ESTÁTICA** (`.pas` 5.749 linhas + `.dfm` 14.734 linhas + datamodule `dmParceiros`) **+ DICIONÁRIO Oracle read-only** feita e cruzada com [entity-parceiros.md](../../../03-legacy-analysis/recon/entity-parceiros.md) (validação `pinheirao@dbhomologacao`, 18.295 parceiros). **Pendente** para sair de `rascunho`: **golden RUNTIME (captura V$SQL/REMESSA_SERVER)**, **plano de implementação** e **código**. É a **tela-coroa** do Apollo: party polimórfico, ~13 abas, ~7 detalhes mestre-detalhe, dezenas de regras, replicação por trigger, e o ponto onde quase todo fluxo (venda/NF/financeiro/compra) aponta. |
| **Autor / Revisor** | agente Analista de Legado (Claude) / *pendente — revisor independente ([../../../08-agents/review-loop.md](../../../08-agents/review-loop.md))* |
| **Versão do dossiê** | v1 — 1º dossiê de tela **mestre-detalhe multi-papel** (a entidade central; ≠ pilotos magros) |
| **Data** | 2026-06-25 |
| **Commit do legado analisado** | `/Library/SicomGit/retaguarda-master` (branch `*-master`, sem hash versionado) |

> **Por que esta tela:** é o **cadastro mais central do sistema** — a tabela `PARCEIROS` é a pedra angular do modelo ([entity-parceiros.md §4](../../../03-legacy-analysis/recon/entity-parceiros.md): 31 tabelas a referenciam; **a que mais replica** — backlog de ~9.722 UPDATEs em `REMESSA_SERVER` no schema amostrado). Uma **única** tela viva (`TfrmCadClientes`) atende **cinco papéis** (Cliente/Fornecedor/Transportadora/Funcionário/Convênio) via parametrização de menu. Documentá-la corretamente destrava todos os módulos a jusante.
>
> ⚠️ **Correções confirmadas (não repetir erros comuns):**
> 1. **`PARCEIROS` é tabela ÚNICA multi-papel.** 6 flags `char(1)` 'S'/'N' **independentes**: `CLI`(cliente), `FRN`(**fornecedor**), `FUN`(**funcionário/vendedor — NÃO fornecedor**; o JOIN de vendedor usa `V.FUN='S'`), `TRA`(transportador), `CON`(convênio), `ASS`(**morto, 100% null**). Um parceiro pode ter vários papéis ao mesmo tempo (**57% acumulam >1 papel** — [entity-parceiros.md §7b](../../../03-legacy-analysis/recon/entity-parceiros.md)). Regra: **ao menos um papel** obrigatório no gravar (BR-02).
> 2. **A tela viva é UMA só** (`TfrmCadClientes`), parametrizada pelo menu via `ControleTipoParceiro` (CLIENTES→CLI, FORNECEDORES→FRN, …). `uCadFornecedores.pas`/`uCadParceiros.pas` são **STUBS MORTOS** — fora do build (`uInicializacao.pas:122` registra **só** `TfrmCadClientes`; nem registra os stubs). Inclusive `uCadParceiros.pas` declara a classe `TfrmCadFornecedores` (dead code).
> 3. **CNPJ/CPF e RG/IE NÃO estão em `PARCEIROS`** — vivem em **`PARCEIROS_END`** (por endereço). Join `PARCEIROS.CODEND → PARCEIROS_END.CODEND` (endereço padrão/cobrança; 1:1 default, mas a tabela suporta 1:N).
> 4. **Oracle (dicionário, read-only confirmado):** `PARCEIROS` = **195 colunas físicas** (`[Oracle-dict]`; a recon agrupada conta **169** em [entity-parceiros.md](../../../03-legacy-analysis/recon/entity-parceiros.md); o SELECT do `.dfm` traz ~140), **18.296 linhas**; PK `CODPARCEIRO` via sequence **`ID_CODPARCEIRO` app-side (SEM trigger BEFORE INSERT)**; colunas-ano com nomes numéricos `"2017".."2022"` (precisarão rename/aspas em PG, ex. `valor_2017`); `BIOMETRIA` BLOB; auditoria via app (`ULTIMA_ALTER` no BeforePost); replicação por trigger AFTER **`REM_PARCEIROS`** (no UPDATE **só enfileira quando `CLI='S'`**) + **`REM_PARCEIROSEND`**. `TIPOFJ`: F/J/R/G/E (Física/Jurídica/Rural/Governo/Entidade) — **+ sujeira real** (2 nulos, 1 `'L'`). Sem CHECK de valores; DEFAULT 'N' em flags de retenção/dispensa.

---

## 1. Identidade

| Campo | Valor |
|---|---|
| **Form (`.pas` / `.dfm`)** | `retaguarda-master/fonte/Units/uCadClientes.pas` (5.749 linhas) + `uCadClientes.dfm` (14.734 linhas) `[.dfm]`. Datamodule de dados: `retaguarda-master/fonte/Units/udmParceiros.pas` (972 linhas) + `udmParceiros.dfm` (4.105 linhas) — classe `TdmParceiros`, instância global `dmParceiros`. **(há também `DmOld/udmParceiros.*` — versão antiga com SELECT gordo, não é a do build.)** |
| **Classe do form** | `TfrmCadClientes` — **herda `TfrmCadMasterDetalhe`** (→ `TfrmCadMaster`) `[.pas:L37]`. Mesma família dos pilotos, porém o caso **mais rico**: party polimórfico + ~7 detalhes nested. |
| **Stubs mortos (registrar)** | `uCadFornecedores.pas`/`uCadParceiros.pas` (`TfrmCadFornecedores`) **NÃO** estão no build — `uInicializacao.pas` só faz `RegisterClass(TfrmCadClientes)` `[uInicializacao.pas:L122]`. Ignorar nos três entregáveis. `[.pas:L1, uCadFornecedores.pas/uCadParceiros.pas]` |
| **Módulo de domínio** | `cadastro` (transversal: comercial + fiscal + financeiro + compras + RH). |
| **Função no negócio** | CRUD do **parceiro de negócio** em qualquer papel: identidade (RAZAO/FANTASIA/TIPOFJ), endereços+documentos (`PARCEIROS_END`, com CNPJ/CPF/IE/RG, CEP/IBGE), papéis (flags), dados financeiros (crédito/juros/tolerância/convênio), bancos, formas de pgto, relacionamentos, faturamento, acordos comerciais, retenções de fornecedor, biometria/foto, vendedores. |
| **Frequência / criticidade** | **alta** frequência e **criticidade-coroa** — não é o cupom do PDV, mas **alimenta tudo**: tributação de fornecedor (retenções — risco fiscal), limite/juros de cliente (financeiro), comissão de vendedor (`FUN`), endereço/CNPJ que entram na **NF** (risco fiscal), e **replica** para os edges (`REM_PARCEIROS`/`REM_PARCEIROSEND`). Mexer aqui toca todos os módulos. |
| **Rota-alvo (web)** | `/cadastro/parceiros` (lista) · `/cadastro/parceiros/:cod` (edição) — com `?papel=cliente\|fornecedor\|transportadora\|funcionario\|convenio` espelhando `ControleTipoParceiro` (ver [§10](#10-alvo-a-especificação-de-implementação)). |
| **Casca-alvo** | `browser` — cadastro de retaguarda/nuvem; sem device próprio. Embora seja teclado-pesada (F3/Ctrl+N/Ctrl+A), nenhuma tecla colide com o Chromium ⇒ não exige Electron. (O **resultado** alimenta a carga do PDV — ver [§10 offline](#10-alvo-a-especificação-de-implementação).) |

---

## 2. UI — inventário de componentes (`.dfm` → React)

Herança visual de `TfrmCadMasterDetalhe`: cabeçalho (`imgCabecalho`/`lblTitulo`), `pnlCabecalho` (`edtCodigo`+`btnPesquisa`+`DBNavigator`+`rdgAtivo`), rodapé de ações (`&Gravar`/`&Editar`/E`&`xcluir/`&Adicionar`/`&Cancelar`/`&Sair`), `PageControlGeral` (aba master `tbsMaster` + abas detalhe + `tsSaldoParceiros` + `tbsFoto`). O corpo da master é o **`pgcDadosCliente`** (`TPageControl`), com **13 abas** (várias com page-controls aninhados). `[.dfm]`

### 2.1 Abas do `pgcDadosCliente` (ordem, caption, conteúdo) `[.dfm]`

| # | TTabSheet | Caption (`&`) | Conteúdo (grupos/campos-chave) | Detalhe / bind |
|---|---|---|---|---|
| 1 | `tbsDadosIndividuais` | `Dados &individuais` | `gpbDadosGerais` (Razão/Fantasia/TipoPessoa/Sexo/Nascimento/Email) + `grpEnderecoDados` (CEP, logradouro, número, complemento, bairro, cidade, UF, país, CNPJ/CPF, IE/RG, telefone/celular/fax, tipo de endereço, referência) + grid de **endereços cadastrados** | master `dtsPrincipal` (cdsParceiros) **+ endereço** `dsEnderecos`/`DtsEndParceiros` (cdsEndParceiros) |
| 2 | `tbsRelacionamento` | `&Relacionamentos` | tipo de relação, nome, doc1/doc2, telefone/celular, senha PDV do relacionamento; grid de relacionamentos | `dsRelacionamentos` (cdsRelParceiros) |
| 3 | `tbsBancos` | `&Bancos` | banco (FK→`BANCOS`, lookup F3), agência, conta, cidade/UF; grid de bancos | `dtsParceiros_Banco` (cdsParceiros_Banco) |
| 4 | `tbsFormaspgto` | `&Formas de pagamento` | formas de pgto permitidas (`cbxTODOSPGTOS` = todas); grid | `dtsParceiros_Pgto` (cdsParceiros_Pgto) |
| 5 | `tbsDadosFinanceiros` | `Dados fi&nanceiros` | crédito, juros, tolerância, dias atraso, venc.prev, desconto padrão, convênio (FK), conta corrente (FK→`CONTAS_BANCARIAS`), plano de contas cliente/fornecedor (FK), senha de autorização PDV, limite conveniados | master |
| 6 | `tbsOutros` | `O&utros` | nested `pgcOutrosFornecedor`: **tsFornecedorGeral** (cond. pgto, classificação, contábil, contrato, perfil de compra) · **tsRetencoes** (flags `HABILITA_RETENCAO_*` + alíquotas ISSQN/IR) · **tsPedidoCompra** (visualiza PC, qtde dias máx FP) | master |
| 7 | `tbsHistoricoVendas` | `Histórico de &Vendas` | período + origem (VENDAS/PEDIDOS) + grid de histórico (read-only, SQL dinâmica) | `dtsHistoricoVendas` (cdsHistoricoVendas) |
| 8 | `tbsFaturamento` | `Faturamento` | tipos de faturamento (CLIENTES_TIPOFATURAMENTO) — **visível só se empresa `SEGMENTO='INDUSTRIA'`** (BR-23) | `dtsFaturamento` (cdsFaturamento) |
| 9 | `tbsDadosFornecedor` | `Dados Fornecedor` | comprador, diretor/gerente/vendedor/responsável comercial+financeiro+logístico (nome/email/fone), prazos, contrato, pronta-entrega | master |
| 10 | `tbsAcordoComercial` | `Acordo Comercial` | nested `pgcAcordoComercial` (tbListaAcordo + tbDadosAcordo) + nested `F` (TbsObservacao + situação NF) — acordos de aluguel/compra/devolução/troca/verba, geração financeira | `dsAcordoComercial`/`dtsAcordoComercial` (cdsAcordoComercial) + `cdsArquivo`/`cdsAux_Acordo_Comercial` |
| 11 | `tbsVendedor` | `Vendedor` | (papel `FUN`) consulta de movimento do vendedor por mês/ano, comissão, saldo flex, ajuste flex | `dsVendedorMovimento` (qryVendedorMovimento) |
| 12 | `TbsVendedores` | `Vendedores` | grid `cxGrid` de vendedores vinculados ao parceiro (PARCEIROS_VENDEDORES) — adiciona via `GET_PARCEIROS` filtro `FUN='S'` | `DtsVendedores` (CdsParceirosVendedores) |
| 13 | `TabSheetCodRef_For` | `Cód. ref. fornecedor` | códigos de referência do fornecedor por produto (CODREFERENCIA_FOR) | `dtsCodReferencia_For` (cdsCodReferencia_For) |

Abas no nível `PageControlGeral` (herdado): **`tsSaldoParceiros`** (`&Histórico financeiro` — visível só se config `PERMITIR_HISTORICO='S'`, BR-22) e **`tbsFoto`** (`Foto` — biometria/foto BLOB via `imgFoto: TJvThumbImage`, tabela `ANEXOS_IMG`).

> **`tbsDadosFinanceiros.TabVisible`** é gated por config `PARCEIRO_EXIBIR_DADOS_FINANCEIROS='S'` `[.pas:L3828]` (BR-21).

### 2.2 Combos de lista fixa (Items↔Values **verbatim** `[.dfm]`)

| Combo | DataField | Items ↔ Values |
|---|---|---|
| `cbbTipoPessoa` | `TIPOFJ` | FÍSICA→`F`, JURÍDICA→`J`, RURAL→`R`, GOVERNAMENTAL→`G`, ENTIDADE→`E` |
| `cbbSexo` | `SEXO` | MASCULINO→`M`, FEMININO→`F` |
| `cmbEstado_Civil` | `ESTADO_CIVIL` | SOLTEIRO→`S`, CASADO→`C`, AMASIADO→`A`, DIVORCIADO→`D`, VIÚVO→`V` |
| `cbbContribuinteICMS` | `CONTRIBUINTE_ICMS` | 1=Contribuinte ICMS→`1`, 2=Isento de IE→`2`, 9=Não contribuinte→`9` |
| `cmbCLASSFISCAL` | `CLASSFISCAL` | ME→`ME`, LR→`LR`, SN→`SN`, LP→`LP` |
| `cmbApuracao` | `APURACAO` | Mensal→`M`, Anual→`A` |
| `cmbClassIR` | `IRRF` | (vazio)→``, IRRF retido na fonte→`I`, Funrural→`F`, Retem PISCOFINS→`R` |
| `cmbTipoTroca` | `TIPOTROCA` | Devolução→`D`, Desconto em nota→`E`, Troca→`T`, Desconto em contrato→`S` |
| `cmbTpFigura` | `CLASSIFICACAO` | Fornecedor/Atacado→`F`, Indústria→`I`, Comércio→`C`, Simples Nacional→`S` |
| `cbbTipoEndereco` | `TIPO_ENDERECO` (endereço) | Comercial / Deposito / Principal / Residencial (value = label) |
| `cmbTipoRel` | `TIPOREL` (rel.) | CÔNJUGE / CONTATO COM. / REF. PESSOAL / PAI / MÃE / IRMÃO / IRMã / AVÔ / AVÓ / TIO / TIA / FILHO(A) / AVALISTA (value=label) |
| `cmbUF` | `UF` (endereço) | 27 UFs (AC…TO), value=label |
| `JvDBComboBox1` | `UFPLACA` | 27 UFs, value=label |
| `cbbTipoValor` | `TIPOVLR` (acordo) | Percentual→`%`, Valor→`V` |

### 2.3 Checkboxes de papel — `gpbTipos` (Caption ` Tipo(s) do parceiro `) `[.dfm]`

| Componente | Caption | DataField | Checked/Unchecked |
|---|---|---|---|
| `chbCliente` | Cliente | `CLI` | S / N |
| `chbFuncionario` | Funcionário | `FUN` | S / N |
| `chbTransportadora` | Transportador | `TRA` | S / N |
| `chbFornecedor` | Fornecedor | `FRN` | S / N |
| `chbConvenio` | Convênio | `CON` | S / N |

> `gpbTipos.Enabled := False` quando a tela foi aberta por um menu de papel específico (`ControleTipoParceiro` — BR-01) — os checkboxes ficam travados e o flag do papel vem pré-marcado.

### 2.4 Campos-chave do endereço/master (bind correto — **CNPJ/IE no endereço!**) `[.dfm]`

| Componente | DataField | Máscara | Bind |
|---|---|---|---|
| `edtRazao` | `RAZAO` | — | master |
| `edtFantasia` | `FANTASIA` | — | master |
| `edtCNPJ_CPF` | `CNPJ_CPF` | **dinâmica** (CPF `!###.###.###-##` / CNPJ `!##.###.###/####-##` — BR-09) | **endereço** `cdsEndParceiros` |
| `edtIERG` | `RG_INSC` | — (validação por UF) | **endereço** |
| `mskCEP` | `CEP` | `!##.###-###;1;_` | **endereço** |
| `edtLogradouro` | `ENDERECO` | — | endereço |
| `edtNumero`/`edtComplemento`/`edtBairro`/`edtCidade` | `NUMERO`/`COMPLEMENTO`/`BAIRRO`/`CIDADE` | — | endereço |
| `cmbUF` | `UF` | — | endereço |
| `edtPais`/`edtCodPais` | `DESCPAI`/`CODPAIS` | — | endereço (derivado da UF — BR-13) |
| `edtTelefone`/`mskCelular`/`mskFax` | `TELEFONE`/`CELULAR`/`FAX` | (telefone) | endereço |
| `memObs` | `OBS` (Size 800) | — (UPPER via OnKeyPress) | master (BR-06) |
| `memECF` | `PRINTECF` | — (UPPER via OnKeyPress) | master |
| `chbATIVADO`/`chbBLOQUED`/`chkEstrangeiro` | `ATIVADO`/`BLOQUED`/`ESTRANGEIRO` | — | master |
| `imgFoto` | (BLOB `IMG` em `ANEXOS_IMG`) | — | `cdsAnexosImg` |

**Notas de reflow:** layout absoluto `Left/Top` → **não copiar pixels**. As 13 abas → componente de abas (com abas **condicionais**: Financeiro/Histórico/Faturamento gated por config/segmento). Os `TGroupBox` → `<fieldset>`. Os `TDBGrid`/`TcxGrid` de detalhe → `<DataGrid>` teclado-first ([keyboard-ux-layer.md §5](../../../02-stack-and-standards/keyboard-ux-layer.md)). O combo `TIPOFJ` dirige máscara/visibilidade (BR-08/BR-09). Controles habilitados por código (`edtSENHA`, `EdtCodTipoBloqueio`, `edtValorServico`) **constam** aqui por serem estado de UI condicional (cruzar [§3](#3-eventos)).

---

## 3. Eventos

Handlers próprios de `uCadClientes.pas`. O ciclo CRUD (gravar/editar/excluir/pesquisar/navegar/RBAC/teclado) é herdado de `TfrmCadMaster`/`TfrmCadMasterDetalhe` ([§7](#7-dependências), [form-base-cadmaster.md](../../../03-legacy-analysis/recon/form-base-cadmaster.md)). Defaults/auditoria de dataset vivem em `udmParceiros.pas` (DM).

| Componente.Evento | `.pas` | O que faz (passo a passo) | Toca SQL? | Estado externo? | Vira (alvo) |
|---|---|---|---|---|---|
| `FormCreate` | `[.pas:L3775-3829]` | `inherited`; cria `dmParceiros`; `SetaDataset(edtRazao, cdsParceiros, 'CODPARCEIRO', 'PARCEIROS')`; **`ControleTipoParceiro(True)`** (carrega `FObrigatoriosPesquisa` do papel do menu) + `ControleFlagParceiro`; monta `cdsColoracao` (BLOQUEADO='S'→VERMELHO; ENDERECO_ATIVADO='N'→ROXO; última compra >35 dias→AZUL); `ListaDetalhes` recebe os 7 detalhes; abre cdsFormasPGTO; `tbsDadosFinanceiros.TabVisible := config('PARCEIRO_EXIBIR_DADOS_FINANCEIROS')='S'` | abre datasets | cria DM; lê config | bootstrap do recurso + flags de UI |
| `FormShow` | `[.pas:L3848-3858]` | aba inicial 0; `tbsFaturamento.TabVisible := EmpresaSEGMENTO='INDUSTRIA'`; `tsSaldoParceiros.TabVisible := config('PERMITIR_HISTORICO')='S'` | — | lê segmento+config | abas condicionais |
| `FormKeyDown` | `[.pas:L3831-3846]` | **Ctrl+N** (78) → próxima aba (`SelectNextPage`); **Ctrl+A** (65) → aba Acordo; `inherited` (F3/F6/Esc do form-base) | — | — | atalhos de tela ([§8](#8-taborder--mapa-de-atalhosmnemônicos)) |
| `ControleTipoParceiro(Create)` | `[.pas:L4830-4881]` | lê `frmMenuSuperior.MenuEscolhido` (CLIENTES/FORNECEDORES/TRANSPORTADORAS/FUNCIONARIOS/CONVENIOS) → mapeia campo/filtro (`CLI`/`FRN`/`TRA`/`FUN`/`CON` = `'S'`); se papel ⇒ `gpbTipos.Enabled:=False`; se `Create` ⇒ `FObrigatoriosPesquisa := Filtro`; senão (em insert) ⇒ **pré-marca** o flag do papel | — | seta filtro de pesquisa + flag | `?papel=` na rota + WHERE obrigatório + pré-marca flag (BR-01) |
| `GetFlagParceiro` / `ControleFlagParceiro` | `[.pas:L4119-4141]` / `[.pas:L4782-4808]` | conta papéis ativos; habilita Adicionar/Editar/Excluir só se `FlagsPA > FlagsRE` (RBAC por papel via `chb*.Tag/Enabled`) | — | — | guarda de UI por papel + RBAC |
| `btnGravarClick` | `[.pas:L1997-2174]` | **toda** a validação antes do `inherited` (ver [§5](#5-regras-de-negócio): endereço obrigatório, ≥1 papel, IBGE UF×Cidade, endereço de cobrança, senhas, log SPEED0175, TLog por tabela) → `inherited` (pipeline form-base: ApplyUpdates+histórico+RBAC) | sim (IBGE + escrita) | sim ([§6](#6-efeitos-colaterais--estado-externo)) | validações no DTO/service + `POST/PUT` + replicação |
| `btnExcluirClick` | `[.pas:L1657-1670]` | se `CLI='S'` e `CODCONTABIL<>''` → `'Cliente contabilizado. Não é permitido excluir.'`; se `FRN='S'` e `CODCONTABIL_FOR<>''` → `'Fornecedor contabilizado. Não é permitido excluir.'` | — | — | guarda de exclusão (BR-17) |
| `btnAdicionarRegistroClick` | `[.pas:L980-991]` | libera `DatasetOriginal`; `inherited` (insert); cancela endereço pendente; aba 0; `ControleTipoParceiro` (pré-marca papel); `cmbTpFigura.ItemIndex:=0`; `cbxTODOSPGTOS.Checked:=True` | — | — | novo registro (Ctrl+N) |
| `btnEditarClick` | `[.pas:L1934-1960]` | backup `DatasetOriginal := cdsEndParceiros.Data` (p/ comparar SPEED0175); `inherited`; `SetaEnderecoCobranca`; `ControleTipoParceiro` | — | — | entrar em edição |
| `edtCodigoKeyDown` | `[.pas:L3200-3211]` | em insert: auto-`Insert` em `cdsEndParceiros` e `cdsRelParceiros` (nasce 1 endereço + 1 relação em branco) | — | — | seed de detalhes no novo |
| `btnPesquisaClick` | `[.pas:L2328-2333]` | flags de etiqueta; `inherited` (abre `frmPesquisa` sobre `GET_PARCEIROS` com WHERE `FObrigatoriosPesquisa`) | sim (view) | — | lista filtrada por papel |
| **`cbbTipoPessoaChange`** | `[.pas:L2703-2713]` | se não estrangeiro: máscara CPF (F/R) ou CNPJ (J/G/E) em `edtCNPJ_CPF` | — | — | máscara dinâmica (BR-08/09) |
| `edtCNPJ_CPFEnter` | `[.pas:L2922-2945]` | (não estrangeiro, campo vazio) seta máscara por TIPOFJ; `ComponenteEndereco := edtCNPJ_CPF` | — | — | onFocus máscara |
| **`edtCNPJ_CPFExit`** | `[.pas:L2947-3053]` | em insert/alteração: `VerificarCPF_CNPJExistente` (abre `SegVerificaParceiro`) → se duplicado: config `BLOQUEAR_CADASTRAR_PARCEIRO_CPF_EXISTENTE='S'` bloqueia (`'Não é permitido cadastrar parceiro com CPF/CNPJ existente em outro cadastro'`), senão pergunta + exige `SenhaAdministrativa('ADM')`; depois (não estrangeiro) `ValidaDocumento(docCPF/docCNPJ)` → `'CPF/CNPJ inválido. Verifique!'` | sim (dup) | lê config | onBlur async + validação dígito + dup configurável (BR-09/BR-19) |
| `edtCNPJ_CPFKeyUp` | `[.pas:L3055-3061]` | **F3** → `btnConsultarCPFCNPJClick` (Receita Federal) | sim (RF) | — | F3 = consulta RF |
| `btnConsultarCPFCNPJClick` | `[.pas:L1577+]` | bloqueia se `chkEstrangeiro` (`'…Impossível realizar consulta de CPF/CNPJ junto a Receita Federal.'`); senão consulta RF por máscara do TIPOFJ | sim (externo) | — | consulta RF (BR-12/BR-18) |
| `edtIERGEnter` / **`edtIERGExit`** / `edtIERGKeyUp` | `[.pas:L3539-3574]` | Enter: `ComponenteEndereco`; Exit: se CLI/FRN e `'ISENTO'`/`'ISENTA'` → limpa; se ≠FÍSICA e IE≠'' → `ValidaDocumento(docInscEst, IE, UF)`; falhou → limpa (silencioso); KeyUp **F3** → `btnSintegraClick` (SINTEGRA) | sim (SINTEGRA) | — | dígito IE por UF + ISENTO→vazio + F3 SINTEGRA (BR-10/BR-11) |
| **`cmbUFExit`** | `[.pas:L5322-5349]` | em edição do endereço: `RetornarValores('UF','SIGLA',UF,'CODPAI')` → `RetornarValores('PAIS','CODPAI',…,'DESCPAI')` → seta `CODPAIS`/`DESCPAI` (fallback 'BRASIL'); chama `edtIERGExit` | sim (UF/PAIS) | — | País derivado da UF (BR-13) |
| **`mskCEPExit`** | `[.pas:L5373-5441]` | (não no botão, em insert) auto-`TfrmConsultaCEP` (Correios); preenche CEP/ENDERECO/BAIRRO/CIDADE/UF; resolve `IDCIDADE` via IBGE e valida em `CIDADES` (`'Cod. IBGE da Cidade não está cadastrado…'`); `'Cep não encontrado'` | sim (Correios+CIDADES) | abre form externo | autofill CEP + IBGE (BR-14) |
| `mskCEPKeyUp` / `btnConsultaCEPClick` | `[.pas:L5443-5449]` / `[.pas:L1512-1575]` | **F3**/botão → `TfrmConsultaCEP` modal; bloqueia estrangeiro (`'…Impossível realizar consulta aos correios.'`) | sim | — | F3 = consulta CEP |
| `chkEstrangeiro` (efeito) | `[.pas:L1517,1583,2010,2401,2705,2926,3025,4963]` | troca obrigatórios (cidade+país≠Brasil+registro estrangeiro), **bloqueia** consultas nacionais (CEP/RF/SINTEGRA), pula máscara e dígito CPF/CNPJ | sim (PAIS) | — | modo estrangeiro (BR-15) |
| `chbFornecedorChange` / `chbFornecedorClick` | `[.pas:L5261-5276]` / `[.pas:L5278-5302]` | Change: habilita/limpa `edtSENHA`/`edtConfSENHA`; Click: ao **desmarcar FRN**, se existe `NF TIPO='E'` p/ o parceiro → reverte + `'Não é possível modificar o tipo do parceiro pois … vinculado a um registro de nota fiscal.'` | sim (NF) | — | trava de papel FRN (BR-16) |
| `chbConvenioClick` | `[.pas:L5255-5259]` | `VerificaHabilitadoValorLimiteConveniados` (habilita limite conveniados) | — | — | UI condicional |
| `chbATIVADOChange` | `[.pas:L5225-5246]` | se `FRN='S'`: busca outro parceiro **ativo** com mesmo CNPJ → se achar, reverte ATIVADO + `'Já existe fornecedor ativo com este CNPJ. Fornecedor : COD - … / FANTASIA - …'` | sim | — | CNPJ de fornecedor ativo único (BR-20) |
| `chbBLOQUEDChange` | `[.pas:L5248-5253]` | habilita `EdtCodTipoBloqueio`/`BtnBuscaTipoBloqueio` conforme bloqueado | — | — | UI condicional |
| `btnDelEndClick` / `btnSaveEndClick` | `[.pas:L1112-1140]` / `[.pas:L1334-1370]` | usa `CNPJLiberadoParaEdicao` (NF/Indexador/NFC existem? → trava); na exclusão oferece **desativar** o endereço (`UPDATE PARCEIROS_END SET ATIVADO='N', ENDERECO_PADRAO='N'`); no save, se trocou UF/CNPJ com NF emitida → bloqueia | sim | — | travas de integridade do endereço (BR-16) |
| `memObsKeyPress` / `memECFKeyPress` | `[.pas:L646]` | `Key := UpCase(Key)` (MAIÚSCULAS) | — | — | `.toUpperCase()` no zod (BR-06) |
| `btnConsHistoricoVendasClick` | `[.pas:L1467-1510]` | monta SQL **dinâmica** (VENDAS ou PEDIDOS) por período+empresa+parceiro; `cdsHistoricoVendas.CommandText := …`; `Open` (poAllowCommandText) | sim (dinâmica) | lê multi-empresa | endpoint read-only de histórico |
| `BtnAdicionarVendedoresClick` | `[.pas:L993-1020]` | `TfrmPesquisa.Pesquisa('GET_PARCEIROS', …, 'FUN=''S''')` → adiciona em `DtsVendedores` (PARCEIROS_VENDEDORES) sem duplicar | sim (view) | — | sub-recurso vendedores |
| **DM** `cdsParceirosNewRecord` | `[udmParceiros.pas:L896-911]` | defaults do novo: `ATIVADO='S'`, `BLOQUED='N'`, `TIPOFJ='F'`, **todos os papéis `='N'`**, `VISUALIZA_PC_PARC='N'`, `CLUBEFIDELIDADE='N'`, `CODPARCEIRO := GetID('CODPARCEIRO')` (sequence), `NOME`/`DESCUSOCADASTRO := operador` | — | lê operador; consome sequence | defaults do insert (BR-03) |
| **DM** `cdsParceirosBeforePost` | `[udmParceiros.pas:L875-879]` | `ULTIMA_ALTER := <operador> + ' - ' + dd/mm/yyyy hh:mm` | — | lê operador | carimbo de auditoria (BR-04) |
| **DM** `cdsEndParceirosNewRecord` | `[udmParceiros.pas:L818-823]` | `CODEND := GetID('CODEND')`; `CODPAIS := RetornaPaisDaUF` (`select distinct CODPAI from uf`); `ATIVADO := master.ATIVADO` | sim (uf) | sequence | default do endereço |
| **DM** `cdsEndParceirosBeforePost` | `[udmParceiros.pas:L806-816]` | chama `TfrmCadClientes(Owner).DadosEnderecoPreenchidos` → `Abort` se incompleto | — | acopla form↔DM | validação de endereço (BR-14) |
| **DM** `cdsEndParceirosAfterPost` / `SetaEnderecoCobranca` | `[udmParceiros.pas:L801-804,963-970]` | se há **1** endereço e `CODEND` do master nulo → `cdsParceirosCODEND := cdsEndParceirosCODEND` (carimba endereço de cobrança) | — | — | derivar endereço padrão |
| **DM** `cds*_BancoNewRecord` / `cds*_PgtoNewRecord` / `cdsRelParceirosNewRecord` / `cdsFaturamentoBeforePost`/`NewRecord` / `cdsCodReferencia_ForNewRecord` / `cdsAnexosImgNewRecord` | `[udmParceiros.pas:L919-943,837-840,795-799,772-775]` | herdam `CODPARCEIRO` do master + PK por `GetID(...)`; ATIVADO do master | — | sequences | defaults dos detalhes |

> **Achados (que "olhar a tela" perderia):**
> 1. **A mesma tela é 5 telas** — `ControleTipoParceiro` lê o menu (`frmMenuSuperior.MenuEscolhido`) e, no create, grava `FObrigatoriosPesquisa` (ex. `CLI='S'`) que o form-base injeta no WHERE da pesquisa; ao **incluir**, pré-marca o flag do papel. → no alvo: `?papel=` + filtro server-side + default de flag.
> 2. **CNPJ/CPF/IE vivem no ENDEREÇO** (`cdsEndParceiros`) — não no master. As máscaras/validações/consultas (RF/SINTEGRA/CEP) operam sobre o detalhe de endereço.
> 3. **Auditoria é dupla**: `ULTIMA_ALTER` (string “operador - data/hora”) no `BeforePost` do **app** `[udmParceiros.pas:L877]` **e** colunas reais `USULTALTERACAO`/`DTULTIMALTERACAO`/`USUCADASTRO`/`DTCADASTRO` carimbadas pelo form-base — paridade tem de reproduzir ambas.
> 4. **`btnGravarClick` chama `RegistroSPEED0175`/`RegistroSPEED0175Endereco`** comparando `DatasetOriginal` (snapshot do AfterEdit) — registro fiscal SPED de alteração de cadastro `[.pas:L2107-2110]`.

---

## 4. Dados — TODA query (a alma do dossiê)

### Q1 — `qryParceiros` (master) — `[.dfm SQL.Strings]` (`udmParceiros.dfm:L1278-1518`)
- **Origem:** `TFDQuery qryParceiros`, `Connection=dmPrincipal.FDConexao` (global) → `dspParceiros` (`Options=[poCascadeDeletes,poCascadeUpdates,poUseQuoteChar]`) → `cdsParceiros` (master dos nested).
- **Quando dispara:** abrir/editar por código (`cdsParceiros.Params['CODIGO']`).
- **SQL base (Oracle, verbatim — ~140 colunas + 16 LEFT JOIN):**
  ```sql
  SELECT P.CODPARCEIRO, P.RAZAO, P.FANTASIA, P.TIPOFJ, P.CLASSIFICACAO,
         P.DTCADASTRO, P.DTNASCIMENTO, P.EMAIL, P.CREDITO, P.OBS, P.OBS2,
         P.ATIVADO, P.BLOQUED, P.COMISSAO,
         P.CLI, P.FRN, P.FUN, P.TRA, P.CON, P.DESPESA_FIXA,
         P.VENC_PREV, P.DESCPADRAO, P.TOLERANCIA, P.TXJURO, P.CODREF, P.DTULTCOMPRA,
         P.CLASSFORNECEDOR, P.IDEMPRESA, P.PRINTECF, P.ULTIMA_ALTER, P.DIASPRAZO,
         P.ESTADO_CIVIL, P.CARGO, P.CODCONVENIO, P.SENHA,
         P.USULTALTERACAO, P.DTULTIMALTERACAO, P.USUCADASTRO,
         P.DIASFINAN, P.LIMITE_ESPECIAL, P.FIXO, P.PLACA, P.UFPLACA,
         C.RAZAO AS DESCCONVENIO, P.EMPRESATRABALHA, P.TELEFONEEMPRESA, P.TEMPOSERVICO,
         P.TODOSPGTOS, P.CARGOEMPRESA, P.RENDA, P.CODEND, P.SEXO, O.NOME,
         P.CODCONTABIL, P.CODCONTABIL_FOR, P.ENVIANFE, P.SETOR, P.REGIAO, P.CODAUX,
         P.ASS, P.CATEGORIA, P.DIAVISITA, P.ORDEMVISITA, P.PERCSALARIO,
         P.VRSEGURO, P.VREXAME, P.VRXEROX, P.VRSPC, P.VROUTROS,
         OC.NOME DESCUSOCADASTRO, P.CODCONPAGTO, CP.DESCRICAO,
         E.ENDERECO, E.BAIRRO, E.UF, E.CODPAIS, PAI.DESCPAI,
         P.CODVENDEDOR, V.FANTASIA AS NOMEVENDEDOR, P.CLASSFISCAL, P.VENCIMENTOS,
         E.ENDERECO_PADRAO, P.DESPREZA_BLOQUEIO, P.SENHA_AUTPDV,
         P.CONTRIBUINTE_ICMS, P.REALIZA_TROCA, P.OBS_TROCA, P.IRRF,
         P.CONTRATO, P.APURACAO, P.TIPOTROCA, P.CODCOMPRADOR,
         P.DIRETOR_COMERCIAL, P.EMAIL_DIRETOR_COMERCIAL, P.FONE_DIRETOR_COMERCIAL,
         P.GERENTE_COMERCIAL, ..., /* blocos comerciais/responsáveis */
         P.PRONTA_ENTREGA, P.DESCONTO_PEDIDOS, P.VALOR_ACRES_FIN,
         P.REGRAS_TABELA_FORNECEDOR, P.NUMERO_CONTRATO,
         P.PRAZO_ENTREGA, P.PRAZO_RECEBIMENTO, P.PRAZO_REPOSICAO,
         P.TIPO_FORNECEDOR, P.RETIRA_FORNINDEX, P.CODIGO_BLOQUEIO,
         P.QTDE_DIAS_MAXIMO_FP_PC, P.VISUALIZA_PC_PARC, P.POSSUI_SERVICO,
         P.VALORSERVICOFIXO, P.CODCONTA, CB.TITULAR,
         MO.DESCRICAO AS TIPO_BLOQUEIO,
         PCCLI.DESCRICAO AS DESC_PLANO_CLIENTE, PCCLI.CODIREDUZIDO AS CODIREDUZIDO_CLIENTE,
         PCFOR.DESCRICAO AS DESC_PLANO_FORNECEDOR, PCFOR.CODIREDUZIDO AS CODIREDUZIDO_FORNECEDOR,
         COALESCE(P.HABILITA_RETENCAO_PIS_NF,'N')      AS HABILITA_RETENCAO_PIS_NF,
         COALESCE(P.HABILITA_RETENCAO_COFINS_NF,'N')   AS HABILITA_RETENCAO_COFINS_NF,
         COALESCE(P.HABILITA_RETENCAO_CSLL_NF,'N')     AS HABILITA_RETENCAO_CSLL_NF,
         COALESCE(P.HABILITA_RETENCAO_IR_NF,'N')       AS HABILITA_RETENCAO_IR_NF,
         COALESCE(P.HABILITA_RETENCAO_INSS_NF,'N')     AS HABILITA_RETENCAO_INSS_NF,
         COALESCE(P.HABILITA_RETENCAO_ISSQN_NF,'N')    AS HABILITA_RETENCAO_ISSQN_NF,
         COALESCE(P.HABILITA_RETENCAO_FUNRURAL_NF,'N') AS HABILITA_RETENCAO_FUNRURAL_NF,
         P.CODPARCEIRO_ENT_ISSQN, ENT.RAZAO AS DESCPARCEIRO_ENT_ISSQN,
         COALESCE(P.PERC_ALIQUOTA_ISSQN,0) AS PERC_ALIQUOTA_ISSQN,
         COALESCE(P.PERC_ALIQUOTA_IR,0)    AS PERC_ALIQUOTA_IR,
         COALESCE(P.BASE_RETENCAO_INSS_DIF,'N') AS BASE_RETENCAO_INSS_DIF,
         P.CODPERFIL_COMPRA, P.VENDEDOR_DESC_FLEXIVEL, P.VENDEDOR_PERIODO_FLEXIVEL,
         PFOR.PERFIL AS PERFIL_FORNECEDOR, P.PAR_VALOR_LIMITE_CONVENIADOS,
         P.PUBLICIDADE_SMS, P.PUBLICIDADE_EMAIL, P.PUBLICIDADE_WHATSAPP,
         P.ID_PRECO, PC.DESCRICAO AS DESCRICAO_TABELA_PRECO,
         COALESCE(P.DEVOLUCAO_ZERA_IMPOSTO_ICMSST,'N') AS DEVOLUCAO_ZERA_IMPOSTO_ICMSST,
         P.CODPERFIL_PARCEIRO, P.CLUBEFIDELIDADE, PPAR.PERFIL PERFIL_PARCEIRO,
         P.ESTRANGEIRO, P.PAR_ALTERA_NOME_DIG_PEDIDOS
  FROM PARCEIROS P
  LEFT JOIN PARCEIROS         C   ON (P.CODCONVENIO        = C.CODPARCEIRO)
  LEFT JOIN OPERADORES        O   ON (O.CODOPERADOR        = P.USULTALTERACAO)
  LEFT JOIN OPERADORES        OC  ON (OC.CODOPERADOR       = P.USUCADASTRO)
  LEFT JOIN CONDICOES_PAGTO   CP  ON (CP.CODCONPAGTO       = P.CODCONPAGTO)
  LEFT JOIN PARCEIROS_END     E   ON (E.CODEND             = P.CODEND)          -- endereço padrão/cobrança
  LEFT JOIN PAIS              PAI ON (PAI.CODPAI           = E.CODPAIS)
  LEFT JOIN PARCEIROS         V   ON (P.CODVENDEDOR        = V.CODPARCEIRO AND V.FUN = 'S')  -- vendedor = FUN!
  LEFT JOIN CONTAS_BANCARIAS  CB  ON (CB.CODCONTA          = P.CODCONTA)
  LEFT JOIN MOTIVOS_OPERACAO  MO  ON (MO.CODMOTIVOOP       = P.CODIGO_BLOQUEIO)
  LEFT JOIN PLANO_CONTAS      PCCLI ON (PCCLI.CODPLANOCONTAS = P.CODCONTABIL)
  LEFT JOIN PLANO_CONTAS      PCFOR ON (PCFOR.CODPLANOCONTAS = P.CODCONTABIL_FOR)
  LEFT JOIN PARCEIROS         ENT ON (ENT.CODPARCEIRO      = P.CODPARCEIRO_ENT_ISSQN)
  LEFT JOIN PERFIL            PFOR ON (PFOR.CODPERFIL      = P.CODPERFIL_COMPRA)
  LEFT JOIN PERFIL            PPAR ON (PPAR.CODPERFIL      = P.CODPERFIL_PARCEIRO)
  LEFT JOIN PRECO             PC  ON (PC.ID_PRECO          = P.ID_PRECO)
  WHERE P.CODPARCEIRO = :CODIGO
  ```
- **Params:** `:CODIGO` (`ftInteger`, `ptInput`).
- **Fragmentos condicionais:** nenhum (estática). Note **`V.FUN='S'`** no JOIN do vendedor — vendedor é **funcionário**, não fornecedor.
- **ProviderFlags (DML do provider):** PK `CODPARCEIRO` (`pfInUpdate,pfInWhere,pfInKey`,Required); `RAZAO`,`ATIVADO`,`BLOQUED` Required; campos de JOIN (`DESCCONVENIO`,`NOME`,`DESCUSOCADASTRO`,`DESCRICAO`,`ENDERECO`,`BAIRRO`,`UF`,`DESCPAI`,`NOMEVENDEDOR`,`ENDERECO_PADRAO`,`TITULAR`,`TIPO_BLOQUEIO`,`DESC_PLANO_*`,`CODIREDUZIDO_*`,`DESCPARCEIRO_ENT_ISSQN`,`PERFIL_*`,`DESCRICAO_TABELA_PRECO`,`DESCPAI`) têm `ProviderFlags=[]` (read-only, não persistem). `[udmParceiros.dfm:L30-816]`
- **Mutações:** leitura (Q1) + escrita (INSERT/UPDATE/DELETE delta-based via provider) em `PARCEIROS` **e cascata** para os detalhes nested (`poCascadeDeletes/Updates`).
- **PK por SEQUENCE app-side `ID_CODPARCEIRO`** `[Oracle-dict]` — `GetID('CODPARCEIRO')` no `NewRecord`; **sem trigger BEFORE INSERT**. → PG `seq_parceiro_codparceiro`/`nextval`.
- **Replicação (escrita-fantasma):** trigger AFTER **`REM_PARCEIROS`** (`[Oracle-dict]`) enfileira em `REMESSA_SERVER`; **no UPDATE só enfileira quando `CLI='S'`**; `REM_PARCEIROSEND` p/ o endereço. Cruzar [§6](#6-efeitos-colaterais--estado-externo).
- **SQL-alvo (PG, Kysely):** `read` = `select … from parceiros p <16 left joins> where p.codparceiro=$1 and p.idempresa=<empresa>`. Oracle→PG: `COALESCE` mantém; colunas-ano `"2017".."2022"` → renomear (`valor_2017`); `BIOMETRIA`/`IMG` BLOB → `bytea`/object storage; sequence Oracle → PG. **Decisão:** podar colunas vestigiais (CNAE/SUFRAMA/CODVENDEDOR vazias no tenant — [entity-parceiros.md §7b](../../../03-legacy-analysis/recon/entity-parceiros.md)) só após survey multi-tenant.

### Q2 — Lista / Pesquisa via `GET_PARCEIROS` — `[Oracle-dict]` + `[.pas:L2328,L998]`
- **Origem:** form-base `btnPesquisaClick` abre `frmPesquisa` sobre a **VIEW `GET_PARCEIROS`** com WHERE obrigatório `FObrigatoriosPesquisa` (papel do menu). **A view NÃO filtra por papel** — o papel é aplicado pela app (BR-01). `GET_CLIENTES`/`GET_PARCEIROS_COBRANCA` existem; **`GET_FORNECEDORES` NÃO existe** `[Oracle-dict]`.
- **`GET_PARCEIROS` (recon — decodifica/calcula em SQL):**
  ```sql
  SELECT P.RAZAO, P.CODPARCEIRO, P.FANTASIA,
         CASE WHEN P.TIPOFJ='F' THEN 'FISICA' WHEN P.TIPOFJ='R' THEN 'RURAL'
              WHEN P.TIPOFJ='G' THEN 'GOVERNAMENTAL' WHEN P.TIPOFJ='J' THEN 'JURIDICA'
              WHEN P.TIPOFJ='E' THEN 'ENTIDADE' ELSE '' END,
         TRUNC(P.DTCADASTRO), TRUNC(P.DTNASCIMENTO), <idade> ...
  FROM PARCEIROS P ...
  ```
  > A view embute **regra de apresentação** (decode de flags, cálculo de idade). No alvo, subir p/ service/serializer ([business-rule-extraction.md](../../../03-legacy-analysis/business-rule-extraction.md)).
- **Fragmentos (alvo):** filtro do usuário (whitelist), `FObrigatoriosPesquisa` → `where <papel>='S'`, situação `rdgAtivo` (`ATIVADO IN ('S'|'N'|'S','N')`), limit, escopo `idempresa`.
- **Alvo:** `GET /cadastro/parceiros?papel=…&…` + `GET /cadastro/parceiros/:cod`.

### Q3 — `qryEndParceiros` (PARCEIROS_END — docs+endereço) — `[.dfm SQL.Strings]`
- **Master-detail:** `MasterFields=CODPARCEIRO`; nested em `cdsParceiros`.
- **SQL:**
  ```sql
  SELECT E.CODEND, E.CODPARCEIRO, E.ENDERECO, E.NUMERO, E.BAIRRO, E.CIDADE, E.UF,
         E.TELEFONE, E.CELULAR, E.FAX, E.CNPJ_CPF, E.RG_INSC, E.CEP, E.COMPLEMENTO,
         E.ATIVADO, E.ENDERECO_PADRAO, P.RAZAO, P.DTULTIMALTERACAO, P.TIPOFJ,
         E.IDCIDADE, E.TIPO_ENDERECO, E.REFERENCIA, E.CODPAIS, PAIS.DESCPAI
  FROM PARCEIROS_END E
       JOIN PARCEIROS P  ON (E.CODPARCEIRO = P.CODPARCEIRO)
  LEFT JOIN PAIS        ON (PAIS.CODPAI    = E.CODPAIS)
  WHERE E.CODPARCEIRO = :CODPARCEIRO
  ORDER BY ENDERECO_PADRAO DESC
  ```
- **Chave/flags:** PK `CODEND` (`pfInUpdate,pfInWhere,pfInKey`,Required) + `CODPARCEIRO` na chave. **É aqui que vivem CNPJ_CPF/RG_INSC/CEP/IDCIDADE/CODPAIS.** Trigger `REM_PARCEIROSEND`.

### Q4 — `qryRelParceiros` (PARCEIROS_REL)
```sql
SELECT CODRELACIONAMENTO, CODPARCEIRO, TIPOREL, NOME, DOC1, DOC2,
       TELEFONE, CELULAR, ENDERECO, ATIVADO, SENHA_AUTPDV
FROM PARCEIROS_REL WHERE CODPARCEIRO = :CODPARCEIRO
```

### Q5 — `sqqParceiros_Banco` (PARCEIROS_BANCOS + nome do banco)
```sql
SELECT PB.CODPARCEIRO, PB.CODPARCEIROBANCO, PB.CODBCO, PB.NRCONTA,
       B.BANCO, B.AGENCIA, B.CIDADE, B.UF
FROM PARCEIROS_BANCOS PB LEFT JOIN BANCOS B ON (B.CODBCO = PB.CODBCO)
WHERE PB.CODPARCEIRO = :CODPARCEIRO
```

### Q6 — `sqqParceiros_Pgto` (PARCEIROS_PGTO + modalidade)
```sql
SELECT P.CODPARCEIROS_PGTO, P.IDPGTO, P.CODPARCEIRO, F.MODALIDADE, ATIVADO
FROM PARCEIROS_PGTO P LEFT JOIN FORMAS_PGTO F ON (F.IDPGTO = P.IDPGTO)
WHERE (P.CODPARCEIRO = :CODPARCEIRO)
```

### Q7 — `qryFaturamento` (CLIENTES_TIPOFATURAMENTO)
```sql
SELECT CT.CODPARCEIROFATU, CT.CODPARCEIRO, CT.CODTIPOFATU, T.IDPGTO,
       T.DESCRICAO AS DESC_TIPFATU, T.CODCONPAGTO, F.MODALIDADE,
       C.descricao AS DESC_CONDPGTO
FROM CLIENTES_TIPOFATURAMENTO CT
LEFT JOIN TIPOFATURAMENTO T ON (T.CODTIPOFATU = CT.CODTIPOFATU)
LEFT JOIN CONDICOES_PAGTO C ON (C.CODCONPAGTO = T.CODCONPAGTO)
LEFT JOIN FORMAS_PGTO     F ON (F.IDPGTO      = T.IDPGTO)
WHERE CT.CODPARCEIRO = :CODPARCEIRO
```

### Q8 — `sqqCodReferencia_For` (CODREFERENCIA_FOR + produto)
```sql
SELECT F.CODREFERENCIA_FOR, F.IDPRODUTO, F.CODREF, F.CODFOR, P.CODBARRA, P.DESCRICAO
FROM CODREFERENCIA_FOR F LEFT JOIN PRODUTOS P ON (P.IDPRODUTO = F.IDPRODUTO)
WHERE F.CODFOR = :CODPARCEIRO
```

### Q9 — `QryParceirosVendedores` (PARCEIROS_VENDEDORES)
```sql
SELECT P.CODPARCEIRO, P.CODPARCEIRO_VENDEDOR, PV.FANTASIA
FROM PARCEIROS_VENDEDORES P JOIN PARCEIROS PV ON PV.CODPARCEIRO = P.CODPARCEIRO_VENDEDOR
WHERE P.CODPARCEIRO = :CODPARCEIRO
```

### Q10 — `sqqAnexosImg` (BLOB foto/biometria)
```sql
SELECT * FROM ANEXOS_IMG A WHERE A.CODPARCEIRO = :CODPARCEIRO
```

### Q11 — `cdsHistoricoVendas` (DINÂMICA, `poAllowCommandText`) — `[.pas:L1497-1505 montada]`
- Montada em `btnConsHistoricoVendasClick` por `case RGorigemHistoricoVendas.ItemIndex` (0=VENDAS / 1=PEDIDOS), com `BancoExecutando.FormataCastData`, período (`edtData1`/`edtData2`), `P.codparceiro`, e `V.IDEMPRESA IN (<GetMultiEmpresa>)`. Read-only. **`[inferido até runtime]`** quanto à forma final por banco.

### Q12 — `cdsSaldoParceiros` / `sqqDescSaldo` (saldos — UNION ARECEBER/APAGAR/CHEQUE/ADIANTAMENTO_FORN) — `[.dfm SQL.Strings]`
- UNION pesada com cálculo de juros/atraso/tolerância (`CURRENT_DATE`/`TRUNC`/`CAST`), `WHERE …CODPARCEIRO=:CODPARCEIRO`. **Somente leitura** (update options off). Aba "Histórico financeiro" (gated `PERMITIR_HISTORICO`). (SQL completa capturada na recon — reconstruir no plano; não é caminho de escrita.)

### Q13 — Acordos comerciais — `sqqAcordoComercial` + `qryAux_Acordo_Comercial` + `sqqArquivo`/`sqqBuscaAnexos` — `[.dfm SQL.Strings]`
```sql
-- sqqAcordoComercial (nested em cdsParceiros):
SELECT A.idacordo, A.idempresa, A.nome, A.contratado, A.razaosocial, A.cnpj, A.replegal,
       A.nracordo, A.tipoacordo, A.dtinicio, A.dtfim, A.vracordo, A.dtvencto, A.duplicata,
       A.bonificacao, A.deposito, A.outros, A.codparceiro, A.tipovlr,
       A.FLG_FORMA_DEVOLUCAO, A.NDIAS, A.COD_SIT_DOC, S.DESCRICAO SITUACAO_NF,
       A.FLG_FIN_ALUGUEL_GERADO, A.FLG_TIPO_ACORDO, A.FLG_CONFIG_VENCTO, A.FLG_FORMA_TROCA,
       A.CODPLC, CC.DESCRICAO CENTRO_CUSTO, CC.DESCCODPLC, A.FLG_FIN_VERBA_GERADO, A.FLG_OPERACAO_ACORDO
FROM acordo_comercial A
LEFT JOIN PARCEIROS   P ON (A.codparceiro = P.codparceiro)
LEFT JOIN SITUACAO_NF S ON  S.IDSITUACAO_NF = A.COD_SIT_DOC
LEFT JOIN PLC        CC ON  CC.CODPLC = A.CODPLC
WHERE P.CODPARCEIRO = :CODPARCEIRO AND COALESCE(A.INDR,'I') <> 'E'   -- soft-delete por INDR
ORDER BY idacordo
```
Acordo gera financeiro (APAGAR/ARECEBER) e arquivos (`ARQUIVO_ACORDO`); PKs por `GetID('IDACORDO'/'NUMERO_ACORDO'/'AUXACORDO')`.

### Q-aux — lookups (`frmPesquisa` sobre views `GET_*`) `[.pas]`
`GET_BANCOS`, `GET_CONTAS_BANCARIAS` (com JOIN `CONTAS_BANCARIAS_OP O.CODOPERADOR=<op>`), `GET_CONDICOES_PAGTO`, `GET_PRODUTOS`, `GET_PRECO`, `GET_MOTIVOS_OPERACAO` (`TIPO_OPERACAO='CLI_BLOQUEADO'`), `GET_SITUACAO_NF` (`TIPO_OPERACAO IN ('F04','F05')`), `GET_PARCEIROS` (vendedor `FUN='S'`; entidade ISSQN), `GET_PLANO_CONTAS`, `GET_PERFIL`, `GET_CENTROCUSTO`, `GET_CIDADES`/`CIDADES`/`UF`/`PAIS`.

### Queries inline (em `.pas`, escritas/checagens) `[.pas]`
- `chbFornecedorClick` → `SELECT CODNF FROM NF WHERE TIPO='E' AND CODPARCEIRO=<cod> AND ROWNUM=1` (BR-16).
- `chbATIVADOChange` → `SELECT P.CODPARCEIRO,P.FANTASIA FROM PARCEIROS P LEFT JOIN PARCEIROS_END PE … WHERE CNPJ_CPF=<cpf> AND P.ATIVADO='S'` (BR-20).
- `CNPJLiberadoParaEdicao` → `SELECT SUM(QTD) FROM (NF por CODPARCEIRO_END UNION INDEXADOR_TRIBUTARIO por CNPJ ativo UNION NFC por CODPARCEIRO_END)` (BR-16).
- `btnDelEndClick` → `UPDATE PARCEIROS_END SET ATIVADO='N', ENDERECO_PADRAO='N' WHERE CODEND=<x>` (desativar em vez de excluir).
- `GetCNPJCPFParceiro` → `SELECT CNPJ_CPF, CODEND FROM PARCEIROS_END WHERE CODPARCEIRO=<x> AND COALESCE(ATIVADO,'S')='S' AND ROWNUM=1`.
- `DadosEnderecoPreenchidos.PaisBrasil` → `SELECT CODPAIS_SEFAZ FROM PAIS WHERE CODPAI=<x>` (1058=Brasil).
- `RetornaPaisDaUF` (DM) → `select distinct(CODPAI) from uf`.

> **Regra de ouro:** Q1 e os nested (Q3–Q10, Q13) são **estáticos e confiáveis** (idênticos ao `.dfm`). O **pipeline de escrita** (provider delta + cascata), o **carimbo de auditoria** (`ULTIMA_ALTER` + `USULT*`/`DTULT*`), a **forma final de Q11/Q2** e o **enfileiramento `REM_PARCEIROS`/`REM_PARCEIROSEND`** são `[inferido]` — herdam a forma capturada no piloto Bancos, mas **NÃO foram vistos rodando para esta tela**. Não declarar paridade sem captura V$SQL. ✅ Confirmado: estrutura/tipos/JOINs, `V.FUN='S'`, CNPJ/IE em `PARCEIROS_END`, sequence `ID_CODPARCEIRO` sem trigger, `GET_PARCEIROS` sem filtro de papel, mapa dos combos.

---

## 5. Regras de negócio (o *porquê*)

| ID | Regra | Gatilho | Lógica (verbatim) | *Porquê* | Procedência |
|---|---|---|---|---|---|
| BR-01 | **Tela parametrizada por papel** | abrir por menu / criar | `ControleTipoParceiro`: menu→campo (CLI/FRN/TRA/FUN/CON='S'); create⇒`FObrigatoriosPesquisa:=Filtro`; insert⇒pré-marca flag; trava `gpbTipos` | uma tela serve 5 cadastros; a pesquisa só mostra o papel certo; o novo já nasce com o papel | `[.pas:L4830-4881]` |
| BR-02 | **≥1 papel obrigatório no gravar** | `btnGravar` | se `CLI=FUN=TRA=FRN=CON='N'` → `'Preenchimento do tipo de parceiro é obrigatório. Verifique!'` + `Exit` | parceiro sem papel é registro sem sentido | `[.pas:L2019-2028]` |
| BR-03 | **Defaults do novo parceiro** | novo (DM) | `ATIVADO='S'`,`BLOQUED='N'`,`TIPOFJ='F'`, papéis `='N'`,`VISUALIZA_PC_PARC='N'`,`CLUBEFIDELIDADE='N'`,`CODPARCEIRO:=GetID`,`NOME/DESCUSOCADASTRO:=operador` | estado inicial consistente; PK por sequence app-side | `[udmParceiros.pas:L896-911]` |
| BR-04 | **Auditoria `ULTIMA_ALTER` (string)** | BeforePost (DM) | `ULTIMA_ALTER := <operador> + ' - ' + dd/mm/yyyy hh:mm` | trilha de auditoria legível (além das colunas `USULT*`/`DTULT*` do form-base) | `[udmParceiros.pas:L875-879]` + `[Oracle-dict]` |
| BR-05 | **Endereço obrigatório (exceto ENTIDADE)** | `btnGravar` | se `cdsEndParceiros` vazio e **não ENTIDADE** → `'Preenchimento dos dados de endereço obrigatórios. Verifique!'` + `Exit` | NF/cobrança exigem endereço; ENTIDADE dispensa | `[.pas:L2013-2017]` |
| BR-06 | **OBS/PRINTECF em MAIÚSCULAS** | digitação | `Key := UpCase(Key)` | padronização | `[.pas:L646 mem*KeyPress]` |
| BR-07 | **Vendedor = FUN** (não fornecedor) | leitura/lookup | JOIN `V.FUN='S'`; `BtnAdicionarVendedores` filtra `GET_PARCEIROS` por `FUN='S'` | vendedor é funcionário; erro clássico confundir com fornecedor | `[.dfm:L1483-1484]` + `[.pas:L1019]` |
| BR-08 | **TIPOFJ domínio F/J/R/G/E (+ sujeira)** | combo / migração | `cbbTipoPessoa` Items↔Values; dados reais têm 2 nulos e 1 `'L'` | tipo de pessoa dirige máscara/validação; domínio **não é fechado** nos dados | `[.dfm cbbTipoPessoa]` + `[entity-parceiros.md §7b]` |
| BR-09 | **Máscara CPF/CNPJ dinâmica + dígito + duplicidade** | `cbbTipoPessoaChange`/`edtCNPJ_CPFEnter/Exit` | F/R→máscara CPF, J/G/E→CNPJ; `ValidaDocumento(docCPF/docCNPJ)`→`'CPF/CNPJ inválido. Verifique!'`; dup via `SegVerificaParceiro` | documento válido; evitar duplicata | `[.pas:L2703-2713,2922-3053]` |
| BR-10 | **IE: 'ISENTO'→vazio + dígito por UF** | `edtIERGExit` | se CLI/FRN e `'ISENTO'/'ISENTA'` → limpa; ≠FÍSICA e IE≠'' → `ValidaDocumento(docInscEst,IE,UF)`; falhou→limpa | IE válida por UF; isento não guarda lixo | `[.pas:L3545-3566]` |
| BR-11 | **F3 em IE = SINTEGRA** | `edtIERGKeyUp` | F3 → `btnSintegraClick` (bloqueia estrangeiro) | consulta cadastral estadual | `[.pas:L3568-3574,L2401]` |
| BR-12 | **F3 em CNPJ/CPF = Receita Federal** | `edtCNPJ_CPFKeyUp` | F3 → `btnConsultarCPFCNPJClick` (bloqueia estrangeiro) | preencher cadastro pela RF | `[.pas:L3055-3061,L1583]` |
| BR-13 | **País derivado da UF** | `cmbUFExit` | `UF.SIGLA→CODPAI→PAIS.DESCPAI`; seta `CODPAIS/DESCPAI` (fallback 'BRASIL') | país coerente com UF sem digitação | `[.pas:L5322-5349]` |
| BR-14 | **CEP autofill + IBGE; endereço completo** | `mskCEPExit`/`DadosEnderecoPreenchidos` | Correios → CEP/logradouro/bairro/cidade/UF + `IDCIDADE` validado em `CIDADES` (`'Cod. IBGE da Cidade não está cadastrado…'`); completude por campos (nacional: logradouro/bairro/CEP/cidade/UF/país; estrangeiro: cidade/país≠Brasil/registro) | endereço fiscalmente válido (IBGE) | `[.pas:L5373-5441,L4942-5074]` |
| BR-15 | **Estrangeiro: troca obrigatórios + bloqueia consultas** | `chkEstrangeiro` | bloqueia CEP/RF/SINTEGRA; país ≠ Brasil (CODPAIS_SEFAZ≠1058); pula máscara/dígito; `'Para parceiros estrangeiros, o país não pode ser o Brasil. Verifique!'` | parceiro fora do BR não tem CEP/CPF nacional | `[.pas:L1517,1583,2401,4963]` |
| BR-16 | **Travas de integridade do endereço/FRN (NF/Indexador)** | salvar/excluir endereço; desmarcar FRN | `CNPJLiberadoParaEdicao` (NF/INDEXADOR_TRIBUTARIO/NFC) → não edita UF/CNPJ nem exclui (`'…existem registros de Notas Fiscais ou Indexador Tributário…'`); FRN com `NF TIPO='E'` não perde o tipo (`'Não é possível modificar o tipo do parceiro pois … vinculado a … nota fiscal.'`); oferece **desativar** endereço | imutabilidade fiscal após emissão | `[.pas:L4707-4743,1112-1140,1334-1370,5278-5302]` |
| BR-17 | **Não excluir parceiro contabilizado** | `btnExcluir` | CLI+`CODCONTABIL≠''`→`'Cliente contabilizado. Não é permitido excluir.'`; FRN+`CODCONTABIL_FOR≠''`→`'Fornecedor contabilizado. Não é permitido excluir.'` | integridade contábil | `[.pas:L1657-1670]` |
| BR-18 | **Senhas (fornecedor + autorização PDV)** | `btnGravar` | se FRN e `edtSENHA≠edtConfSENHA`→`'Senha para acesso do fornecedor não confere. Verifique!'`; PDV: confere + `Length=6` (`'…deve conter 6 caracteres…'`); grava encriptada (`encSenha`) | acesso/autorização seguros | `[.pas:L2060-2096]` |
| BR-19 | **Bloquear CPF/CNPJ existente (config)** | `edtCNPJ_CPFExit` | `BLOQUEAR_CADASTRAR_PARCEIRO_CPF_EXISTENTE='S'`→bloqueia (`'Não é permitido cadastrar parceiro com CPF/CNPJ existente em outro cadastro'`); senão pergunta + `SenhaAdministrativa('ADM')` | política por sessão/empresa | `[.pas:L2951-2953]` |
| BR-20 | **CNPJ de fornecedor ativo único** | `chbATIVADOChange` | FRN ativo com mesmo CNPJ → reverte + `'Já existe fornecedor ativo com este CNPJ. Fornecedor : COD - … / FANTASIA - …'` | não duplicar fornecedor ativo | `[.pas:L5225-5246]` |
| BR-21 | **Aba Financeiro condicional (config)** | FormCreate | `tbsDadosFinanceiros.TabVisible := config('PARCEIRO_EXIBIR_DADOS_FINANCEIROS')='S'` | nem todo perfil vê dados financeiros | `[.pas:L3828]` |
| BR-22 | **Aba Histórico financeiro condicional (config)** | FormShow | `tsSaldoParceiros.TabVisible := config('PERMITIR_HISTORICO')='S'` | controle de exibição de saldos | `[.pas:L3857]` |
| BR-23 | **Aba Faturamento só p/ INDÚSTRIA** | FormShow | `tbsFaturamento.TabVisible := EmpresaSEGMENTO='INDUSTRIA'` | faturamento só faz sentido na indústria | `[.pas:L3854]` |
| BR-24 | **IBGE: UF×Cidade conferem no gravar** | `btnGravar` | `RetornarValores('UF',…)`+`RetornarValores('CIDADES','IDCIDADE;IDUF',…)`; falhou → `'Cidade e UF não conferem com a tabela do IBGE. Verifique'` | consistência IBGE p/ NF | `[.pas:L2042-2051]` |
| BR-25 | **Endereço de cobrança p/ boleto** | `btnGravar` / `SetaEnderecoCobranca` | se `CODEND<=0` (nacional) pergunta `'Endereço de cobrança não informado. … Deseja marcar este endereço como o de cobrança?'`; com 1 endereço, deriva `CODEND` | boleto precisa de endereço de cobrança | `[.pas:L2053-2057]` + `[udmParceiros.pas:L963-970]` |
| BR-26 | **Validação CPF/CNPJ vazio (config 4-vias)** | `DadosEnderecoPreenchidos` | `VALIDA_CPF_CNPJ_VAZIO`: `N`=opcional; `C`=CPF p/ F/R; `J`=CNPJ p/ J/G; `A`=ambos | exigência fiscal configurável | `[.pas:L4991,5053]` |
| BR-27 | **Soft-delete por INDR onde existe** | excluir (form-base) / acordo | form-base: `INDR='E'` se a tabela tem `INDR`, senão DELETE físico; `sqqAcordoComercial` filtra `COALESCE(INDR,'I')<>'E'` | exclusão lógica fiscal | `[form-base-cadmaster.md]` + `[.dfm sqqAcordoComercial]` |

> **Cálculos:** não há cálculo fiscal **dentro** desta tela (os dados de retenção/alíquota são **insumos** consumidos pela NF). O risco fiscal-coroa aqui é **fidelidade dos dados** (CNPJ/IE/IBGE, flags de retenção, plano de contas) — divergência reprova a NF a jusante.

---

## 6. Efeitos colaterais + estado externo

> A seção que salva da armadilha de acoplamento ([hidden-coupling-traps.md](../../../03-legacy-analysis/hidden-coupling-traps.md)).

| Item | Tipo | Alvo | Quem setou / consome | Mapeamento alvo |
|---|---|---|---|---|
| `dmPrincipal.FDConexao` | usa | conexão Oracle **global** | boot | conexão **por tenant** request-scoped |
| `dmPrincipal.EmpresaCODEMPRESA` | lê | empresa logada | login | `currentTenant().empresaId` (carimba `IDEMPRESA`) |
| `dmPrincipal.OperadorCODOPERADOR/NOMEOPERADOR` | lê | operador logado | login | contexto p/ auditoria (`ULTIMA_ALTER`, `USULT*`) |
| `dmPrincipal.EmpresaSEGMENTO` | lê | segmento da empresa | login | flag de empresa → aba Faturamento (BR-23) |
| `dmPrincipal.Sessao.ValorConfiguracao(...)` | lê | configs de sessão | configuração | flags de feature (BR-19/21/22/26) |
| `frmMenuSuperior.MenuEscolhido` | lê | papel do menu | navegação | `?papel=` na rota (BR-01) |
| `dmPrincipal.GetID(<seq>)` | grava (consome) | sequences (`CODPARCEIRO`,`CODEND`,`CODRELACIONAMENTO`,`CODPARCEIROBANCO`,`CODPARCEIROS_PGTO`,`CODPARCEIROFATU`,`CODREFERENCIA_FOR`,`CODANEXOSIMG`,`IDACORDO`,`NUMERO_ACORDO`,`AUXACORDO`) | NewRecord dos cds | `nextval` por entidade |
| `USULTALTERACAO`/`DTULTIMALTERACAO`/`USUCADASTRO`/`DTCADASTRO` | grava | colunas **reais** de `PARCEIROS` | form-base `SetaOperadorAlteracao` | `stamp()` do engine |
| `ULTIMA_ALTER` | grava | coluna `PARCEIROS` | `BeforePost` (DM) | string de auditoria (replicar formato) |
| **trigger `REM_PARCEIROS`** | grava (indireto) | fila `REMESSA_SERVER` | AFTER ins/upd; **UPDATE só enfileira se `CLI='S'`** | **outbox de sync** (`replica:true`, com a condição CLI no UPDATE) `[Oracle-dict]` |
| **trigger `REM_PARCEIROSEND`** | grava (indireto) | `REMESSA_SERVER` | AFTER em `PARCEIROS_END` | outbox do endereço |
| `HISTORICO_DINAMICO` | grava (indireto) | tabela de histórico | `SetaHistorico_Dinamico` (form-base) | `gravarHistorico` do engine |
| `TLog.GravaLog` (por tabela) | grava | log de aplicação | `btnGravar` (PARCEIROS/END/REL/BANCOS) | logging estruturado |
| `RegistroSPEED0175`/`...Endereco` | grava | registro SPED 0175 (alteração de cadastro) | `btnGravar` comparando `DatasetOriginal` | gerar delta fiscal de alteração |
| `CONTAS_BANCARIAS`/`BANCOS`/`PLANO_CONTAS`/`PERFIL`/`PRECO`/`CIDADES`/`UF`/`PAIS`/`CONDICOES_PAGTO`/`MOTIVOS_OPERACAO`/`SITUACAO_NF` | lê | tabelas FK/lookup | LEFT JOIN / `RetornarValores` / `frmPesquisa` | FK + views JOIN |
| `NF`/`NFC`/`INDEXADOR_TRIBUTARIO` | lê | travas de integridade fiscal | BR-16 | checagens server-side |
| `frmConsultaCEP`/Receita Federal/SINTEGRA | usa | integrações externas | F3/botões | serviços externos (com bloqueio estrangeiro) |

- **Conexão/transação:** conexão global `dmPrincipal`; no alvo, a gravação (master + 7 detalhes + auditoria + histórico + SPED + outbox) roda em **uma transação** escopada por tenant. **`poCascadeDeletes/Updates`** no provider master ⇒ excluir/atualizar parceiro **cascateia** para os detalhes — replicar atomicamente.
- **Ordem de abertura assumida:** login + empresa + operador + **menu de papel** (`MenuEscolhido`). Sem empresa, `IDEMPRESA` não carimba; sem menu, `gpbTipos` fica livre. Vira tenant context + parâmetro de rota.

> **Diferenças que mais importam:** (1) **replica de verdade** — `REM_PARCEIROS`/`REM_PARCEIROSEND` enfileiram em `REMESSA_SERVER` (a entidade que **mais** replica); a condição `CLI='S'` no UPDATE precisa ser fiel no outbox. (2) **cascata master→7 detalhes** numa transação. (3) **auditoria dupla** (`ULTIMA_ALTER` + colunas reais). (4) **SPED 0175** ao alterar cadastro — escrita-fantasma fiscal.

---

## 7. Dependências

| Dependência | Tipo | Como é usada | Vira (alvo) |
|---|---|---|---|
| `TfrmCadMasterDetalhe` (→ `TfrmCadMaster`) | **herança** | CRUD mestre-detalhe: gravar/editar/excluir/pesquisar/navegar, `ValidaObrigatorios`, RBAC `PossuiAcessoForm`, histórico, log, carimbo, teclado (F3/F6/Esc), `ListaDetalhes`, `SetaDataset`, `FObrigatoriosPesquisa`/`FCampoAtivo`/`FValorAtivo`/`rdgAtivo`, view `GET_*`, soft-delete `INDR` | **engine CRUD reutilizável** + `AggregateConfig` por detalhe ([form-base-cadmaster.md](../../../03-legacy-analysis/recon/form-base-cadmaster.md)) |
| `TdmParceiros` (`udmParceiros`) | datamodule | master `qryParceiros`→`dspParceiros`→`cdsParceiros` + 7 nested (END/REL/BANCOS/PGTO/CODREF_FOR/FATURAMENTO/VENDEDORES/ANEXOS/ACORDO); hospeda defaults/auditoria/`SetaEnderecoCobranca`/`RetornaPaisDaUF` | `CrudConfig` + `AggregateConfig` (sem estado) |
| `udmPrincipal` (`dmPrincipal`) | datamodule global | conexão, empresa, operador, segmento, configs, `GetID`, `RetornarValores`, `ShowPesquisa`, `SenhaAdministrativa`, `encSenha`, `GetMultiEmpresa`, `aqqTemp1` | tenant context + providers + serviços |
| `uPesquisa` (`frmPesquisa`/`TfrmPesquisa.Pesquisa`) | form modal | lookups F3 sobre `GET_*` | `<SelectField>`/modal de busca |
| `uConsultaCEP` (`TfrmConsultaCEP`) | form modal + ACBrCEP | autofill de CEP (Correios) + IBGE | serviço de CEP (bloqueado p/ estrangeiro) |
| `uConsultaCPFCNPJ` / SINTEGRA | integração | consulta RF / SINTEGRA (F3) | serviços externos |
| `FuncoesApollo` (`RetornarValores`,`Mensagem`,`SetaFoco`,`ConsultaSQL`,`ValidaDocumento`,`ApenasNumero`,`iif`) | unit utilitária | validações/lookups/helpers | helpers/serviços |
| `BO.Parceiros`/`BO.HistoricoFlex`/`BO.Perfil` | business objects | `ExisteParceiro`, saldo flex, perfil | services de domínio |
| `uLog`/`uRegistrosLog` (`TLog.GravaLog`) | log | log por operação/tabela | logging estruturado |
| `JvDBComboBox`/cxGrid/FastReport (`frx*`)/JvThumbImage | libs | combos, grids, relatórios (ficha cadastral, extrato, cartão), foto BLOB | `<SelectField>`/`<DataGrid>`/export server-side/upload |
| `CONTAS_BANCARIAS`/`BANCOS`/`PLANO_CONTAS`/`PERFIL`/`PRECO`/`CIDADES`/`PAIS`/`UF`/`CONDICOES_PAGTO`/`MOTIVOS_OPERACAO`/`SITUACAO_NF` | tabelas FK | JOINs/lookups | FK + views |
| `NF`/`NFC`/`INDEXADOR_TRIBUTARIO` | tabelas (travas) | integridade fiscal (BR-16) | checagens |
| **Stubs mortos** `uCadFornecedores`/`uCadParceiros` | — | **não usados** (fora do build) | ignorar |

---

## 8. TabOrder + mapa de atalhos/mnemônicos

> Extraído do `.dfm` ([keyboard-ux-layer.md §6](../../../02-stack-and-standards/keyboard-ux-layer.md)). Memória muscular é critério de aceite (ADR-010).

**Foco inicial:** `edtRazao` (via `SetaDataset(edtRazao,…)` `[.pas:L3800]`). A taborder da 1ª aba segue: Razão → Fantasia → TipoPessoa → … → grupo de endereço (CEP→logradouro→número→complemento→bairro→cidade→UF→país→CNPJ/CPF→IE/RG→telefone/celular/fax). **Extrair a sequência exata `TabOrder` por aba via parser do `.dfm`** (pendência — é dado, não digitado à mão).

**Mnemônicos `&` (abas/ações):** abas têm `&` no caption (`Dados &individuais`, `&Relacionamentos`, `&Bancos`, `&Formas de pagamento`, `Dados fi&nanceiros`, `O&utros`, `Histórico de &Vendas`, `&Histórico financeiro`); ações do rodapé herdadas (`&Gravar`/`&Editar`/E`&`xcluir/`&Adicionar`/`&Cancelar`/`&Sair`). Os **campos** em geral **não** têm `&` (oportunidade de melhoria no alvo, divergência benigna).

**Atalhos (F-keys/Ctrl):**

| Atalho | Ação | Origem | Escopo | Reservado pelo browser? |
|---|---|---|---|---|
| `Ctrl+N` | próxima aba (`SelectNextPage`) | `FormKeyDown` `[.pas:L3835]` | tela | não |
| `Ctrl+A` | abre aba Acordo Comercial | `FormKeyDown` `[.pas:L3841]` | tela | não |
| `F3` (em CNPJ/CPF) | consulta **Receita Federal** | `edtCNPJ_CPFKeyUp` `[.pas:L3055]` | campo | não |
| `F3` (em IE/RG) | consulta **SINTEGRA** | `edtIERGKeyUp` `[.pas:L3568]` | campo | não |
| `F3` (em CEP) | consulta **CEP** (Correios) | `mskCEPKeyUp` `[.pas:L5443]` | campo | não |
| `F3` (em códigos/lookups) | abre `frmPesquisa` (banco/cidade/conta/produto/perfil/PLC/…) | vários `*KeyUp`/`*KeyDown` | campo | não |
| `F3` (em `edtCodigo`) | abre Pesquisa (`GET_PARCEIROS` + papel) | form-base | tela | não |
| `F6` | filtro situação (ativo/inativo/todos, `rdgAtivo`) | form-base | tela | não |
| `Enter`/setas (em `edtCodigo`) | carregar por código / navegar | form-base | tela | não |
| `Esc` | cancelar/sair (bloqueado em insert/edit pelo form-base) | form-base | tela | não |

---

## 9. Casos de teste (golden) — capturados do legado

> ⚠️ **PENDÊNCIA RUNTIME — NÃO HÁ GOLDEN CAPTURADO AINDA.** A recon foi **estática** (`.pas`/`.dfm`/DM) + **dicionário Oracle read-only** (validado em `pinheirao@dbhomologacao`, 18.295 parceiros — [entity-parceiros.md §7b](../../../03-legacy-analysis/recon/entity-parceiros.md)). Para `paridade-verde`/`concluído` é obrigatório **capturar V$SQL + REMESSA_SERVER** com o ERP legado rodando ([dynamic-sql-extraction.md](../../../03-legacy-analysis/dynamic-sql-extraction.md)). Cobertura derivada das [§4](#4-dados--toda-query-a-alma-do-dossiê)/[§5](#5-regras-de-negócio): cada caminho condicional e cada BR precisa de ≥1 caso.

**Casos a capturar (mínimo):**

| ID | Cobre (BR/Q) | Input (estado + campos) | Ação | Output esperado a capturar | SQL/efeito a observar |
|---|---|---|---|---|---|
| G-01 | BR-01 / Q2 | abrir via menu CLIENTES, pesquisar | listar | só `CLI='S'`; SQL com WHERE `CLI='S'` | `GET_PARCEIROS` + `FObrigatoriosPesquisa` |
| G-02 | BR-01 / BR-03 | abrir via FORNECEDORES, novo | incluir | `FRN` pré-marcado='S'; `gpbTipos` travado; defaults (`ATIVADO='S'`,`TIPOFJ='F'`) | `NewRecord` + sequence `CODPARCEIRO` |
| G-03 | BR-02 | novo sem nenhum papel | gravar | `'Preenchimento do tipo de parceiro é obrigatório. Verifique!'`; zero DML | — |
| G-04 | BR-05/BR-14/BR-24 | novo sem endereço (não ENTIDADE) | gravar | `'Preenchimento dos dados de endereço obrigatórios…'`; depois IBGE UF×Cidade | `RetornarValores` UF/CIDADES |
| G-05 | BR-09 | TIPOFJ=FÍSICA, CPF inválido | sair do campo | `'CPF inválido. Verifique!'`; máscara CPF | `ValidaDocumento(docCPF)` |
| G-06 | BR-09/BR-19 | CPF já existente, config 'S' | sair do campo | `'Não é permitido cadastrar parceiro com CPF/CNPJ existente em outro cadastro'` | `SegVerificaParceiro` |
| G-07 | BR-10 | IE='ISENTO' (CLI) | sair | IE vira vazio | — |
| G-08 | BR-13 | UF=SP | sair da UF | `CODPAIS/DESCPAI`=Brasil | UF→PAIS lookups |
| G-09 | BR-15 | estrangeiro + país=Brasil | gravar | `'Para parceiros estrangeiros, o país não pode ser o Brasil. Verifique!'` | `PaisBrasil` (CODPAIS_SEFAZ=1058) |
| G-10 | BR-16 | desmarcar FRN com NF TIPO='E' | clicar | reverte + `'…vinculado a um registro de nota fiscal.'` | `SELECT CODNF FROM NF…` |
| G-11 | BR-16 | excluir endereço com NF/Indexador | excluir | oferece desativar; `UPDATE PARCEIROS_END SET ATIVADO='N',ENDERECO_PADRAO='N'` | `CNPJLiberadoParaEdicao` |
| G-12 | BR-17 | excluir CLI contabilizado | excluir | `'Cliente contabilizado. Não é permitido excluir.'` | — |
| G-13 | BR-20 | ativar FRN com CNPJ de outro ativo | toggle | `'Já existe fornecedor ativo com este CNPJ…'` | `SELECT P.CODPARCEIRO,FANTASIA…` |
| G-14 | Q1 + escrita | gravar parceiro novo CLI | gravar | INSERT delta + `ULTIMA_ALTER` + `USULT*`/`DTCADASTRO`; **`REM_PARCEIROS` enfileira** | V$SQL + REMESSA_SERVER |
| G-15 | §6 replicação | editar parceiro **sem** `CLI='S'` | gravar | UPDATE **NÃO** enfileira em REMESSA (só com CLI='S') | REMESSA_SERVER vazio p/ esse update |
| G-16 | Q3 cascata | salvar com endereço novo | gravar | INSERT `PARCEIROS_END` + `REM_PARCEIROSEND`; `CODEND` deriva cobrança | V$SQL + REMESSA |
| G-17 | BR-21/22/23 | configs/segmento variados | abrir | abas Financeiro/Histórico/Faturamento visíveis ou não | leitura de config/segmento |

---

## 10. Alvo (a especificação de implementação)

> **RECOMENDAÇÃO ANCORADA NOS DADOS:** **tela UNIFICADA** com flags de papel + **abas condicionais** — fiel ao legado e **decidida pelos dados** (57% dos parceiros acumulam >1 papel — separar em Cliente/Fornecedor contradiz 10k+ registros, [entity-parceiros.md §6/§7b](../../../03-legacy-analysis/recon/entity-parceiros.md)). Party único; papéis como flags tipadas; endereço como **detalhe de 1ª classe**; demais detalhes opcionais.

**Backend (NestJS + Kysely — engine CRUD declarativo):**
- Módulo: `cadastro`. Recurso **`parceiros`** (aggregate-root) com **sub-recurso `endereco`** (docs+endereço, onde vivem CNPJ/IE) e detalhes `bancos`/`pgto`/`relacionamentos`/`faturamento`/`vendedores`/`cod-ref-fornecedor`/`acordos`/`anexos`.
- Endpoints:
  | Método+rota | Origem | DTO (zod) | Mutação? |
  |---|---|---|---|
  | `GET /cadastro/parceiros?papel=…` | Q2 (`GET_PARCEIROS`) | `ParceiroFilterDto` | leitura (filtra por papel + empresa) |
  | `GET /cadastro/parceiros/:cod` | Q1 (+nested) | — | leitura |
  | `POST /cadastro/parceiros` | btnGravar | `ParceiroUpsertDto` (papéis, endereço aninhado, detalhes) | escrita (cascata + outbox `REM_PARCEIROS`) |
  | `PUT /cadastro/parceiros/:cod` | btnGravar | `ParceiroUpsertDto` | escrita (outbox condicional `CLI='S'` no UPDATE) |
  | `DELETE /cadastro/parceiros/:cod` | btnExcluir | — | escrita (BR-17 guard; soft-delete onde houver INDR) |
  | `GET/POST/PUT/DELETE /cadastro/parceiros/:cod/endereco[/:codend]` | Q3 | `EnderecoUpsertDto` | escrita (CNPJ/IE/CEP/IBGE; `REM_PARCEIROSEND`) |
  | lookups: `GET /cadastro/parceiros?papel=funcionario` (vendedor `FUN='S'`), `…/bancos`, `…/plano-contas`, `…/cidades` | Q-aux | — | leitura |
- **Config declarativa:** `empresaScoped:true`; PK por sequence; `replica:true` com **condição `CLI='S'` no UPDATE** (paridade `REM_PARCEIROS`); cascata master→detalhes em **uma transação**; RBAC por form; auditoria dupla (`ULTIMA_ALTER` string + `USULT*`/`DTULT*`).
- **Regras p/ service:** BR-01 (papel/rota), BR-14/24 (IBGE), BR-16 (travas NF/Indexador), BR-20 (CNPJ FRN único), BR-25 (endereço cobrança), SPED 0175. **Regras p/ DTO/zod:** BR-02 (≥1 papel), BR-06 (uppercase), BR-08 (TIPOFJ enum **com fallback** p/ 'L'/null), BR-09 (CPF/CNPJ dígito+máscara), BR-10 (IE+ISENTO), BR-15 (estrangeiro), BR-18 (senhas), flags S/N, defaults BR-03.
- **Configs de sessão/empresa** (BR-19/21/22/23/26): `PARCEIRO_EXIBIR_DADOS_FINANCEIROS`, `PERMITIR_HISTORICO`, `BLOQUEAR_CADASTRAR_PARCEIRO_CPF_EXISTENTE`, `VALIDA_CPF_CNPJ_VAZIO`, `SEGMENTO='INDUSTRIA'` → feature flags por tenant/empresa.

**Frontend (React):**
- Rota `/cadastro/parceiros?papel=…` (lista) + `/:cod` (form). Abas = [§2.1](#21-abas-do-pgcdadoscliente-ordem-caption-conteúdo), **condicionais** por config/segmento/papel. Endereço como aba/sub-form de 1ª classe (CNPJ/IE/CEP). Combos de [§2.2](#22-combos-de-lista-fixa-itemsvalues-verbatim) como `<SelectField>` (valores verbatim). Checkboxes de papel (`<CheckboxField>` S/N) — pré-marcado pelo `?papel=` e travado quando o papel vem do menu.
- `<SelectField>` lookups (banco/cidade/conta/PLC/perfil/produto/vendedor `FUN='S'`); máscara dinâmica CPF/CNPJ por TIPOFJ; autofill CEP→IBGE; F3/Ctrl+N/Ctrl+A ([§8](#8-taborder--mapa-de-atalhosmnemônicos)) via `ShortcutScope`; Enter-avança e taborder do engine.

**Decisões offline (PDV/Electron — ADR-008):**
- Cadastro roda **na nuvem/retaguarda**, **não** no PDV. Mas o **resultado alimenta a carga do PDV**: parceiro/cliente (limite/juros/convênio), e a replicação real (`REM_PARCEIROS` com condição `CLI='S'`) já modela o fluxo nuvem→edge→PDV. → o contrato do delta é backward-compatible; a condição `CLI='S'` define **o que** propaga ao caixa.

---

## Lacunas (para sair de `rascunho`)

**✅ Confirmado (`[.pas]`/`[.dfm]`/`[Oracle-dict]`/recon):** party único multi-papel (6 flags, `ASS` morto); tela única `TfrmCadClientes` (stubs mortos fora do build); CNPJ/IE em `PARCEIROS_END`; SELECT master (16 JOINs, `V.FUN='S'`) e SQL dos 7+ nested; mapa dos combos; defaults/auditoria do DM; todas as BR-01..BR-27 com procedência e mensagens PT exatas; sequence `ID_CODPARCEIRO` sem trigger; replicação `REM_PARCEIROS`(cond. CLI no UPDATE)/`REM_PARCEIROSEND`; `GET_PARCEIROS` sem filtro de papel (`GET_FORNECEDORES` não existe); configs de sessão/empresa; 195 colunas físicas / 169 agrupadas / ~140 no SELECT; dados reais (TIPOFJ com sujeira 'L'/null; 57% multi-papel).

**🟡 Inferido (form-base; capturado em Bancos, NÃO nesta tela):** pipeline de escrita delta + cascata; carimbo `USULT*`/`DTULT*` como statement do form-base; forma final de Q2/Q11; enfileiramento exato em `REMESSA_SERVER`; SPED 0175.

**Pendências (não marcar paridade sem elas):**
1. **Captura RUNTIME (V$SQL + REMESSA_SERVER)** dos casos G-01..G-17 — fecha [§4](#4-dados--toda-query-a-alma-do-dossiê)/[§9](#9-casos-de-teste-golden--capturados-do-legado).
2. **TabOrder exata por aba** (output do parser do `.dfm` — [§8](#8-taborder--mapa-de-atalhosmnemônicos)).
3. **Survey multi-tenant** antes de podar colunas vestigiais ([entity-parceiros.md §7b](../../../03-legacy-analysis/recon/entity-parceiros.md)).
4. **Plano de implementação + código** (aggregate `parceiros` + sub-recurso `endereco` + detalhes).
5. **Revisão independente** + **paridade verde** que exercita o caminho real ([parity-harness.md](../../../06-testing-quality/parity-harness.md)), incl. teclado.

## Ver também

- [dossier-template.md](../../dossier-template.md) · [dossier-process.md](../../dossier-process.md) · [README.md](../../README.md)
- [entity-parceiros.md](../../../03-legacy-analysis/recon/entity-parceiros.md) — o mapa de entidade `PARCEIROS` (party central, dados reais).
- [form-base-cadmaster.md](../../../03-legacy-analysis/recon/form-base-cadmaster.md) — contrato de `TfrmCadMaster`/`TfrmCadMasterDetalhe`.
- [UCadContasBancarias.md](UCadContasBancarias.md) — 1ª mestre-detalhe documentada (FK/lookup + escopo por empresa). · [uCadBancos.md](uCadBancos.md) — piloto runtime-golden (replicação `REM_*`). · [uCadOperacoesConta.md](uCadOperacoesConta.md).
- [../../../03-legacy-analysis/dynamic-sql-extraction.md](../../../03-legacy-analysis/dynamic-sql-extraction.md) — capturar SQL/golden em runtime (fecha §4/§9).
- [../../../03-legacy-analysis/business-rule-extraction.md](../../../03-legacy-analysis/business-rule-extraction.md) · [../../../03-legacy-analysis/hidden-coupling-traps.md](../../../03-legacy-analysis/hidden-coupling-traps.md) · [../../../02-stack-and-standards/keyboard-ux-layer.md](../../../02-stack-and-standards/keyboard-ux-layer.md)
- [../../../00-orientation/canonical-decisions.md](../../../00-orientation/canonical-decisions.md) — ADR-008/010/011/012.
