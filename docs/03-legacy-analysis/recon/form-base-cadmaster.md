# Contrato do form-base `TfrmCadMaster` (o engine CRUD do legado)

> `TfrmCadMaster` (`retaguarda-master/fonte/Units/uCadMaster.pas`, 1.806 linhas, ISO-8859) é o **form-base do qual ~101 cadastros da retaguarda herdam**. Documentá-lo **uma vez** é especificar o "engine CRUD" reutilizável do alvo (o `/ds-create-crud` do DS, [ADR-014](../../00-orientation/canonical-decisions.md)): cada tela herdeira (ex.: [uCadBancos](../../04-screen-dossier/dossiers/retaguarda/uCadBancos.md)) só acrescenta os campos da sua tabela e reusa **todo** o ciclo de vida, o teclado e os efeitos abaixo. Análise estática read-only; o que depende de execução está marcado `[inferido]`.

## Pré-requisitos de leitura

- [delphi-anatomy.md](../delphi-anatomy.md) — herança visual `.dfm`, provider/ClientDataSet, datamodule.
- [hidden-coupling-traps.md](../hidden-coupling-traps.md) — o estado global que este form-base lê/escreve.
- [mapa-reconhecimento.md](mapa-reconhecimento.md) — §B (herança), §C (datamodules), §I (o piloto).

---

## 1. O padrão de herança

- Toda tela de cadastro de **uma tabela** é `Tfrm<X> = class(TfrmCadMaster)`; o `.dfm` é herança visual (`inherited frm<X>`). A subclasse adiciona só os `TDBEdit`/labels da sua tabela em `pnlGeral`; herda cabeçalho (código + pesquisa + navegador), rodapé (botões de ação), status bar e os ClientDataSets (`cdsPrincipal`, `cdsNavegation`, `cdsFiltros`, `cdsHistorico_dinamico`).
- Wiring por tela: no `FormCreate`, a subclasse chama **`SetaDataset(controleFoco, cds, ChavePrincipal, Tabela, ...)`** `[.pas:L1444]` — informa o ClientDataSet da tabela, a PK e a tabela. Há flags opcionais `PreencheEmpresa`/`PreencheOperador` e `View`/`ViewAux`.
- Convenções documentadas no cabeçalho do `.pas`: **soft-delete** via `INDR`/`INDR_USUARIO`/`INDR_DATA` (filtro `COALESCE(INDR,'I')<>'E'`); **mestre/detalhe** via marcador `/*<PRINCIPAL>TABELA</PRINCIPAL>*/` + providerflags + `SetBeforeUpdateRecord`.

---

## 2. Camada de dados (padrão por tela)

Cada herdeira tem um datamodule `TRDm<X>` com a tripla **`TFDQuery` → `TDataSetProvider` → `TClientDataSet`**, conexão **global** `dmPrincipal.FDConexao`. Os `ProviderFlags` dos campos definem a DML gerada: `pfInKey`+`pfInWhere` = chave (WHERE), `pfInUpdate` = colunas do SET/INSERT. Logo, **INSERT/UPDATE/DELETE não são escritos à mão — o provider os gera** a partir do delta do ClientDataSet em `ApplyUpdates`.

- **Load por código:** `AbreDataset(Codigo)` `[.pas:L211]` seta `cdsPrincipal.Params['CODIGO']` e abre o cds (dispara a query do provider). Caminho de **chave alternativa** (`FConsultaAlternativa`): monta SQL dinâmica **por concatenação** `select <chave> from <tabela> where <campoAlt> = <valor>` para resolver a PK — ponto de SQL dinâmica a vigiar (não usado quando a busca é pela PK).
- **Listagem/pesquisa:** `btnPesquisaClick` `[.pas:L516]` abre `frmPesquisa` (`uPesquisa.pas`) sobre uma **VIEW `GET_<TABELA>`** (não a tabela crua) — é o que explica as **~369 views por schema** (são as views de pesquisa). Aplica filtro de ativo (`rdgAtivo`) e, se a view tem `INDR`, adiciona `(COALESCE(INDR,'I')='I')`. A SQL final do grid é montada dentro de `frmPesquisa` `[inferido — capturar em runtime]`.

