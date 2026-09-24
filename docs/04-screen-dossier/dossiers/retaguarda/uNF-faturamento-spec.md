# NF — FATURAMENTO (as parcelas da nota) — legado × Apollo — spec de corte

> Recon READ-ONLY de 24/09/2026. Fonte: `retaguarda-master/fonte` (ISO-8859-1, lido via `iconv -f latin1 -t utf-8`;
> as linhas batem com o original). Dado: **Oracle de PRODUÇÃO** (só SELECT), recorte **NF emitida em 2025-01-01 → 24/09/2026**.
> Nada foi alterado no legado, no Oracle nem no código do app.

## 0. Resumo

No legado, a nota **não gera título**. Ela grava **parcelas** na tabela `FATURAMENTO` (1 linha por parcela, `LIBERADO='N'`/nulo).
Uma segunda tela, `TfrmFaturamento2` ("Faturamento"), transforma cada parcela pendente em título (APAGAR na entrada,
ARECEBER na saída) e marca a parcela `LIBERADO='S'`. **O flag de "faturada" é por parcela, na FATURAMENTO — `NF` não tem
coluna `FATURADA`** (só `PROC` e `CANCELA_FATURAMENTO`).

O Apollo pulou a FATURAMENTO: `NfFaturamentoService.faturar` gera os títulos direto de um DTO (nº de parcelas, 1º
vencimento, intervalo) e marca um flag inventado, `nf.faturada` (mig 028). A tabela `faturamento` existe no destino
(mig 246, 18 colunas, carregada com 47.219 linhas), mas **só é lida** (tela de consulta `/compras/faturamento`).
**Nenhum caminho do app grava nela.**

Números de produção (2025-26):

| | Entrada (E) | Saída (S) |
|---|---|---|
| Linhas de FATURAMENTO | **16.300** (14.831 NFs) — R$ 48,17 mi | **215** (214 NFs) — R$ 161,5 mil |
| `LIBERADO='S'` / `'N'` / nulo | 16.260 / 8 / 32 | 114 / 101 / 0 |
| NFs com parcelas **e** títulos | 14.800 | 111 |
| NFs com parcelas **sem** título | 31 (23 não processadas + 8 processadas) | 103 |
| NFs com título **sem** parcela | **0** | 1 |
| Parcelas vindas do XML (`<cobr><dup>`) | **11.752 (72%)** | 0 |
| Parcelas geradas na tela (`btnGerarFin`) | 4.548 | 215 |

**Todo título de NF de entrada tem FATURAMENTO por trás (0 exceções).** A FATURAMENTO é a fonte do financeiro da nota,
não um detalhe.

---

## 1. O fluxo do legado, passo a passo

### 1.1 Estrutura

- Tabela `FATURAMENTO` (Oracle, 18 colunas): `CODFATURAMENTO` (PK, `GetID('CODFATURAMENTO')`), `DATA` (vencimento), `IDNF`
  (→ `NF.CODNF`, NOT NULL), `MODALIDADE` (varchar 20), `VALOR`, `LIBERADO` char(1), `OBS` (600), `CODOPERADOR`, `NROFATURA`,
  `TOTALPARCELASFATURA`, `TIPOREF`, `CODREF`, `NRONF` (12), `CODBCO`, `DUPLICATA` (65), `VALOR_DESCONTO`, `VALOR_BONIFICADO`,
  `CODBARRASBOLETO` (48). **Nenhuma trigger** em FATURAMENTO.
- Dataset: `DMNF.cdsFaturamento`, nested da nota (`qryFaturamento`, `Units/udmNF.dfm:7075-7110`,
  `SELECT … FROM FATURAMENTO F WHERE F.IDNF = :CODNF`, `UpdateTableName='FATURAMENTO'`). É gravado junto com a NF no
  `cdsNota.ApplyUpdates` (mesma transação do cabeçalho).
- `cdsFaturamentoBeforePost` (`udmNF.pas:4642`): tira acentos e caracteres especiais do `CODBARRASBOLETO`.
- Quem grava FATURAMENTO: (a) `btnGerarFinClick` da NF (`uNF.pas:4389`); (b) o mesmo gerador em
  `uEstoqueNF.pas:248` (tela Processar) e em `uFinanceiroNotaFiscal.pas:461` (menu Processar financeiro); (c) a importação
  do XML (`NFe.pas:3457-3475`); (d) o mapa de carga (`UCadMapaDeCarga.pas:1181/1209`, já nasce `LIBERADO='S'`).

### 1.2 Gerar as parcelas — `btnGerarFinClick` (`uNF.pas:4389-4487`)

1. CFOP 1910/2910 (bonificação) exige senha: `dmPrincipal.SenhaAdministrativa('ADM')` (:4399).
2. Abre `cdsVencimentos` pela `NROPEDIDO` da nota (a condição do pedido) (:4403).
3. `edtNumePar <= 0` passa a 1.
4. **Nota de devolução** (`COD_PED_DEV_COMPRA > 0`): o 1º vencimento é `DataPrimeiraParcelaNotaDevolucao` (:4412;
   `udmNF.pas:6331-6384`). Busca as NFs de origem em `PEDIDO_DEVOLUCAO_COMPRA_ITENS.COD_NF`. Com **uma** NF, lê
   `SELECT * FROM FATURAMENTO WHERE IDNF IN (…) ORDER BY DATA` e usa a 1ª `DATA`, ou hoje se ela já passou. Com mais de
   uma NF, ou sem NF, usa hoje. Depois soma `QUANTIDADE_DIAS_GERAR_BOLETO_DEVOLUCAO` (produção: **15**). ⚠️ Esta função
   **lê a FATURAMENTO**.
5. Vencimento antes de hoje → pergunta *"A data de vencimento anterior a data de hoje.\nDeseja calcular o vencimento da
   primeira parcela para o próximo mês?"* → `IncMonth(+1)` (:4417).