> **No alvo:** o datamodule vira `repository` sem estado; a conexão global vira **conexão por tenant**; a DML gerada pelo provider vira `insert/update/delete` explícitos no Kysely; a view `GET_<TABELA>` vira a query de listagem/paginação do `GET /<recurso>`.

---

## 3. Ciclo de vida (o que toda herdeira herda)

### Gravar — `btnGravarClick` `[.pas:L423]`
1. **RBAC**: `dmPrincipal.PossuiAcessoForm(Self.Name,'BTNGRAVAR')` — sem permissão, cancela + exceção.
2. **Obrigatórios**: `ValidaObrigatorios(cdsPrincipal)` → `Abort`.
3. **Carimbo de empresa/operador** (se flags): `CODEMPRESA`/`CODOPERADOR` de `dmPrincipal` (estado global).
4. **`cdsPrincipal.ApplyUpdates(0)`** → provider → DML na tabela → **dispara trigger `REM_<TABELA>`** (replicação, §5).
5. **Histórico dinâmico**: `SetaHistorico_Dinamico(...)` grava em `HISTORICO_DINAMICO`.
6. **Carimbo de alteração**: `SetaOperadorAlteracao(...)` preenche `USULTALTERACAO`/`DTULTIMALTERACAO` (ramo por `Modulo` 'RETAGUARDA'/'CONTROLE-SICOM').
7. **Log**: `TLog.GravaLog(doInserir/doAlterar, ...)`.
8. **Hook**: `EventoDepoisGravar` (a subclasse pode setar).

### Excluir — `btnExcluirClick` `[.pas:L387]` + `ExcluirRegistro` `[.pas:L886]`
1. **RBAC**: `PossuiAcessoForm(Self.Name,'BTNEXCLUIR')`.
2. Confirmação (salvo mestre/detalhe ou `FConfirmaExclusao=false`).
3. **Decisão soft vs hard**: se o cds **não tem `INDR`** (ou registro recém-inserido) → `Delete` **físico**; senão **soft-delete**: `INDR:='E'`, `INDR_USUARIO`, `INDR_DATA` (data do servidor) e `ATIVO:='N'` se existir.
4. `ApplyUpdates` → DML → trigger de replicação; `SetaHistorico_Dinamico(...,'DELETE')`.

### Outros estados
- `btnAdicionarRegistroClick` (novo), `btnEditarClick` (editar), `btnCancelarClick` (cancela/sair), `Inserir`, `ControlaTela`/`SetStateOfControlsCadMaster`/`HabilidaDesabilitaControles` — máquina de estados de UI (browse/insert/edit), habilitando botões e o caption do Cancelar (`&Sair`↔`&Cancelar`).
- `BeforeUpdateRecord` `[.pas:L1335]` — hook do provider no apply (onde mestre/detalhe e ajustes de delta acontecem); `SetBeforeUpdateRecord` registra os providers.

---

## 4. Mapa de teclado (reutilizável — extraído do `.dfm`/`.pas` do form-base)

**Botões de ação (mnemônicos `&`)** `[uCadMaster.dfm]`:

| Botão | Caption | Mnemônico | Ação |
|---|---|---|---|
| `btnEditar` | `&Editar` | Alt+E | entra em edição |
| `btnExcluir` | `E&xcluir` | Alt+X | exclui (soft/hard) |
| `btnGravar` | `&Gravar` | Alt+G | grava |
| `btnCancelar` | `&Sair` / `&Cancelar` | Alt+S / Alt+C | sai/cancela (caption alterna) |
| `btnAdicionarRegistro` | `&Adicionar` | Alt+A | novo registro |
| `btnOutros` | `&Outros` | Alt+O | abre popup `ppmBotaoOutros` |
| `rdgAtivo` | `Ati&vo [F6]` | Alt+V / **F6** | alterna filtro ativos/inativos/todos |

**Teclas funcionais / navegação (`KeyPreview`, `FormKeyDown` `[.pas:L980]`):**

| Tecla | Efeito | Procedência |
|---|---|---|
| **Esc** | **engolida** durante insert/edit (não cancela no meio da digitação) | `[.pas:L982]` |
| **F6** (117) | cicla `rdgAtivo` (ativos→inativos→todos) | `[.pas:L991]` |
| **Alt+O** | abre o menu "Outros" | `[.pas:L1006]` |
| **← / →** em `edtCodigo` | registro anterior / próximo (DBNavigator) | `[.pas:edtCodigoKeyUp L876]` |
| **↑ / ↓** em `edtCodigo` | primeiro / último registro | `[.pas:edtCodigoKeyUp]` |
| **Enter** em `edtCodigo` | marca flag e dispara `edtCodigoExit` (carrega pelo código) | `[.pas:edtCodigoKeyDown L839]` |
| dígitos só | se a PK é inteira, `edtCodigo` **filtra não-numéricos** | `[.pas:edtCodigoKeyPress L849]` |

> Este mapa é **comum a todas as ~101 telas herdeiras** (ADR-010). No alvo, vira a configuração-padrão do engine CRUD: mnemônicos de botão, F6=filtro, setas=navegação de registro, Enter no campo-código=carregar, Esc protegido em edição. Extrair **uma vez**, aplicar a todas.

---

## 5. Estado externo e efeitos (comuns a todas as herdeiras)

| Item | Tipo | Alvo | Mapeamento |
|---|---|---|---|
| `dmPrincipal.FDConexao` | conexão **global** | Oracle | conexão por tenant request-scoped |
| `dmPrincipal.Empresa/Operador*` | lê | empresa/operador de sessão | tenant/usuário no request context (fail-closed) |
| `PossuiAcessoForm(form,acao)` | lê | RBAC data-driven | guard/policy por rota+ação |
| **trigger `REM_<TABELA>`** | grava (indireto) | `REMESSA_SERVER` (outbox) | **sync explícito** por terminal, idempotente por `CHAVE` ([ADR-008](../../00-orientation/canonical-decisions.md)) |
| `HISTORICO_DINAMICO` | grava (indireto) | histórico genérico | audit log/interceptor |
| `USULTALTERACAO`/`DTULTIMALTERACAO` | grava | colunas da tabela | auditoria no service |
| view `GET_<TABELA>` | lê | pesquisa/listagem | query de listagem do recurso |

> A **escrita-fantasma de replicação** (`REM_<TABELA>`→`REMESSA_SERVER`) e o **histórico dinâmico** acontecem em **toda** gravação/exclusão de cadastro — a paridade de qualquer herdeira tem de prová-los.

---

## 5b. Variante mestre-detalhe (`TfrmCadMasterDet` / `TfrmCadMasterDetalhe`)

Telas com **header + itens** (cabeçalho numa tabela, detalhes em outra) herdam de uma camada extra **sobre** o `TfrmCadMaster`. Herança em 2 níveis:

```
TfrmCadMaster  →  TfrmCadMasterDet  →  TfrmCadMasterDetalhe
 (1 tabela)        (+ detalhes)         (+ detalhes em ABAS / PageControl)
```

**7 telas** herdam mestre-detalhe — inclusive as mais quentes: `uCadParceiros`, `uCadClientes` (5.749 linhas, a monstra), `uCadFornecedores`, `uCadAssociados`, `UCadLoteCobranca`, `UCadMDFe` (fiscal), `uAnalisePedCompNf`.