6. Dia fixo: `edtDiaVenc > 0` e `TipoCalcParc = tcDiaFixo` (:4426).
7. **Regerar apaga as parcelas atuais** e devolve o valor delas a "a faturar" (:4429-4433).
8. `BuildParcelas(valor, nParc, intervalo, dia, mês, ano, TipoCalcParc, …)` fica em `FuncoesApollo` (fora do checkout).
9. Cada parcela recebe (:4440-4475): `CODFATURAMENTO=GetID`, `NROFATURA=i+1`, `TOTALPARCELASFATURA=nParc`,
   `DATA=venc[i]`, `IDNF=CODNF`, `VALOR=parcela[i]`, **`LIBERADO='N'`**, `NRONF=NF.NRONF`. **`CODOPERADOR` fica nulo.**
   - `DUPLICATA` segue `TipoDuplicata`, que vem de `EMPRESAS.MODELO_DUPLICATA` e `SEPARADOR_DUPLICATA`:
     - **modelo 01** (produção: modelo 1 nas 5 empresas, separador nulo): `edtNroDup > 0` gera
       `<nroDup><sep><yy><sep><letra A,B,…>`; senão fica vazio. O botão `btnGerarSeqFin` (*"Deseja gerar sequencia de
       duplicatas?"*) põe `edtNroDup := GetID('NRODUP')`.
     - **modelo 02**: `NRONF<sep>(i+1)`, exceto quando o `TIPODOC` do vencimento do pedido é `CHEQUE`.
   - `MODALIDADE`: entrada é sempre `'A PAGAR'`. Saída: modelo 01 dá `'A RECEBER'`; modelo 02 dá o `TIPODOC` do vencimento
     do pedido (vazio → `'A RECEBER'`).
10. Recalcula o a-faturar: `TOTALNF − TOTALBONIFICADO − TOTAL_RETENCOES − TOTAL_DESC_ACORDO − TOTAL_DESC_PEDIDO − Σ parcelas`
    (:4479). **Essa é a base da parcela**, não o TOTALNF.

Quando o botão fica habilitado (`SetConfiguracoesFaturamento`, `uNF.pas:16184-16276`):
- Mensagem *"Informe um CFOP antes de gerar o financeiro!"* sem CFOP, e a mesma mensagem (bug do legado) sem parceiro.
- `btnGerarFin.Enabled := LiberarNotaParaGerarFinanceiro AND cdsPagar.RecordCount=0 AND PROC<>'S' AND nota em edição`.
  `LiberarNotaParaGerarFinanceiro` (`udmNF.pas:5668`) exige `cdsNotaPROC_FINANCEIRO='S'` (flag do CFOP), ou CFOP 1910/2910
  com `FINANCEIRO_BONIFICACAO_ACORDO='S'` (produção: N).
- Legenda: *"Ge&rar financeiro bonificação"* para 1910/2910, senão *"Ge&rar financeiro"*.
- Modelo 02: preenche a partir do vencimento do pedido e dispara o gerar sozinho. Modelo 01: dia fixo
  `PARCEIROS.VENC_PREV`, intervalo `PARCEIROS.DIASPRAZO`. Com `edtDiaVenc>0` usa `tcDiaFixo`; senão `tcIntervalo` com
  `edtVenc := Now + intervalo`.
- Na tela Processar (`uEstoqueNF.pas:1939`), `NF.CANCELA_FATURAMENTO='N'` desabilita o gerar. Em produção a coluna nunca
  vale 'N': é nula ou 'S' (184 E / 3 S).

"Limpar" (`btnLimparFinClick`, `uNF.pas:5570`): *"Deseja apagar todos dados financeiros cadastrados?"*. Copia as linhas
para `cdsFaturamentoDelete` (para o LOG) e apaga todas.

Grade editável `dbgFormasPgtos` (`uNF.dfm`): **Nº (`NROFATURA`), Data, Duplicata, Modalidade, Valor, Código de barra
boleto**. O `edtCodigoBarraFin` valida o boleto (`uValidaBoletos`).

### 1.3 Gravar com a nota + LOG (`btnGravarClick`, `uNF.pas:4849-4855`, `5051`, `5104-5132`; igual em `:9105-9131`)

- `cdsPrincipal.ApplyUpdates(0)` grava NF + NF_PROD + FATURAMENTO + CODCONTABILNF numa só transação.
- LOG (`TLog.GravaLog`, `FORMULARIO = lblTitulo` = *"Notas fiscais de entrada"* / *"Notas fiscais de saída"*,
  `TABELA='FATURAMENTO'`, `CHAVE='CODNF'`, `VALOR=CODNF`):
  - cada linha de `cdsFaturamentoDelete` gera `Excluiu`;
  - dataset em insert gera `Inseriu` para **cada** linha;
  - dataset em edit gera `Alterou` para cada linha (só os campos que mudaram).
- O `uNF.btnGravarClick` **não confere Σ parcelas = base**. Quem confere é a tela Processar (`uEstoqueNF.pas:843`) e o menu
  Processar financeiro (`uFinanceiroNotaFiscal.pas:216`), com a mensagem *"O total das faturas é diferente do valor da nota.
  Confira!"* (tmAlerta / tmErro).

### 1.4 Importação do XML de entrada — `TNFe.ImportaNFe` (`NFe.pas:2842`, região *'Informações de Faturamento'* :3457-3475)

Para cada `<cobr><dup>` grava 1 linha de FATURAMENTO: `CODFATURAMENTO=GetID`, `IDNF`, `NRONF`,
`MODALIDADE = iif(TIPO='E','A PAGAR','A RECEBER')`, `DATA=dVenc`, `VALOR=vDup`, **`DUPLICATA=nDup`**, `NROFATURA=i+1`,
`TOTALPARCELASFATURA=Dup.Count`, **`CODOPERADOR=operador`**. **`LIBERADO` não é gravado e fica nulo**, o que vale como
pendente em todos os leitores (`COALESCE(LIBERADO,'N')='N'`).

**A importação não cria APAGAR.** O título só nasce depois, pelo Faturamento (§1.6).
Chamadores: `uNF.pas:5471` (importar XML) e `:6383` (recuperar XML).
Quando a SEFAZ devolve o número, `NFe.pas:4666` roda `UPDATE FATURAMENTO SET NRONF = <nronf> WHERE IDNF = …` (e
`UPDATE APAGAR SET DUPLICATA = <nronf>`).

Prova no dado: 11.752 parcelas de entrada com `CODOPERADOR` preenchido e `DUPLICATA` de 3 dígitos (`'001'`…). O LOG
`Inseriu` tem `CODOPERADOR` em 12.209 de 17.219 linhas.

### 1.5 Processar a nota (entrada) — `uProcessaNotaFiscal` → `TfrmEstoqueNF`

- `TFrmProcessaNotaFiscal.ProcessaEstoqueEFaturamento` (`uProcessaNotaFiscal.pas:1019`) abre `TfrmEstoqueNF` com a grade de
  parcelas. Ali dá para regerar (`btnGerarFinClick` :248, a mesma regra) e editar. O gerar só fica habilitado sem título
  (`not ExisteFinanceiroParaEstaNota`, :1748).
- `btnProcessarClick` (`uEstoqueNF.pas:825`):
  - confere Σ (*"O total das faturas é diferente do valor da nota. Confira!"*);
  - pede confirmação *"Confirma o processamento da nota selecionada?"*;
  - ⚠️ **renumera a PK de cada parcela**: `cdsFaturamentoCODFATURAMENTO := GetID('CODFATURAMENTO')` (:950-956). Por isso o
    LOG `Alterou` do processamento é *"CAMPO: CODFATURAMENTO VALOR ANTERIOR: 117511 VALOR ATUAL: 117514"* (12.494 de
    12.496 `Alterou` de entrada);
  - depois roda `UpdateProdutos` (`udmNF.pas:6778`), que grava a nota e, após o commit (:7771-7775), chama
    `GerarAReceberDeAcordoComercial`, `GerarAPagarDeRetencoes`, `GerarAPagarDeFunRural`,
    **`GerarFinanceiroAutomaticamente`** e `GerarLancamentosDeCaixa`.
- `GerarFinanceiroAutomaticamente` (`udmNF.pas:8112-8440`) só age se `CFOPGeraFinanceiroAutomatico`: `CFOP.GERA_FINANCEIRO_AUTO='S'`
  **e** `PROC_FINANCEIRO='S'` (:9902). Entrada vai para `InserirAPagar` (`TfrmAPagar.GeraApagar` + `GeraCxApagar` +
  `UPDATE FATURAMENTO SET LIBERADO='S' WHERE IDNF=…` :8315). Saída vai para `InserirAReceber`
  (`TfrmCadAReceber.GerarAReceber` + pedidos + UPDATE :8420).
  **Em produção nenhum CFOP tem `GERA_FINANCEIRO_AUTO='S'`** (N=25, nulo=373), então esse caminho **nunca roda**.
  Confirmação: 0 títulos com a assinatura do `GeraApagar` (`GFAT='S'` e `GERADO='SISTEMA'` juntos).
- Terminado o processar, em `uNF.pas:15129-15135`: se `DmConfigura.Configuracoes.VisualizaFaturamento='SIM'` e
  `ExisteFaturamentoAGerarFinanceiro(CODNF)`, roda **`btnFaturamento.Click`**, que abre o Faturamento sozinho.
  `VisualizaFaturamento` vem do `ConfigDB.xml` local da estação (`udmConfigura.pas:296/411`, rótulo *'VISUALIZAR
  FATURAMENTO'*), com padrão **'SIM'** (:585). **Não está no banco.**

`ExisteFaturamentoAGerarFinanceiro` (`udmNF.pas:11766`):
`SELECT CODFATURAMENTO FROM FATURAMENTO WHERE IDNF = :nf AND COALESCE(LIBERADO,'N')='N'`.

### 1.6 Faturamento — `btnFaturamentoClick` (`uNF.pas:4332-4369`) → `TfrmFaturamento2`

- Gate: nota própria (`TIPOEMISSAO=0`) só com `STATUSNFE` P ou D, senão *"Envie a nota antes de gerar o faturamento!"*
  (tmInformacao).
- Sem parcela pendente: *"Não existe faturamento pendente para esta nota fiscal a ser processado."* (tmAlerta). A mensagem
  só aparece com clique real; na chamada automática (`Sender=nil`) sai calado.
- Abre o Faturamento com o filtro pronto: período = DTEMISSAO, nº = NRONF, `rbtAPagar` para entrada / `rbtAReceber` para
  saída, depois `btnBuscar.Click` e modal.
- Também é chamado depois da autorização SEFAZ de uma nota própria (`uNF.pas:10941`, junto de
  `GerarFinanceiroAutomaticamente` :10938) e pelo menu Processar financeiro (`uFinanceiroNotaFiscal.pas:412`, com
  *"Grave as faturas antes de processar o financeiro."*).

`TfrmFaturamento2` (`uFaturamento2.pas`), com o datamodule `udmFaturamento`:
- **Busca** `BuscaDocsAFaturar` (:310-386): notas com parcela em `F.LIBERADO='N' OR NULL`, `N.TIPO` E/S, **`COALESCE(N.PROC,'N')='S'`**,
  da empresa logada, data base emissão / contábil / vencimento; ordem DTEMISSAO, DTCHEGADA, TITULAR, NRONF. As parcelas
  vêm do detalhe `qryFaturamentosNota` (`udmFaturamento.dfm`). Cores: `LIB` verde, `VHJ` azul (vence hoje), `ATR`
  vermelho negrito (atrasada), `AGD` a vencer (`cdsDoctosAFaturarCalcFields`).
- Marcar: espaço ou clique (`MarcarDocumento` :702; parcela já `LIBERADO='S'` não marca); duplo clique ou título da coluna
  marca todas (`MarkFields` :717). A seleção é clonada para `cdsFaturamento` com `LIBERADO:='S'` em memória (`ManageField`
  :675). Delete tira a parcela da seleção.
- **Processar (F2)** `btnProcessarClick` (:264): com `chbProcessamento` desmarcado monta `cdsLoteFat`/`cdsDocLoteFat`
  (lote), mas **nunca faz `ApplyUpdates`**. Em produção `LOTE_FATURAMENTO` e `LOTE_FATURAMENTO_DETALHE` têm **0 linhas**
  (código morto). Depois `ProcessarFaturamento`: A Pagar vai para `ProcessarAPagar`, senão `ProcessarAReceber`.
- **Bonificar (F4)** `btnBonificarClick` (:206) chama `AtualizarFaturamento('BONIFICADO')`: marca `LIBERADO='S'` e
  `MODALIDADE='BONIFICADO'` **sem gerar título**. Só aparece com `BONIFICACAO_FATURAMENTO_NF='S'` (produção: **S**).
  Existem 16 parcelas 'BONIFICADO' no histórico e 0 em 2025-26.
- `AtualizarFaturamento` (:160) → `dmFaturamento.UpdateFaturamento(CODFATURAMENTO, Tipo, 'S')` (`udmFaturamento.pas:328-350`):
  `SELECT CODFATURAMENTO, LIBERADO, MODALIDADE FROM FATURAMENTO WHERE CODFATURAMENTO=:CODIGO`, depois `LIBERADO:='S'`
  (e `MODALIDADE:='BONIFICADO'` quando bonifica) e `ApplyUpdates`. **Linha a linha, por CODFATURAMENTO. Não grava LOG**
  (0 `Alterou` com LIBERADO em 12.582).
- `RegistrarProcessoNf` (:1055): entrada com chave grava `NF_STATUS_PROCESSO` com `stGerarFinanceiro`.

**`ProcessarAPagar` (:746-779)** abre `TfrmAPagar` com `Faturamento := True` e `cdsTemp.Data := cdsFaturamento.Data`
(as parcelas marcadas). O prefill está em `uAPagar.pas:4487-4600`. **O operador ainda pode editar** (produção: TIPODOC
trocado para CARTÃO PRÓPRIO em 1.552 títulos e A VISTA em 432). Por parcela:

| APAGAR | origem (legado) |
|---|---|
| `CODPARCEIRO`, `RAZAO` | parceiro da NF |
| `VALOR` | `FAT.VALOR + TOTAL_DESC_ACORDO/parcelas` (:4501) |
| `DESCONTO` | `TOTAL_DESC_ACORDO/parcelas` quando acordo > 0 (:4513) |
| `DTVENC` | `FAT.DATA` |
| `DTCOMPRA` | `NF.DTEMISSAO` (prova: 10.256 de 10.280) |
| `IDNF`, `NRONF` | a nota |
| `GFAT` | **'S'** (:4506 e gravar :2034) |
| `GERADO` | o fonte manda `'SISTEMA'` (:2036), **mas o dado tem NULO em 10.280 de 10.280** (2025-26) |
| `NRODUP` | **NULO em 10.280 de 10.280** (o prefill põe `RecordCount`, que não chega ao banco) |
| `NRPARCELA` | `'<NROFATURA>/<TOTAL>'` (a partir de `NRO_PARCELA` "n DE t") |
| `TIPODOC` | **'BOLETO'** (editável) |
| `DUPLICATA` | **`NF.NRONF`** (:4522) — **não** a `FAT.DUPLICATA` |
| `CODBARRASBLT` | `FAT.CODBARRASBOLETO` |
| `OBS` | `SetObs` (:5402): `" REFERENTE A NOTA FISCAL <nº> EMITIDA EM dd/mm/aaaa"` (LOG: `" REFERENTE A NOTA FISCAL 10952 EMITIDA EM 22/09/2026"`) |
| `IDSITUACAO_NF` | `SituacaoDeDocumentoFinanceiroNotaFiscal` (situação financeira da situação da NF) |
| `CODPLANOCONTAS_DEB_BAIXA_CP` | `TSituacaoNFBO.GetCodPlanoContasDebCaixaCP` |
| `CODGRUPO` | **um** `GetID('CODGRUPO')` para todas as parcelas |
| `CONTABILIZADO` | 'N' |
| `FORM` | `'TFRMAPAGAR'` |
| rateio `CX_APAGAR` | uma linha por `CODCONTABILNF` (`QryContabilSicomNF`), com `VALOR + TOTAL_DESC_ACORDO` na situação da nota quando há acordo (:4561-4590), `CODGRUPO` do título |
| LOG | `Inseriu`, *"Contas a pagar"*, `APAGAR`, `CODAPG` (no gravar da tela, :2044) |

Com `frmAPagar.Gerado` roda `AtualizarFaturamento('')` (LIBERADO S) e `RegistrarProcessoNf`.
**Não há vínculo por coluna entre APAGAR e FATURAMENTO.** APAGAR não guarda CODFATURAMENTO, e `TIPOREF`/`CODREF` ficam
nulos. O vínculo é **`IDNF` + ordem**. Prova de parcela a parcela (16.300 parcelas de entrada):
- `NRPARCELA = NROFATURA/TOTAL`: 16.257 casam;
- vencimento e valor: 15.676 casam;
- as três coisas juntas: 15.673 casam.

A diferença são as edições do operador na tela de Contas a Pagar.

**`ProcessarAReceber` (:781-986)** abre `TfrmCadAReceber` (`Faturamento := True`), com `dmAReceber.cdsReceber` pré-montado.
Por parcela:
- `IDNF`, `DOCNF=NRONF`, `VALOR=FAT.VALOR`, **`DTVENDA=NF.DTEMISSAO`** (:866; prova 112 de 112), `DTVENC=FAT.DATA`;
- `TOTAL = TOTALNF − TOTAL_BONIFICADO`;
- **`DUPLICATA` = `FAT.DUPLICATA`, ou `'<NRONF> -  NNN/NNN'` quando vazia** (prova: 111 de 112 `'4407 - 001/001'`);
- `NRODUP` = nº de parcelas; `NROPEDIDO` e `CODVENDEDOR` do pedido; `OBS` com *"REFERENTE AO(S) CUPOM(NS)/PEDIDO(S): …"*;
- **`TIPODOC='BOLETO'`**; `IDSITUACAO_NF` e descrição;
- `IDPGTO`/`MODALIDADE` pelo `FORMAS_PGTO` com `MODALIDADE = FAT.MODALIDADE` (:926);
- `CODPLC` pelo `CODCONTABILNF` (não adicional);
- **`CADASTRADO_MANUALMENTE='S'`**; `CONSILIADO='S'` (dado).

Com `PermiteAlterarParcelaFaturamento='SIM'` (ConfigDB.xml) a parcela é editável. Depois de postar, para cada pedido
ligado roda `PEDIDOS.PROCESSO_LIQUIDADO='L'`, `DT_FATU=hoje`, `CX_PEDIDOS.FATURADO='S'`, `DT_PROCESSAMENTO=hoje` e em
seguida `AtualizarFaturamento('')`. Mensagem de erro: *"Erro ao processar conta a receber: "*.

### 1.7 Desfazer — exclusão, cancelamento, reversão, devolução

**`CancelaFaturamento(ACodNF, ATipoNota, AStatusPendencia, ExibeMsg, AControlarTransacao)`** (`uNF.pas:6668-6733`):
1. Sem título (`ExisteFinanceiro`: APAGAR ∪ ARECEBER por IDNF, `udmNF.pas:11787`), sai. **A FATURAMENTO pendente não é tocada.**
2. Com `ESTORNA_FINANCEIRO_NF='S'`:
   - `VerificaExisteBaixas` (`udmNF.pas:11848`: APAGAR_BX/ARECEBER_BX com `COALESCE(INDR,'I')='I'` …) → *"Existem
     documentos financeiros que já foram baixados, agrupados ou contabilizados relacionados à essa nota. Não é possível
     excluir o financeiro. Verifique!"*;
   - senão, com `ESTORNA_FINANCEIRO='S'`, pergunta *"Deseja remover o faturamento e o financeiro desta nota?\nEsta ação é
     IRREVERSÍVEL, pois as contas A PAGAR ou A RECEBER serão excluídas!"*;
   - aceito, roda `ExcluiFaturamento` → *"Financeiro excluído com sucesso!"* + `DesregistrarProcessoNotaFiscal(stGerarFinanceiro)`;
     no erro, *"Houve um erro ao excluir financeiro."*;
   - recusado, roda `AdicionaPendenciaFinanceiro`.
3. Com `ESTORNA_FINANCEIRO_NF<>'S'` (**produção: 'N'**): **`AdicionaPendenciaFinanceiro`** (`uNF.pas:17885`), que faz
   `UPDATE APAGAR|ARECEBER SET STATUS_PENDENCIA = <código> WHERE IDNF = …`. **Títulos e FATURAMENTO ficam.**

Códigos de pendência por chamador:

| código | chamador |
|---|---|
| `'E'` | exclusão da NF (`:4205`) |
| `'C'` | cancelamento (`:6802`, `:6852`, `:6874`, `:16455`) |
| `'N'` | denegada (`:16458`) |
| `'R'` | reversão do processamento (`:9172`) |
| `'D'` | NF de devolução finalidade 4 transmitida, aplicado nas NFs **referenciadas** (`CancelaFaturamentoNFDevolucao` `:6735-6768`, chamada em `:10962` e `:16465`) |

Produção (títulos de NF desde 2025): `R`=352, `D`=438, `A`=1, nulo=17.750.

**`ExcluiFaturamento`** (`udmNF.pas:6436-6626`):
1. Monta os SELECT de LOG e os DELETE:
   - `CX_APAGAR WHERE CODGRUPO = <do 1º título>` (entrada) ou `CAIXA WHERE CODRCB = <do 1º título>` (saída). ⚠️ Só o
     grupo/título do **primeiro** registro; os demais ficam órfãos (bug);
   - acordo comercial (`ARECEBER` + `AUX_ACORDO_COMERCIAL`, entrada);
   - `APAGAR|ARECEBER WHERE IDNF`;
   - **`DELETE FROM FATURAMENTO WHERE IDNF`**.
2. Grava o LOG **antes** da transação, com `FORMULARIO='Nota fiscal'` e `Excluiu` para cada tabela (produção 2025-26:
   APAGAR 272, FATURAMENTO 247, CX_APAGAR 108, ARECEBER 6, CAIXA 6).
3. Executa os DELETE e depois `UPDATE NF SET CANCELA_FATURAMENTO='S'` (*"define se o faturamento será liberado para nova
   inserção ao processar"*).
4. Erro: *"Exclusão do faturamento não realizada, ocorreu o seguinte erro : "*.

Chamada também por "Excluir documentos financeiros" (`ExcluirDocumentosFinanceiros`, `uNF.pas:17710-17752`, gate
`PERMITE_EXCLUIR_FINANCEIRO_DA_NF='S'` (produção **S**), senão *"Você não possui permissão para excluir documentos
financeiros pela nota fiscal! …"*), pelo `btnReverter` do Processar financeiro (`uFinanceiroNotaFiscal.pas:561`) e pelo
da tela Processar (`uEstoqueNF.pas:997`).

**Excluir a NF** (`btnExcluirClick`, `uNF.pas:4073-…`):
- título baixado → *"Está nota fiscal não pode ser excluída\nExistem financeiros relacionados a mesma que estão baixados,
  contabilizados ou agrupados."*;
- **qualquer título** (`ExisteFinanceiro`) → *"Está nota fiscal não pode ser excluída\nExistem financeiros relacionados a
  ela. Para excluí-la, será necessário excluir os financeiros."* (:4116-4121);
- passando pelas duas, dentro da transação: `CancelaFaturamento(…,'E', false, false)` e depois
  **`DELETE FROM FATURAMENTO WHERE IDNF`** (:4228). **A parcela pendente não impede excluir.**

**Reverter o processamento** (`uNF.pas:9000-9172`): lê FATURAMENTO por IDNF (`RetornarValores`) para saber se há
"financeiro". Se houver, `CancelaFaturamento(…,'R')` (produção: pendência 'R'; títulos e FATURAMENTO continuam, `LIBERADO='S'`).

**Cancelar NF-e** (`CancelarNFE` :6802, manual :6852, pelo XML :6874, consulta status :16455): `CancelaFaturamento(…,'C')`.
Produção: **11 NFs de saída canceladas continuam com FATURAMENTO** (e títulos, se houver).

### 1.8 Outros leitores da FATURAMENTO

- Impressão da nota e DANFE: `SetaFAturamento` (`uNF.pas:15709`; `udmNF.pas:5238`) monta o texto *"dd/mm/aaaa DUP: xxx
  valor | "* (4 por linha, `'A VISTA'` quando `DATA=DTEMISSAO`), usado em `rptNota.Variables['FATURAMENTO']` (:14720),
  `MemoFaturamento` e `NFE.Pgtos` (`udmNF.pas:6029/6183`).
- A emissão da NF-e recebe `cdsFaturamento` (`TNFe.Create(…, cdsFaturamento, …)`, `udmNF.pas:5984-5998`) para o
  `<cobr>`. O gerador do XML não está no fonte.
- `DataPrimeiraParcelaNotaDevolucao` (§1.2) e `RegistrarProcessoDeFinanceiro` (`udmNF.pas:4970`: FATURAMENTO `LIBERADO='S'`
  + processo pendente).
- `uTron.pas:2432` (NFC: `FATURAMENTO.MODALIDADE='A VISTA'` por NRONF) e `UNFAnalise.pas:1497` (`DISTINCT modalidade`).
- `uCadProducao.pas:1715` (`DELETE FROM FATURAMENTO`, produção industrial).

---

## 2. Perfil de produção (2025-01-01 → 24/09/2026, por `NF.DTEMISSAO`)

**2.1 Volume** (FATURAMENTO × NF)

| tipo | ano | linhas | NFs | LIB=S | LIB=N | LIB nulo | valor |
|---|---|---|---|---|---|---|---|
| E | 2025 | 9.450 | 8.682 | 9.434 | 4 | 12 | 28.938.285,00 |
| E | 2026 | 6.850 | 6.149 | 6.826 | 4 | 20 | 19.228.441,86 |
| S | 2025 | 140 | 139 | 78 | 62 | 0 | 103.499,11 |
| S | 2026 | 75 | 75 | 36 | 39 | 0 | 57.962,14 |

- Parcelas órfãs (IDNF sem NF): **0**. Com mais de uma parcela: 2.407 linhas (E).
- MODALIDADE 2025-26: `A PAGAR` 16.300 (E) e `A RECEBER` 215 (S). No histórico inteiro também aparecem `BONIFICADO` 16 e
  `APAGAR` 7 (mig 246).
- Colunas **sempre nulas** em 2025-26: `VALOR_DESCONTO`, `VALOR_BONIFICADO`, `CODBARRASBOLETO`, `CODBCO`, `TIPOREF`,
  `CODREF`, `OBS` (0 de 16.515). `NRONF` diferente do da NF: 3 (o `'000000/1'` de antes da numeração).

**2.2 Origem da parcela (assinatura no dado)**

| tipo | CODOPERADOR | DUPLICATA | linhas | origem |
|---|---|---|---|---|
| E | preenchido | `'001'` (3 dígitos, nDup) | **11.752** | importação do XML |
| E | nulo | nulo | 4.540 | `btnGerarFin`, modelo 1 sem `edtNroDup` |
| E | nulo | `NRONF/i` | 8 | modelo 2 (histórico) |
| S | nulo | nulo | 204 | `btnGerarFin` |
| S | nulo | `'000000/1'`, `'83/1'`… | 11 | gerada antes da numeração / modelo 2 |

**2.3 NF × parcelas × títulos** (títulos de entrada sem retenção nem RESIDUAL ST)

| tipo | PROC | parcela+título | parcela sem título | título sem parcela | nenhum | total |
|---|---|---|---|---|---|---|
| E | N | 0 | 23 | 0 | 34 | 57 |
| E | S | **14.800** | 8 | **0** | 859 | 15.667 |
| S | N | 0 | 1 | 0 | 43 | 44 |
| S | S | 111 | 102 | 1 | 1.473 | 1.687 |

- As 859 entradas processadas **sem FATURAMENTO** são CFOPs com `PROC_FINANCEIRO='N'`: 1910 (455), 1949 (204),
  1152 (116), 2910 (34), 1908 (22)… Só 2 têm `PROC_FINANCEIRO='S'`. **O gate do CFOP é real.**
- As 102 saídas processadas com parcela e sem título: CFOP 5411 (47), 6202 (29), 6411, 5202… (devolução de compra, parcela
  nunca faturada) e **11 canceladas** (FATURAMENTO mantido, §1.7).

**2.4 LIBERADO × título**

| tipo | título | LIBERADO | NFs | mesma qtd | mesmo Σ | Σ parcelas = base |
|---|---|---|---|---|---|---|
| E | sim | todas S | 14.790 | 14.782 | **14.781** | **14.790** |
| E | sim | todas N/nulo | 9 | 9 | 9 | 9 |
| E | sim | misto | 1 | 0 | 0 | 0 |
| E | não | todas N/nulo | 29 | — | — | 27 |
| E | não | todas S | 2 | — | — | 2 |
| S | sim | todas S | 110 | 110 | 110 | 110 |
| S | não | todas N | 100 | — | — | 100 |
| S | não | todas S | 3 | — | — | 3 |

- **Σ parcelas = `TOTALNF − bonificado − desc. acordo − desc. pedido − retenções`** em 14.790 de 14.790 (= TOTALNF puro
  só em 14.548; a diferença são as deduções). **Σ títulos = Σ parcelas** em 14.781.
- 9 entradas com título e parcela `LIBERADO` N/nulo (ex.: CODNF 163708, 162989, 161801): título lançado sem passar pelo
  Faturamento (conversão da previsão / Contas a Pagar). 5 com `LIBERADO='S'` sem título: títulos excluídos depois.

**2.5 Os títulos de NF de entrada — dois grupos** (2025-26, sem retenção nem RESIDUAL ST)

| TIPODOC | GFAT | GERADO | DUPLICATA | qtd | caminho |
|---|---|---|---|---|---|
| BOLETO | S | nulo | = NRONF | 8.168 | Faturamento2 → Contas a Pagar |
| CARTÃO PRÓPRIO | S | nulo | = NRONF | 1.552 | idem, TIPODOC editado |
| A VISTA | S | nulo | = NRONF | 432 | idem |
| BOLETO | nulo | SISTEMA | = CODAPG | 6.119 | **previsão do manifesto convertida** (OBS *"PREVISÃO GERADA A PARTIR DO MANIFESTO…"*, desde 2025-03) |
| outros | | | | 11 | |

- Por mês (2026): ~300-480 GFAT e ~340-450 previsão. **Em nenhum título aparecem `GFAT='S'` e `GERADO='SISTEMA'` juntos.**

**2.6 Saída — ARECEBER de NF** (112): `BOLETO`, `CADASTRADO_MANUALMENTE='S'`, `DUPLICATA='NRONF - 001/001'` (111),
`IDPGTO` 23/8/235/203, `DTVENDA=DTEMISSAO` 112 de 112, `CONSILIADO='S'`. Mais 1 `DUPLICATA 'DUP 01/01'` (venda).

**2.7 LOG** (`TABELA='FATURAMENTO'`, `CHAVE='CODNF'`, `VALOR=CODNF`)

| formulário | ação | 2025 | 2026 | campos |
|---|---|---|---|---|
| Notas fiscais de entrada | Inseriu | 9.957 | 7.262 | todos os preenchidos (CODFATURAMENTO, DATA, IDNF, MODALIDADE, VALOR, [LIBERADO], [CODOPERADOR], NROFATURA, TOTALPARCELASFATURA, NRONF, [DUPLICATA]) |
| Notas fiscais de entrada | Alterou | 7.431 | 5.065 | **CODFATURAMENTO 12.494 de 12.496** (renumeração do processar), VALOR 350, DATA 330, CODBARRASBOLETO 4, **LIBERADO 0** |
| Notas fiscais de entrada | Excluiu | 278 | 1.140 | todos (Limpar / regerar) |
| Notas fiscais de saída | Inseriu / Alterou / Excluiu | 165 / 47 / 13 | 92 / 39 / 3 | idem |
| **Nota fiscal** | Excluiu | 151 | 96 | `ExcluiFaturamento` (formato *"Excluiu: dd/mm/aaaa hh:mm:ss\nCampo: CODFATURAMENTO   Valor: …"*) |

Amostra Inseriu (importação, 24/09/2026 17:55): *"INSERIU: 24/09/2026 17:55:09\n CAMPO: CODFATURAMENTO   VALOR: 117512\n
CAMPO: DATA   VALOR: 22/10/2026\n CAMPO: IDNF   VALOR: 163995\n CAMPO: MODALIDADE   VALOR: A PAGAR\n CAMPO: VALOR   VALOR:
487,5\n CAMPO: CODOPERADOR   VALOR: 50\n CAMPO: NROFATURA   VALOR: 1\n CAMPO: TOTALPARCELASFATURA   VALOR: 1\n CAMPO: NRONF
VALOR: 10952\n CAMPO: DUPLICATA   VALOR: 001"*. Amostra Alterou (processar, 17:56:28): *"CAMPO: CODFATURAMENTO    VALOR
ANTERIOR: 117512    VALOR ATUAL: 117513"*. O título dessa nota (CODAPG 75705) foi gravado 19 s depois (*"Contas a
pagar"* Inseriu, DUPLICATA 10952, GFAT S, NRPARCELA 1/1).

**2.8 Configurações (produção)**

| config | valor | efeito |
|---|---|---|
| `ESTORNA_FINANCEIRO_NF` | **N** | cancelar/reverter/excluir só marca pendência; nada é apagado |
| `ESTORNA_FINANCEIRO` | N | sem pergunta de confirmação (só vale com a anterior em S) |
| `PERMITE_EXCLUIR_FINANCEIRO_DA_NF` | **S** | menu "Excluir documentos financeiros" e "Processar financeiro" liberados |
| `BONIFICACAO_FATURAMENTO_NF` | **S** | botão Bonificar (F4) visível no Faturamento |
| `FINANCEIRO_BONIFICACAO_ACORDO` | N | CFOP 1910/2910 não libera o gerar pelo acordo |
| `QUANTIDADE_DIAS_GERAR_BOLETO_DEVOLUCAO` | 15 | vencimento da devolução |
| `EMPRESAS.MODELO_DUPLICATA` / `SEPARADOR_DUPLICATA` | 1 / nulo (5 empresas) | DUPLICATA vazia sem `edtNroDup` |
| `CFOP.GERA_FINANCEIRO_AUTO` | nunca S | financeiro automático nunca roda |
| `CFOP.PROC_FINANCEIRO` | S em 356 de 398 | gate do gerar parcelas |
| `VisualizaFaturamento`, `PermiteAlterarParcelaFaturamento`, `DeletaFinanCupom` | ConfigDB.xml da estação (padrão SIM / NÃO) | fora do banco |
| `LOTE_FATURAMENTO` / `_DETALHE` | 0 / 0 linhas | lote morto |

---

## 3. O app hoje

| Peça | O que faz | Onde |
|---|---|---|
| `NfFaturamentoService.faturar` | Recebe `{numParcelas, primeiroVencimento, intervaloDias, tipodoc?}` e grava **títulos direto** em apagar/areceber: rateio em centavos (sobra na última), base = `totalnf − retenções geradas`, duplicata `"<nronf> - 001/00N"`, `nrodup=N`, apagar com `gfat='S'`, `gerado='SISTEMA'`, `codgrupo`, OBS e `nrparcela`, rateio CX_APAGAR + CAIXA do grupo. Converte a previsão do manifesto, gera retenção federal + RESIDUAL ST, e faz `nf.faturada` N→S (CAS) | `apps/api/src/modules/cadastro/nf-faturamento.service.ts:369-432` |
| `faturarComParcelas` | Mesmo destino, a partir do `<cobr><dup>` (1 título por dup, `duplicata=nDup` com 20 caracteres, `tipodoc='BOLETO'`) | `:441-492` |
| `estornarFaturamento` | Exige `faturada='S'`, bloqueia contabilizada e quitada, apaga rateio e títulos por idnf, faz `faturada` S→N | `:494-537` |
| `estornarNoCancelamento` | Dentro do cancelamento/reversão: apaga títulos (se nada quitado) e zera `faturada` | `:548-580` |
| Importação XML | Gate `finNFe ∉ {2,3,4}` **e** `cfop.gera_financeiro_auto='S'` chama `faturarComParcelas`. **Não grava FATURAMENTO** | `compras/recebimento.service.ts:462-482` |
| Refaturar do XML | `POST compras/importacao-nfe/:codnf/refaturar-xml` (sem botão na web) | `recebimento.service.ts:492-506` |
| Reversão | Com `faturada='S'`: ESTORNA=S e nada baixado → estorno; senão `status_pendencia='R'` | `nf-processamento.service.ts:156,217-231` |
| Cancelamento NF-e | Com `faturada='S'` e ESTORNA=S → `estornarNoCancelamento`. **Com N não faz nada** (não marca 'C') | `nf-nfe.service.ts:328-333` |
| Excluir NF | `faturada='S'` → 422 `NF_TEM_FATURAMENTO` | `nf.aggregate.ts:340` |
| Devolução de compra | `faturar(codnf, {1 parcela, venc, 0, 'BOLETO'})`; base do venc = menor `apagar.dtvenc` da NF referenciada (`nf_referencia`), não FATURAMENTO/`PEDIDO_DEVOLUCAO_COMPRA_ITENS` | `compras/devolucao-compra.service.ts:440-466` |
| Tela NF (web) | Seção "Faturas": Nº parcelas / 1º venc / intervalo → "&Gerar financeiro", ou "&Estornar faturamento" quando `faturada='S'`. `faturada='S'` **trava a edição da nota** | `apps/web/src/features/nf/NfCadMaster.tsx:229-237, 679-748` |
| Consulta FRMFATURAMENTO2 | Só leitura sobre `faturamento` (PROC=S, cores, totais) | `compras/faturamento.service.ts`, `web/features/faturamento/FaturamentoPage.tsx` |
| Carga | `pos-carga.sql:47-53`: `UPDATE nf SET faturada='S'` quando há título por idnf | `tools/cutover/pos-carga.sql` |
| Smoke | checks 20.x (`faturada` S/N, `NF_JA_FATURADA`, `NF_TEM_FATURAMENTO`) | `apps/api/scripts/smoke.ts:1569-1792` |

---

## 4. Lacunas (app × legado)

**G1 — A FATURAMENTO não é escrita (raiz).** Gerar parcelas, importar XML e processar não gravam `faturamento`. Com o app no
ar, toda nota nova fica fora da tela de Faturamento, do `DataPrimeiraParcelaNotaDevolucao`, da impressão, do `<cobr>` e
do LOG, e o histórico (47.219 linhas) para de crescer.

**G2 — O passo "parcela → título" sumiu.** O legado tem 2 tempos (parcela editável na nota; título no Faturamento, por
parcela selecionada, com a tela de Contas a Pagar aberta para ajuste). O app faz tudo num clique. Não existem: seleção
por parcela, Bonificar, parcela pendente ("A faturar"), abrir sozinho depois do processar/transmitir, e a regra
*"Envie a nota antes de gerar o faturamento!"*.

**G3 — Base da parcela.**
- Legado: `TOTALNF − TOTAL_BONIFICADO − TOTAL_RETENCOES − TOTAL_DESC_ACORDO − TOTAL_DESC_PEDIDO` (Σ = base em 14.790 de
  14.790).
- App: `totalnf − Σ retenções geradas`. Ignora bonificado e os descontos de acordo e de pedido.
- O acordo volta no título: `VALOR = parcela + acordo/n` e `DESCONTO = acordo/n`. O app não faz isso.

**G4 — Forma do vencimento.**
- Legado: `BuildParcelas` com dia fixo (`PARCEIROS.VENC_PREV`) ou intervalo (`DIASPRAZO`) pré-carregados do parceiro,
  pergunta "próximo mês", condição do pedido (modelo 02) e 1º vencimento da devolução.
- App: só 1º venc + intervalo digitados, com padrão fixo de 30.

**G5 — A importação do XML.**
- Legado: a importação grava parcelas (`nDup`, `dVenc`, `vDup`, `CODOPERADOR`, `LIBERADO` nulo) e **não cria título**.
- App: não grava parcelas, e cria título só com `gera_financeiro_auto='S'`, o que **nunca acontece em produção**. Resultado:
  as datas e valores reais do `<cobr>` (72% das parcelas de entrada) se perdem, e o operador cai no F4 digitado.
- O refaturar-xml existe, mas sem botão na web.

**G6 — Forma do título de entrada** (contra o dado, 10.280 de 10.280 títulos GFAT):

| coluna | legado (dado) | app |
|---|---|---|
| `GERADO` | NULO | 'SISTEMA' |
| `NRODUP` | NULO | N |
| `DUPLICATA` | **NRONF** | `'<nronf> - 00i/00N'` ou `nDup` |
| `TIPODOC` | 'BOLETO' (padrão, editável) | nulo no F4 manual |
| `FORM` | 'TFRMAPAGAR' | não grava |
| `CODBARRASBLT` | da parcela | não existe |
| `IDSITUACAO_NF` / `CODPLANOCONTAS_DEB_BAIXA_CP` | preenchidos | a conferir no insert (hoje ausentes) |
| LOG | *"Contas a pagar"* `Inseriu` | não grava |

⚠️ O comentário de `nf-faturamento.service.ts:88-90` ("GFAT='S' e GERADO 'SISTEMA'… 3.430 títulos") **não bate com o dado**
(3.433 GFAT em 2026, todos com GERADO nulo). O grupo com GERADO 'SISTEMA' é a previsão convertida, que não tem GFAT.

**G7 — Forma do título de saída.**
- `DTVENDA`: legado DTEMISSAO (112 de 112); app DTCONTABIL.
- `DUPLICATA`: legado usa `FAT.DUPLICATA` quando existe; app nunca usa.
- Ausentes no app: `TIPODOC='BOLETO'`, `CADASTRADO_MANUALMENTE='S'`, `TOTAL=TOTALNF−bonificado`, `IDPGTO` por
  `FORMAS_PGTO.MODALIDADE=FAT.MODALIDADE`, `CODPLC` do CODCONTABILNF, `NROPEDIDO`/`CODVENDEDOR`, OBS de pedidos e a baixa
  `PEDIDOS.PROCESSO_LIQUIDADO`/`CX_PEDIDOS.FATURADO`.

**G8 — LIBERADO não existe no app.** A marca por parcela (`UPDATE … LIBERADO='S'` por CODFATURAMENTO, sem LOG) vira um flag
por nota. A nota com parte das parcelas faturadas (dado: 2 NFs "misto") não tem como ser representada.

**G9 — Desfazer.**
- (a) O app apaga títulos mas nunca a FATURAMENTO. O legado apaga os dois e marca `CANCELA_FATURAMENTO='S'`.
- (b) Com ESTORNA=N (produção), o app só marca a pendência 'R' na reversão. Faltam **'C'** (cancelamento), **'N'**
  (denegada), **'E'** (exclusão) e **'D'** (devolução finalidade 4 nas NFs referenciadas; 438 títulos em 2025-26).
- (c) Faltam o LOG `'Nota fiscal'` / `Excluiu` de APAGAR, FATURAMENTO, CX_APAGAR, ARECEBER e CAIXA e o
  `DesregistrarProcessoNotaFiscal(stGerarFinanceiro)`.
- (d) Excluir NF: o legado apaga a FATURAMENTO e só barra por **título existente**, com mensagem verbatim. O app barra
  pelo flag.
- (e) "Excluir documentos financeiros" (gate `PERMITE_EXCLUIR_FINANCEIRO_DA_NF`) não existe como ação separada.

**G10 — LOG da FATURAMENTO.** Faltam `Inseriu`, `Alterou` e `Excluiu` com `FORMULARIO` por tipo, `TABELA='FATURAMENTO'`,
`CHAVE='CODNF'` (29.476 linhas de LOG em 2025-26).

**G11 — Retenções, funrural, acordo e RESIDUAL ST fora do lugar.** No legado nascem no **processar**
(`udmNF.pas:7771-7775`), independentes do Faturamento. No app nascem dentro do `faturar`.

**G12 — Leitores que dependem da FATURAMENTO.**
- Vencimento da devolução: o app usa proxy por `apagar`.
- Texto de faturamento da impressão/DANFE e `<cobr>` da NF-e própria: o app não emite `<cobr>` (SEFAZ simulada).
- A FaturamentoPage vai ficar vazia para as notas novas.

**G13 — `nf.faturada` não existe no Oracle.** É estado inventado e duplicado. A verdade do legado é
**"tem título por IDNF"** (`ExisteFinanceiro`) + **"tem parcela pendente"** (`ExisteFaturamentoAGerarFinanceiro`).
- O flag diverge sozinho: título apagado na tela de Contas a Pagar deixa `faturada='S'` sem título, e título lançado por
  fora deixa `faturada='N'` com título.
- A trava de edição da nota por `faturada` (`NfCadMaster.tsx:236`) **não existe no legado**. O `btnEditarClick` só barra
  PROC, contabilizada e dia fechado, como `nf.aggregate.ts:219` já registra.

**G14 — Bug do legado a NÃO copiar.** O `ExcluiFaturamento` apaga só o CX_APAGAR/CAIXA do **primeiro** título (grupo único
na entrada, o que fica certo porque o grupo é um só; na saída sobra CAIXA dos demais CODRCB). Registrar como divergência
consciente se o app apagar todos.

---

## 5. Plano de cortes

> Princípio: a FATURAMENTO volta a ser a **fonte** do financeiro da nota, e o título sai dela, parcela por parcela, como no
> legado. Toda coluna do legado existe e é gravada (lição "todos os campos"). Nada de regra de produção desligada em silêncio.

### Corte A — A parcela na nota (escrita da FATURAMENTO)

1. **Detalhe `faturamento` no agregado da NF** (`nf.aggregate.ts` `detalhes`, FK `idnf → codnf`):
   - grava junto com a nota (mesma transação);
   - campos: `codfaturamento` (seq), `data`, `idnf`, `modalidade`, `valor`, `liberado`, `obs`, `codoperador`, `nrofatura`,
     `totalparcelasfatura`, `tiporef`, `codref`, `nronf`, `codbco`, `duplicata`, `valor_desconto`, `valor_bonificado`,
     `codbarrasboleto` (sem acento nem especial, `BeforePost`);
   - **LOG** `{ tabela: 'FATURAMENTO', chave: 'CODNF', formularioDe: formularioDaNf }` com Inseriu, Alterou e Excluiu por
     linha.
2. **`POST /fiscal/nf/:id/gerar-parcelas`**: calcula e **não grava título**.
   - Entrada `{numParcelas, vencimento, intervalo, diaFixo?, nroDup?}`; os padrões vêm de `PARCEIROS.VENC_PREV`/`DIASPRAZO`.
   - Monta **BuildParcelas** (sobra: golden por ora; Σ fecha ao centavo).
   - Base = `TOTALNF − TOTAL_BONIFICADO − TOTAL_RETENCOES − TOTAL_DESC_ACORDO − TOTAL_DESC_PEDIDO`.
   - `LIBERADO='N'`, `NRONF`, `MODALIDADE` ('A PAGAR' / 'A RECEBER' / TIPODOC do vencimento do pedido no modelo 02),
     `DUPLICATA` por `EMPRESAS.MODELO_DUPLICATA`/`SEPARADOR_DUPLICATA` (modelo 1: `nroDup SEP yy SEP letra` ou vazio;
     modelo 2: `NRONF SEP i`, exceto CHEQUE).
   - Gates: CFOP sem `PROC_FINANCEIRO='S'` (salvo 1910/2910 + `FINANCEIRO_BONIFICACAO_ACORDO`); 1910/2910 com senha ADM;
     sem título por IDNF; `PROC<>'S'`; `CANCELA_FATURAMENTO<>'N'`.
   - Devolução: 1º venc por `DataPrimeiraParcelaNotaDevolucao` **lendo FATURAMENTO** + `PEDIDO_DEVOLUCAO_COMPRA_ITENS`.
   - "Próximo mês" como pergunta na web.
   - Mensagens verbatim de §1.2.
3. **Grade de parcelas na aba Financeiro** (web). Colunas **Nº, Data, Duplicata, Modalidade, Valor, Código de barra boleto**
   editáveis. Botões "Gerar financeiro" / "Gerar financeiro bonificação", "Limpar" (*"Deseja apagar todos dados financeiros
   cadastrados?"*) e "Gerar sequência de duplicatas" (`GetID('NRODUP')`). Mostrar o valor a faturar.
4. **Importação do XML grava as parcelas** do `<cobr><dup>`: `DUPLICATA=nDup` (65 caracteres, sem truncar), `DATA=dVenc`,
   `VALOR=vDup`, `CODOPERADOR`, `LIBERADO` nulo. **Tirar o auto-título do import** (`recebimento.service.ts:476-481`); o
   gate nunca dispara em produção, e o título passa a nascer no Corte B. O `refaturar-xml` passa a regravar as
   **parcelas**, e só quando não há título.
5. **Processar**: confere Σ parcelas = base (*"O total das faturas é diferente do valor da nota. Confira!"*) quando o CFOP
   libera o financeiro. Registrar como divergência consciente a renumeração de `CODFATURAMENTO` do legado (não copiar; o
   LOG "Alterou CODFATURAMENTO" some).
6. Quando a nota recebe número (transmissão/numeração): `UPDATE faturamento SET nronf` por idnf (`NFe.pas:4666`).

Verde: smoke (gerar → grade → gravar → LOG Inseriu/Excluiu), import com `<cobr>` grava N parcelas e 0 títulos.

### Corte B — Faturar = parcela pendente → título (o `TfrmFaturamento2`)

1. **`POST /fiscal/faturamento/processar`** `{codfaturamento[], ajustes?}`, uma transação.
   - **Entrada**: para as parcelas marcadas (uma NF, um `CODGRUPO`), um APAGAR por parcela no **shape do dado**:
     - `GFAT='S'`, `GERADO` nulo, `NRODUP` nulo, `NRPARCELA='n/t'`, `DUPLICATA=NF.NRONF`, `TIPODOC='BOLETO'` (editável:
       CARTÃO PRÓPRIO, A VISTA);
     - `DTCOMPRA=DTEMISSAO`, `DTVENC=FAT.DATA`, `VALOR=FAT.VALOR+acordo/n`, `DESCONTO=acordo/n`,
       `CODBARRASBLT=FAT.CODBARRASBOLETO`;
     - `IDSITUACAO_NF` (situação financeira), `CODPLANOCONTAS_DEB_BAIXA_CP`, `CONTABILIZADO='N'`, `FORM='TFRMAPAGAR'`, OBS
       `SetObs`;
     - rateio CX_APAGAR pelo CODCONTABILNF (acordo somado na situação da nota) e CAIXA do grupo (reusar
       `rateioDoFaturamento`/`refazerCaixaDoGrupo`), mais o LOG *"Contas a pagar"* `Inseriu`.
   - A **conversão da previsão do manifesto** continua aqui (`converterPrevisoesDoManifesto`), com o valor e o vencimento
     da parcela.
   - **Saída**: um ARECEBER por parcela: `DTVENDA=DTEMISSAO`, `DUPLICATA=FAT.DUPLICATA` ou `'NRONF -  NNN/NNN'`,
     `NRODUP=n`, `TOTAL=TOTALNF−bonificado`, `TIPODOC='BOLETO'`, `IDPGTO` por `FORMAS_PGTO.MODALIDADE=FAT.MODALIDADE`,
     `CODPLC` do CODCONTABILNF, `CADASTRADO_MANUALMENTE='S'`, `CONSILIADO='S'`, `NROPEDIDO`/`CODVENDEDOR`, OBS de pedidos.
     Depois, `PEDIDOS.PROCESSO_LIQUIDADO='L'`, `DT_FATU` e `CX_PEDIDOS.FATURADO='S'`, `DT_PROCESSAMENTO`.
   - Por parcela: `UPDATE faturamento SET liberado='S' WHERE codfaturamento=…` (**sem LOG**, como o legado) e
     `NF_STATUS_PROCESSO` `stGerarFinanceiro` (entrada com chave).
2. **`POST /fiscal/faturamento/bonificar`**: `LIBERADO='S'` + `MODALIDADE='BONIFICADO'`, sem título. Gate
   `BONIFICACAO_FATURAMENTO_NF='S'`.
3. **Web**:
   - a `FaturamentoPage` vira operacional: seleção por parcela (espaço/clique, "marcar todas"), **Processar (F2)** abre o
     pré-lançamento editável de Contas a Pagar / A Receber, **Bonificar (F4)**;
   - na NF, botão **"Faturamento"** com os gates e mensagens de §1.6: *"Envie a nota antes de gerar o faturamento!"* e
     *"Não existe faturamento pendente para esta nota fiscal a ser processado."*;
   - o modal abre sozinho depois do processar e da autorização SEFAZ quando há parcela pendente (config por operador no
     lugar do `VisualizaFaturamento` do ConfigDB.xml, padrão SIM).
4. Aposentar `faturar` (DTO de parcelas) e `faturarComParcelas` como geradores de título. A devolução de compra passa a
   gerar **parcela** (A) e faturar (B).

Verde: golden por NF de 2026. Parcela → título casa **NRPARCELA + DTVENC + VALOR** (meta: o mesmo 96% de
`casa_tudo=15.673/16.300`, com a diferença explicada pela edição do operador). Σ títulos = Σ parcelas.

### Corte C — Desfazer igual ao legado

1. **`ExcluiFaturamento`** no app (serviço único):
   - apaga CX_APAGAR/CAIXA de **todos** os grupos/títulos (divergência consciente de G14), acordo comercial
     (ARECEBER + AUX_ACORDO_COMERCIAL), APAGAR/ARECEBER por IDNF e **FATURAMENTO por IDNF**;
   - `NF.CANCELA_FATURAMENTO='S'`;
   - LOG `'Nota fiscal'` `Excluiu` por linha de cada tabela;
   - `DesregistrarProcessoNotaFiscal(stGerarFinanceiro)`.
2. **`CancelaFaturamento(codnf, tipo, código)`** no app:
   - sem título, sai;
   - `ESTORNA_FINANCEIRO_NF='S'`: com baixa, mensagem verbatim; sem baixa, (`ESTORNA_FINANCEIRO='S'`: confirmação)
     `ExcluiFaturamento`;
   - senão, `STATUS_PENDENCIA=<código>`.
   - Chamadores: exclusão **'E'**, cancelamento **'C'**, denegada **'N'**, reversão **'R'** (já existe; migrar para o
     serviço único) e devolução finalidade 4 transmitida **'D'** nas NFs referenciadas (`CancelaFaturamentoNFDevolucao`).
3. **Excluir NF**:
   - bloqueio por **título existente**: *"Está nota fiscal não pode ser excluída\nExistem financeiros relacionados a ela.
     Para excluí-la, será necessário excluir os financeiros."*;
   - bloqueio por título baixado: mensagem verbatim;
   - senão apaga a FATURAMENTO junto.
4. Ação **"Excluir documentos financeiros"** na NF (gate `PERMITE_EXCLUIR_FINANCEIRO_DA_NF`, mensagem verbatim) =
   `ExcluiFaturamento`.

### Corte D — Aposentar `nf.faturada` (migração de semântica)

Substituir o flag por dois predicados derivados, **iguais aos do legado**:
- `temFinanceiro(codnf)` = `EXISTS apagar|areceber WHERE idnf` (`ExisteFinanceiro`, `udmNF.pas:11787`);
- `temFaturamentoPendente(codnf)` = `EXISTS faturamento WHERE idnf AND coalesce(liberado,'N')='N'`
  (`ExisteFaturamentoAGerarFinanceiro`, `udmNF.pas:11766`).

Leitores do flag e o que cada um passa a usar:

| leitor | hoje | depois |
|---|---|---|
| `nf-faturamento.service.ts:73` `carregarNfFaturavel` | `faturada==='S'` → NF_JA_FATURADA | some (o gerar exige `!temFinanceiro`; o processar exige parcela pendente) |
| `:359-367` `marcarFaturada` / `:509,528-535` estorno / `:573-578` | CAS em `faturada` | removidos; idempotência por `liberado` da parcela (`UPDATE … WHERE liberado IS DISTINCT FROM 'S'`, 0 linhas = corrida perdida) |
| `nf-processamento.service.ts:128,156` | `faturada==='S'` → CancelaFaturamento 'R' | `temFinanceiro` (legado: `RetornarValores('FATURAMENTO','IDNF')` + `ExisteFinanceiro`) |
| `nf-nfe.service.ts:247,331` | `faturada==='S' && ESTORNA` | `CancelaFaturamento(…,'C')` sempre (ele mesmo checa título e config) |
| `nf.aggregate.ts:208-213,332,340` | NF_TEM_FATURAMENTO por flag | `temFinanceiro` com a mensagem verbatim (§1.7) |
| `NfCadMaster.tsx:234-237,266-267` | `faturada` trava a nota | **remover da trava** (o legado não trava por financeiro); o painel mostra "tem financeiro" / "parcelas pendentes" vindos do GET |
| `NfCadMaster.tsx:685-745`, `nfFaturamentoApi.ts` | Faturar/Estornar pelo flag | grade de parcelas (A) + botão Faturamento (B) + Excluir documentos financeiros (C) |
| `all-exceptions.filter.ts:295-296` | NF_JA_FATURADA / NF_NAO_FATURADA | trocar pelas mensagens verbatim do legado |
| `tools/cutover/pos-carga.sql:47-53` | deriva `faturada` na carga | apagar o UPDATE |
| `apps/api/scripts/smoke.ts:1569-1792` | checks de `faturada` | reescrever sobre parcelas/títulos |
| `packages/shared` (`FaturarNfDto`) | DTO do F4 | substituir pelos DTOs de A e B |

Migração SQL: expor os 2 predicados no GET da NF (campos calculados). Depois de A-C verdes, `ALTER TABLE nf DROP COLUMN
faturada` (a coluna não existe no Oracle, então sai do "todos os campos" sem perda). Conferir `setval('seq_faturamento',
max(codfaturamento)+1)` no pós-carga, porque o app volta a gravar na tabela.

### Corte E — Tirar do `faturar` o que o legado faz no processar

Retenção federal (`GerarAPagarDeRetencoes`), FunRural, A Receber de acordo comercial e RESIDUAL ST vão para o **processar**
(`udmNF.pas:7771-7775`; o gravar de `uFinanceiroNotaFiscal.pas:278-281` repete a sequência). A regra de cada um já existe
em `nf-faturamento.service.ts` (`gerarTitulosRetencao`, `gerarTituloStResidual`); só muda o gatilho. A base da parcela
(Corte A) já desconta `TOTAL_RETENCOES` computado, como o legado.

### Ordem e dependências

A → B → C → D (D só depois de B e C, porque os leitores migram para predicados que dependem da FATURAMENTO escrita).
E pode ir junto de B.