- **`TfrmCadMasterDet`** `[uCadMasterDet.pas]` adiciona `ListaDetalhes: TList` — a lista dos ClientDataSets de detalhe (a subclasse a popula). E sobrescreve:
  - **`btnGravarClick`**: valida obrigatórios do master **e de cada detalhe**; faz `Post` em cada detalhe alterado; depois `inherited` (a gravação do `TfrmCadMaster` → `ApplyUpdates`). Master + detalhes são aplicados via **nested datasets** (`ftDataSet`) num **único** provider → **uma transação** (header+itens atômicos).
  - **`btnExcluirClick`**: confirma e faz **exclusão em cascata em código** — percorre `ListaDetalhes`, encontra os datasets aninhados (`cds<Nome>`) e exclui cada linha (via `ExcluirRegistro` = soft/hard), depois o master. **Não** depende de FK ON DELETE CASCADE do banco.
  - **`FormShow`**: `VerificaObrigatorios` em cada detalhe.
- **`TfrmCadMasterDetalhe`** `[uCadMasterDetalhe.pas]` adiciona `PageControlGeral` com `tbsMaster` + `TabSDetalhe` — a variante "detalhes em abas".

> **No alvo:** o agregado header+itens vira **um aggregate** salvo numa transação (o equivalente do nested dataset + provider único); a **validação cascateia** para os itens; a **exclusão cascateia** (em código ou via FK — decidir), e cada item também dispara seu evento de replicação (`REM_<TABELA_DETALHE>`). UI de abas → tabs do DS. É o caso que o `/ds-create-crud` precisa cobrir além do CRUD de tabela única.

## 5c. Palette de campos (tipos que o engine CRUD precisa mapear)

Das telas herdeiras (ex.: `uCadParceiros`) sai o conjunto de controles data-bound a mapear para o design system:

| Controle VCL | Papel | → DS (alvo) |
|---|---|---|
| `TDBEdit` | texto | `<Field>` |
| `TJvDBCalcEdit` | número/moeda | `<NumberField>`/`<MoneyField>` |
| `TJvDBComboBox` / `TDBRadioGroup` | lista fixa (enum) | `<Select>` / `<RadioGroup>` |
| `TDBCheckBox` | booleano (flag 'S'/'N') | `<Checkbox>` |
| `TJvDBDateEdit` | data | `<DateField>` |
| `TDBMemo` | texto longo | `<TextArea>` |
| `TcxGrid`/`TDBGrid` | grid de detalhe | `<DataGrid>` teclado-first |

> Atenção (do [business-rule-extraction.md](../business-rule-extraction.md)): flags `char` 'S'/'N' viram boolean/enum explícito; `Currency` vira decimal (não float).

## 6. O que o engine CRUD do alvo precisa replicar (resumo)

Herança visual → **componente CRUD base** (DS) · `SetaDataset` → config declarativa (tabela/PK/view/flags) · provider/cds → repository sem estado · `AbreDataset` → load por id · `frmPesquisa`+`GET_<TABELA>` → listagem/filtro paginado · gravar (RBAC→obrigatórios→apply→histórico→carimbo→log→hook) → service com guard + transação escopada (write **+ outbox** atômicos) · excluir (soft/hard por `INDR`) → política de exclusão por entidade · mapa de teclado (§4) → config-padrão de teclado do engine.

## Ver também

- [../../04-screen-dossier/dossiers/retaguarda/uCadBancos.md](../../04-screen-dossier/dossiers/retaguarda/uCadBancos.md) — a primeira herdeira (piloto) que consome este contrato.
- [mapa-reconhecimento.md](mapa-reconhecimento.md) — §I (aprofundamento do piloto) e §C (datamodules/estado global).
- [hidden-coupling-traps.md](../hidden-coupling-traps.md) · [dynamic-sql-extraction.md](../dynamic-sql-extraction.md) · [delphi-anatomy.md](../delphi-anatomy.md)
- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — ADR-008/010/011/012/014.
