<!-- Recon de 24/09/2026. Produção Oracle só leitura (SET TRANSACTION READ ONLY, só SELECT) + fonte de mai/2020. Nada foi alterado no repositório além deste arquivo. Scripts e fontes convertidos em scratchpad/bxa/. -->

# FRMBAIXAAPAGAR — Baixa de contas a pagar: especificação de conversão

**8.497 acessos. É a tela financeira mais usada.** Fontes lidas: `UBaixaApagar.pas` (1.823 linhas) e `.dfm` (3.287),
`Units/UdmBaixaApagar.pas` (429) e `.dfm` (1.247) — é a unit que o `Retaguarda.dpr:146` compila; a cópia em `DmOld/` é
morta —, `UlancChequesBXapg.pas` (378), `UReversaoBaixaContasPagar.pas` (327), `UReversaoBaixa.pas`,
`UConsAPGbx.pas:203-290` (entrada da manutenção), `UIntegracaoContabil.pas:1587-1900`, `udmPrincipal.pas:2254-2376`
(`ValidaSaldoAnteriorNew`) e `:3877-3928` (`GetSaldoContaCorrente`).

**Duas classes não vieram no fonte:** `TContasBancariasOpBO` (`..\Util\BO\BO.ContasBancariasOp.pas`, `Retaguarda.dpr:901`)
e `TContasBancariasVO`. O que elas fazem foi deduzido do cadastro (`uRDmCadContaBancaria.dfm:143-147`) e do dado.

Onde o fonte (mai/2020) e o dado de produção discordam, **vale o dado**. Cada caso aparece marcado com ⚠️ **binário novo**.

---

## 0. Correções de premissa (o que se sabia e não se confirma)

| Premissa | O que a produção mostra |
|---|---|
| "Em 2026 são 1.029 lotes de baixa de AP" | Os 1.029 IDLOTEs de `APAGAR_BX` de 2026 têm **três escritores**. Separando pelo `APAGAR_BX.OBS`: **FRMBAIXAAPAGAR = 556** (526 ativos + 30 revertidos); **lançamento de caixa (FRMMOVCAIXA) = 467**, porque a despesa gera um título já quitado com OBS `DOCUMENTO BAIXADO VIA LANCAMENTO DE CAIXA…`; **desconto de títulos = 5**; e 1 lote com DTPGTO de 2027 (erro de digitação). |
| "795 lotes têm 1 documento e 172 têm 21+" | A conta mistura os escritores. Só FRMBAIXAAPAGAR, ativos, 2026: **306 com 1 doc · 21 com 2-5 · 37 com 6-20 · 162 com 21+** (máximo de 104 docs). |
| "Modalidades DINHEIRO/CXA e BOLETO/RCB (13)" | Nenhum usuário escolhe BOLETO. O IDPGTO 8 é a **única** forma de pagamento da empresa 50. A tela abre `FORMAS_PGTO WHERE IDEMPRESA = empresa logada` (`UdmBaixaApagar.pas:400-404`). Quando o `Locate('MODALIDADE','DINHEIRO')` falha (`UBaixaApagar.pas:1250`), o cursor fica no primeiro registro, que é o BOLETO. **É um artefato de quem entrou logado na empresa 50.** Nos 994 lotes de 2025-26 o IDPGTO segue a empresa do **login**, não a do título nem a da conta (idpgto 204 = DINHEIRO da empresa 2, com conta e títulos da empresa 1 em 29 lotes). |
| "MCB grava IDEMPRESA e CODOPERADOR" | `MOV_CONTAS_BANCARIAS` **não tem** coluna IDEMPRESA (só `IDEMPRESA_FECHAMENTO`). `CODOPERADOR` existe, mas está **nulo em 994/994**: a baixa não preenche (o `sqqContaCorrente` nem seleciona a coluna, `UdmBaixaApagar.dfm:815-848`). |
| "Sempre 1 recurso por lote" | ✅ Confirmado: 994/994 lotes de 2025-26 têm exatamente 1 linha de MCB. A tela aceita N recursos, mas ninguém usa. |

---

## 1. Os números (produção; só FRMBAIXAAPAGAR; lotes ativos)

| | 2025 | 2026 (até 24/09) |
|---|---:|---:|
| lotes ativos · baixas (linhas de `APAGAR_BX`) | 468 · 9.272 | 526 · 6.712 |
| lotes revertidos (`INDR='E'`) | 46 | 30 |
| lotes com 1 doc · 2-5 · 6-20 · 21+ | 167 · 30 · 38 · 233 | 306 · 21 · 37 · 162 |
| lotes com mais de um fornecedor | 277 | 214 |
| lotes que misturam títulos de **empresas diferentes** | 280 | 200 |
| recursos por lote | 1 (sempre) | 1 (sempre) |
| recurso em conta **caixa** (`CODBCO=0`) · em **banco** | 5 · 463 | 220 · 306 |
| recurso com `LIBERADO='N'` | 0 | 1 (lote 90137, conta 263) |
| lotes com **baixa parcial** (título-saldo `ORIGEM='B'`) | 77 | **254** |
| lotes com acréscimo · com desconto (`ACRE_DESC>0` · `<0`) | 105 · 203 | 47 · 144 |
| lotes com **juros** (`APAGAR_BX.JUROS>0`) | 0 | 0 (0 em toda a história; 0 linhas de CAIXA "Ref. juros") |
| lotes com linha na CAIXA ("BAIXA APAGAR") | 203 | 101 |
| cheque próprio · cheque de terceiros · devolução | 0 · 0 · 0 | 0 · 0 · 0 (`CHQ_PROPRIO`, `CHEQUE_REP`, `RELACAO_CHQ_PROP`, `BX_APAGAR_CRT_PROPRIO` têm **0 linhas**; nenhum MCB de lote de AP foi CHEQUE ou DEVOLUCAO desde 2004) |
| documentos de adiantamento (`CODADIANTAMENTO`) | 0 | 0 |
| arquivo retorno (`APAGAR.RETORNO_OP`, `APAGAR_BX.NOME_RETORNO`) | 0 | 0 (e `RETORNO_DIRETORIO` está nulo, o que bloqueia o botão) |
| manutenção de lote (reverte e regrava em ≤ 10 min) · reversão pura | 55 · 21 (2025-26 somados) | |
| baixas contabilizadas (`CONTABILIZADO='S'`) | 9.261 / 9.272 | 6.624 / 6.712 |
| MCB conciliado depois (`MOV_CONCILIADO='S'`) | 514 / 994 (2025-26) | |
| operadores que baixaram | 10 (FLAVIA 363 lotes, LETICIA ADM 201, SUIAME 141, LARISSA FREITAS 104…) | |

**A parcial de 2026 tem um único padrão.** Dos 254 lotes, 201 são **1 título pago de pouco em pouco pela CONTA SANGRIAS**
(conta 201, `CODBCO=0`), com média de R$ 308,43. Em 246 desses, o título pai já era um saldo de outra parcial: é uma
cadeia. Os títulos são de 3 fornecedores, e 240 são da PINHEIRAO SERVIÇOS ADMINISTRATIVOS (conta-corrente intercompany).
**Parcial em conta caixa é o caso mais frequente de 2026.** Não é borda.

Contas usadas (2025-26, lotes): 42 ITAÚ (1), 263 CEF (1), 441 CEF (2), 421 (2), 201 CONTA SANGRIAS (caixa, 1),
61 FLAVIA (caixa, 1), 601 (52), 461 (51), 182 (1), 297 CONTA SANGRIA C (caixa, 2).

---

## 2. O fluxo, com o que cada passo grava

### 2.1 Iniciar baixa: montar o lote (`btnAdicionarRegistroClick`, `UBaixaApagar.pas:292-372`)

1. `TipoBaixa := tbNormal`, `IdLoteManutencao := 0` (:299-300).
2. Abre a pesquisa `GET_APAGAR` com o filtro `CODIGO_EMPRESA in (<GetMultiEmpresa>)` (:301-302), em **multisseleção** (:304).
   Colore em vermelho `BLOQUEIO='S'` ("Compromisso bloqueado") e em azul `FORNECEDOR_POSSUI_DEBITO='S'` ("Fornecedor possui
   débito") (:309-323). **Só colore, não bloqueia.** Na produção `APAGAR.BLOQUEIO` é nulo em 100% das linhas.
3. A view `GET_APAGAR` de produção já filtra `QUITADA='N' AND COALESCE(ADCREDITO,'N')='N' AND COALESCE(AGRUPADO,'N')='N'`.
   Por isso título quitado ou agrupado não aparece: não existe mensagem de "já quitado", a lista simplesmente não o traz.
   `VALOR` da view = `P.VALOR + COALESCE(P.VENDOR,0) - COALESCE(P.DESCONTO,0)`; `JUROS` = `COALESCE(P.TXJUROS,0)`.
4. Recarrega os escolhidos com `SELECT * FROM GET_APAGAR WHERE CODIGO IN (…)` (:344-347).
5. **Aloca o lote na hora de abrir**: `IdLoteBaixa := GetID('IDLOTE')` (:355). Cancelar descarta o número, que se perde.
6. Abre os datasets de recurso/cheque pelo lote (:357-367). Data da baixa = `now` (:369).

**Adicionar/excluir documento com o lote aberto:**
- `BtnNovoDocumentoClick` (:888-947): pesquisa `GET_APAGAR` com `1=1 AND CODIGO NOT IN (<já na grade>)`, **sem** o filtro
  de empresa. Recusa com recurso lançado: "Exclua os recursos antes de adicionar um documento." (:896-897).
- `BtnExcluirDocumentoClick` (:452-474): recusa se a grade está vazia ("Nenhum documento foi selecionado ainda.") ou se há
  recurso ("Exclua os recursos antes de excluir um documento."), e pede confirmação ("Deseja realmente excluir este
  documento?").

### 2.2 A grade de documentos e o cálculo por documento

Colunas (`UBaixaApagar.dfm:1866-2030`): Documento (NR_DOCUMENTO), Fornecedor, **Calcula juro** (checkbox, editável),
Valor, Tx. Juros, Valor juros, **Acre / Desc** (editável), Total c/ Juros, Emissão, Vencimento. VENDOR, DESCONTO e
NR_PARCELA ficam ocultas. Só `CALCULAJURO` e `ACRE_DESC` são editáveis; o resto tem `Options.Editing=False`. Totais do
rodapé: "Total a baixar" = `SUM(TOTALJUROS)` (`UdmBaixaApagar.dfm:129-135`) e "Total de Juros" = `SUM(JUROS_EFETIVO)`.

Cálculo (`UdmBaixaApagar.pas:344-373`, `cdsDoctosCalcFields`):
- `VALORJUROS` = `(TXJUROS/100/30) × VALOR × dias de atraso`, com atraso = `DaysBetween(VENCIMENTO, data da baixa)`, só
  se a data da baixa for posterior ao vencimento e `TXJUROS > 0`. É juro simples, mensal convertido para diário.
- `JUROS_EFETIVO` = `VALORJUROS` se "Calcula juro" estiver marcado, senão 0.
- `TOTALJUROS` = `VALOR + JUROS_EFETIVO + ACRE_DESC`.
- Ao abrir, zera `CALCULAJURO=false` e `ACRE_DESC=0` em todos (`cdsDoctosAfterOpen`, :324-342).
- Não existe campo de multa separado. "Acréscimo" = `ACRE_DESC > 0` e "desconto" = `ACRE_DESC < 0`, no mesmo campo.

⚠️ **Binário novo (desde ~08/03/2025): o desconto do título entra pré-preenchido no ACRE_DESC.** Na produção, a base do
documento é `APAGAR.VALOR + VENDOR` e o `ACRE_DESC` já chega com `-APAGAR.DESCONTO`:
- **419** documentos com `DESCONTO>0` têm `ACRE_DESC = -DESCONTO` e `VALORPG = VALOR + VENDOR + ACRE_DESC`;
- só 23 (todos de 03/01 a 18/02/2025) seguem o fonte, com `ACRE_DESC=0` e `VALORPG = VALOR + VENDOR - DESCONTO`;
- 15.180 documentos sem desconto batem com `VALORPG = VALOR + VENDOR + ACRE_DESC`.

**Regra para o Apollo:** base = `VALOR + VENDOR`; `ACRE_DESC` inicial = `-DESCONTO`, editável.

### 2.3 Data da baixa (`edtDataBaixaExit`, :1586-1639)

- Data futura: se `QTDE_DIAS_BX_APG_FUTURA > 0` e a data passa de `now + dias`: "A data informada para baixa excede a
  quantidade de dias permitidos para baixa futura!". Produção: global = 0, **módulo Retaguarda = 200**. Houve 2 lotes com
  data futura em 2025-26.
- Data retroativa: se `PERMITE_BX_APG_DATA_RETROATIVA = 'N'`: "Não é permitido realizar a baixa de contas  informando a
  data retroativa!" (com os dois espaços do fonte). Produção: `'S'` (config marcada obsoleta; específica do usuário 21 =
  'S'). **Não dispara, e retroativa é a regra:** 916 dos 994 lotes têm `DTPGTO` anterior ao dia da operação.
- As duas mensagens só avisam e devolvem o foco. **Não impedem gravar** (`vValidado` só decide o `SetaFoco`, :1636-1637).

### 2.4 Centros de custo de juros, acréscimo e desconto (`SetCentroCustoPadrao`, :1702-1734; busca :227-267)

- Padrão por empresa: `EMPRESAS.CODPLC_JUROS_PAGOS`, `CODPLC_ACRESCIMOS_PAGOS` e `CODPLC_DESCONTOS_RECEBIDOS`. Produção
  (empresas 1/2/51/52): 1820 · 4 · 1077. A empresa 50 só tem o de juros.
- F3: `GET_PLC` com o comprimento da máscara da empresa. Juros e acréscimo aceitam `TIPO_CONTA IN ('DESPESA','NEUTRA')`;
  desconto aceita `('RECEITA','NEUTRA')`.
- Na saída do campo (:1479-1510, `ValidaTipoConta` :1804-1821): juros e acréscimo recusam `TPCONTA=0` com "O centro de
  custo não pode ser uma receita."; desconto recusa `TPCONTA=1` com "O centro de custo não pode ser uma despesa.".

### 2.5 Recursos

**Tipos (`cbbTpRecurso`, `UBaixaApagar.dfm:1008-1031`; o valor gravado no campo não persistido MODALIDADE):**

| idx | Texto | Value | LIBERADO | FORMAS_PGTO localizada (`cbbTpRecursoExit` :1245-1250) | Conta caixa (`CODBCO=0`) permitida? | Uso 2025-26 |
|---|---|---|---|---|---|---|
| 0 | 1 - DINHEIRO | DINHEIRO | S, DTLIBERACAO = data da baixa | `MODALIDADE='DINHEIRO'` | sim | ≈ 993 lotes (indistinguível de 2) |
| 1 | 2 - CHEQUE TERCEIROS | CHEQUE | S | `MODALIDADE='CHEQUE'` | sim | 0 |
| 2 | 3 - DOC | DINHEIRO | S | DINHEIRO | **não** (:1555) | ? (grava igual ao idx 0) |
| 3 | 4 - TRANSFERÊNCIA BANCÁRIA | DINHEIRO | **N** | DINHEIRO | não | ≤ 1 |
| 4 | 5 - DÉBITO EM CONTA | DINHEIRO (força o campo 'DÉBITO EM CONTA', :1230-1231) | **N** | DINHEIRO | não | ≤ 1 |
| 5 | 6 - CHEQUE PROPRIO | CHEQUE | **N** | `MODALIDADE='CHEQUE'` | não | 0 |
| 6 | 7 - DEVOLUÇÃO | DEVOLUCAO | S | `DESTINO='DEV'` | sim | 0 |

- Tipo em branco vira 'DINHEIRO' (:1227-1228). Toda linha recebe `TIPOMOVIMENTO='D'` e `DTEMISSAO = DTVENC = data da
  baixa` (:1254-1256).
- ⚠️ **Devolução está morta no próprio fonte**: procura `DESTINO='DEV'`, mas as formas de devolução da produção têm
  `DESTINO='RCB'`, então `btnPostRecursoClick` recusa com "A forma de pagamento do tipo devolução não foi encontrada."
  (:1105-1110).
- Toda escolha obriga uma conta corrente.

**Conta corrente (`edtCodContaExit`, :1527-1573):**
- O usuário digita o **NROCONTA** (não o código). `BuscaCodConta` (:1167-1200) faz `TRIM(NROCONTA) = …`; com mais de uma
  conta, desempata pela empresa logada. Sem achar: "Nenhuma conta econtrada." (grafia do fonte).
- "É necessário informar a conta corrente!" se vazio ou fora da `GET_CONTAS_BANCARIAS`. A view faz `JOIN BANCOS`, então
  conta caixa precisa de um BANCOS com CODBCO 0.
- **Permissão 1, na tabela `CONTAS_BANCARIAS_OP`:** precisa existir a linha (CODOPERADOR, CODCONTA), senão "Este Operador
  não tem permissão para manipular essa conta corrente." (:1551-1553). A F3 já filtra `COALESCE(ATIVO,'S')='S' AND
  O.CODOPERADOR = <operador>` (:380-390).
- Conta caixa (`CODBCO=0`) com tipo 2..5: "Esta conta corrente é conta caixa, não permite operações bancárias." (:1555-1556).
- **Permissão 2, `TContasBancariasOpBO.OperadorBaixaCP(conexão, conta, operador)`** (:1558-1562, repetida no salvar :1138-1145):
  "O operador não possui permissão para baixar contas a pagar nesta conta corrente.". A classe não está no fonte. A coluna
  lida é `CONTAS_BANCARIAS_OP.CBO_BAIXA_CP` (default 'S'; o cadastro a edita, `uRDmCadContaBancaria.dfm:143-147`).
  Produção: **225 linhas, 35 operadores, 33 contas, CBO_BAIXA_CP = 'S' em 225/225** (a de CR tem 8 'N'). Os 994 lotes
  foram todos feitos por operador com linha e 'S' (10 operadores). **A trava vale, mas hoje não barra ninguém.**
  Semântica a implementar: existe a linha E `COALESCE(CBO_BAIXA_CP,'S')='S'`.

**Salvar recurso (`btnPostRecursoClick`, :1092-1160), nesta ordem:**
1. "Informe o valor do recurso." se o valor for 0.
2. "Informe a conta corrente." se `CODCONTA=0`.
3. Destino: idx 6 → 'DEV' (e a forma precisa existir); idx 1 → 'CHQ'; os demais → 'CXA'. Modalidade do teste de saldo:
   'CHEQUE' se CHQ, senão 'DINHEIRO' (:1116-1122).
4. **`ValidaSaldoAnteriorNew(conta, modalidade, valor, LancaMov=False, VerifSaldo=True, 'SAIDA PARA BAIXA DE DOCUMENTOS',
   lote, data)`** (:1125-1136). Ver §3.1. Se falhar, só devolve o foco.
5. `OperadorBaixaCP` de novo, quando a conta está editável.
6. Post. `BeforePost` inverte o sinal: **VALOR fica negativo** (`UdmBaixaApagar.pas:311-315`). `OnNewRecord` já pôs
   `IDLOTE`, `CODMOVCONTA = GetID('CODMOVCONTA')` e `CODOPCONTA = 0` (:317-322).
7. `InformarRecurso` (:1304-1439): com modalidade DINHEIRO, SALDO (consolidado) = valor. Abre os diálogos de cheque (§2.8).

**Valor do recurso (`edtVlrBaixaEnter/Exit`, :1641-1670):** ao entrar, sugere o restante. Ao sair: "Valor deve ser maior
que zero!" se ≤ 0, e "Valor superior ao restante da baixa!" se passar do restante (e zera o campo). **Não dá para lançar
recurso acima do total.**

**Adicionar recurso (:269-290):** com o restante já 0: "Total de recursos ja informado!". **Excluir recurso** (:441-450):
apaga a linha sem confirmar.

**Histórico:** ao entrar no memo, ele é **sobrescrito** com `'REFERENTE A BAIXA DO LOTE: ' + lote` (`dbmObsEnter`,
:1260-1264). O usuário pode acrescentar texto.

### 2.6 CalculaRestante (:1202-1218)

`Restante = SUM(TOTALJUROS dos documentos) - SUM(VALOR × -1 dos recursos)`. "Total de Recursos consolidados" =
`SUM(SALDO)`, que é só informativo.

### 2.7 Gravar (`btnGravarClick`, :500-874)

**Validações antes de tudo (:543-567):**
1. "Nenhum documento foi informado para realizar a baixa."
2. "Nenhum recurso foi informado."
3. "Salve o recurso antes de gravar a baixa." (recurso em edição)
4. `TIntegracaoContabil.ValidaPeriodoFechado(data da baixa)`: "O período contábil foi fechado até dd/mm/aaaa, entre em
   contato com o contador responsável." (`UIntegracaoContabil.pas:14, 282-294, 337-342`, compara com
   `CONFIG_INTEGRACAO_CONTABIL.CHAVEAMENTO_PERIODO`, que em produção é **nulo**).
5. `ValidaCentroCustos` (:1766-1802): soma os juros (só dos docs com "Calcula juro"), os acréscimos e os descontos, e exige
   o centro de custo de cada um que for ≠ 0: "Informe o centro de custo para juros." / "…para acréscimos." / "…para
   descontos recebidos.".
6. Manutenção: "O lote de manutenção não foi encontrado." e `ReversaoPermitida` (§2.9).

**Total de recursos ≠ total dos documentos (:579-685)**, comparado com 2 casas:
- Pergunta: "Total de recursos não confere com o total dos documentos. Deseja gerar uma baixa parcial?". Se o usuário diz
  não, volta para os recursos.
- Com sim: todos os documentos precisam ser do **mesmo fornecedor**, senão "A baixa parcial de documentos só pode ser
  gerada para documentos a pagar do mesmo fornecedor!".
- Abre a transação e pede a "Data Vencimento" (`TfrmRetornaInfo`).
- Insere **um único** título-saldo para o lote:
  - `CODAPG = GetID('CODAPG')`, `CODOPERADOR` = operador, `CODPARCEIRO`, `QUITADA='N'`, `IDEMPRESA` = empresa do
    documento, `GERADO='SISTEMA'`;
  - `VALOR = total a baixar − total de recursos`, `DTVENC` = a data informada, `DTCOMPRA` = EMISSAO do documento corrente;
  - `TXJUROS = EMPRESAS.TX_JURO_APAGAR` (nulo em produção), `NRPARCELA='1/1'`, `TIPODOC` = do documento,
    `CODGRUPO = GetID('CODGRUPO')`;
  - `CODAPG_PAI` = o documento **corrente do cursor**, `DUPLICATA` = NR_DOCUMENTO ou `'DUP-001/001'`;
  - `OBS = 'Duplicatas:' + lista dos NR_DOCUMENTO` (em ordem inversa, separada por ", "), `IDLOTE` = lote, `ORIGEM='B'`.
- Produção confirma: 331 títulos-saldo em 2025-26, 100% com `CODAPG_PAI` dentro do lote, `NRPARCELA='1/1'`,
  `GERADO='SISTEMA'`, mesmo fornecedor, OBS `Duplicatas:…` em 330. `DTVENC ≤ DTCADASTRO` em todos os amostrados: o
  usuário aceita a data do dia.

**Transação principal, na ordem exata (:687-802):**
1. `StartTransaction` (se a parcial ainda não abriu).
2. Manutenção: `vReversao.ReverteLote(IdLoteManutencao)` (§2.9). ⚠️ **ReverteLote faz COMMIT por conta própria**
   (`UReversaoBaixaContasPagar.pas:312, 322-323`): a reversão fica gravada mesmo se a regravação falhar depois. No Apollo,
   fazer tudo numa transação só.
3. `SetaDataContaCorrente(cdsContaCorrente, data)` (FuncoesApollo, fora do fonte) e `SetOperadorObs` (:1742-1764), que
   põe em cada recurso `HISTORICO = TRIM(hist) + ' - '` (se não vazio) `+ 'Baixa das contas a pagar realizada pelo(a)
   usuário(a) ' + NOMEOPERADOR + '.'`.
4. **INSERT em `MOV_CONTAS_BANCARIAS`** (ApplyUpdates do `cdsContaCorrente`, :702). As colunas gravadas (ProviderFlags
   `pfInUpdate`, `UdmBaixaApagar.dfm:190-280`) são as da tabela abaixo; o resto fica nulo.

   | coluna | valor | produção (994 lotes 2025-26) |
   |---|---|---|
   | CODMOVCONTA | `GetID('CODMOVCONTA')` | — |
   | CODCONTA | conta escolhida | — |
   | VALOR | **−valor do recurso** | 993 negativos; o 1 restante não é da tela |
   | DTEMISSAO | data da baixa | = DTPGTO em 969; 25 diferem (data trocada depois de lançar o recurso) |
   | DTVENC | data da baixa (cheque próprio: vencimento do cheque) | = DTPGTO em 969 |
   | NRODOCUMENTO | não preenchido | **nulo 994/994** |
   | LIBERADO | 'S' (idx 0,1,2,6) / 'N' (idx 3,4,5) | S 993 · N 1 |
   | DTLIBERACAO | data da baixa quando LIBERADO='S'; nula com 'N' | = DTPGTO em 965 |
   | TIPOMOVIMENTO | 'D' | D 994/994 |
   | HISTORICO | `REFERENTE A BAIXA DO LOTE: <lote>[texto livre] - Baixa das contas a pagar realizada pelo(a) usuário(a) <NOME>.` | 944 no padrão exato; 50 com texto do usuário |
   | CODOPCONTA | 0 | 0 em 994/994 |
   | IDLOTE | lote | — |
   | IDPGTO | a FORMAS_PGTO localizada **na empresa do login** | 1/204/215/167 = DINHEIRO; 8 = BOLETO (empresa 50, artefato) |
   | ORIGEM, IDORIGEM, CODOPERADOR, TIPO, RECURSO, CHAVE, DTPGTOBX, CODADIANTAMENTO | não gravados | **nulos 994/994** |
   | CONTABILIZADO | depois, pela integração | 'S' após a integração automática |

   Amostras de HISTORICO gravado (5 padrões): `REFERENTE A BAIXA DO LOTE: 65628 - Baixa das contas a pagar realizada
   pelo(a) usuário(a) GRAZIELE SOUZA SENA.` · `REFERENTE A BAIXA DO LOTE: 67285 - SEGURO PRESTAMISTA - Baixa das contas
   a pagar realizada pelo(a) usuário(a) LARISSA FREITAS.` · `PARCELA GIRO 05/42 - Baixa das contas a pagar realizada
   pelo(a) usuário(a) LARISSA FREITAS.` (memo trocado) · `Baixa das contas a pagar realizada pelo(a) usuário(a) LETICIA
   ADM.` (memo apagado) · `REFERENTE A BAIXA DO LOTE: 89373 PINHEIRAO SERVICOS - Baixa das contas a pagar realizada
   pelo(a) usuário(a) LETICIA ADM.`.

5. Cheques de terceiros repassados (:705-719): `UPDATE CHEQUE SET BAIXADO='S', OBSERVACAO = OBSERVACAO || 'CHEQUE
   REPASSADO NO LOTE DE BAIXA: <lote>', DATABAIXA = <data> WHERE CODCHQ = …` e INSERT em `CHEQUE_REP` (CODCHQREP = GetID,
   CODCHQ, CODPARCEIRO, `DTREPASSE = now`, `LIBERADO='N'`, IDLOTE; :1347-1352, DM :305-309).
6. Cheques próprios (:721-727): INSERT em `CHQ_PROPRIO` e em `RELACAO_CHQ_PROP` (§2.8).
7. **Distribuição do pago entre os documentos (:733-780).** Ordena os documentos por `TOTALJUROS` **crescente** e percorre
   com `baixado = total de recursos`: `baixado -= TOTALJUROS`; se `baixado > 0`, `VALORPG = TOTALJUROS`; senão
   `VALORPG = max(TOTALJUROS + baixado, 0)`.
   - Os menores quitam inteiros e o maior recebe o que sobra. Na parcial com N docs, os que não couberem ficam com
     **VALORPG = 0 e mesmo assim são marcados como quitados** (o saldo passa a representá-los). Produção: 11 linhas com
     VALORPG 0 em 4 lotes de 2025.
   - ⚠️ Com `baixado` exatamente 0 no último documento, cai no `else` e grava `TOTALJUROS + 0`, que dá o mesmo valor.
8. Por documento, **INSERT em `APAGAR_BX`**:

   | coluna | valor |
   |---|---|
   | CODAPGBX | `GetID('CODAPGBX')` |
   | CODAPG | documento |
   | VALORPG | pela regra do passo 7 |
   | DTPGTO | data da baixa (sem hora; 994/994) |
   | OBS | HISTORICO do recurso **corrente** (varchar 300) — igual ao do MCB em 994/994 |
   | ACRE_DESC | do documento (+ acréscimo / − desconto) |
   | JUROS | `JUROS_EFETIVO` |
   | CODOPBX | operador |
   | IDLOTE | lote |
   | CODPLC_ACREDESC | CC de acréscimo se ACRE_DESC>0; CC de desconto se <0 |
   | CODPLC_JUROS, TX_JUROS | se JUROS_EFETIVO>0: CC de juros e a taxa do documento |
   | DATA_OPERACAO, INDR_DATA | data/hora do servidor (`cdsApagarBXNewRecord`, DM :292-298) |
   | INDR_USUARIO, INDR | operador, 'I' |

   ⚠️ **Binário novo:** nas 818 linhas de desconto, `CODPLC_JUROS` vem preenchido com **3707** (4.15.033 JUROS
   BANCÁRIOS) mesmo com JUROS = 0. No fonte isso não acontece. Em 29 linhas (05/03 a 06/04/2026) o CC de desconto foi
   1820 (JUROS E MULTAS ATRASO), escolhido à mão, em vez de 1077.
9. `UPDATE APAGAR SET QUITADA='S' WHERE CODAPG = …` (:774). **Só QUITADA**: nem `DTULTIMALTERACAO` nem `USULTALTERACAO`
   mudam (conferido: 15.432 das 15.984 baixas mantêm o usuário e a data antigos). O `APAGAR` do Oracle não tem coluna
   DTPGTO.
10. Documento com `CODADIANTAMENTO > 0`: `UPDATE ADIANTAMENTO_FORN SET QUITADA='S'` (:476-498). 0 casos em 2025-26.
11. **Linhas na CAIXA gerencial** (`LancaCaixa`, :501-521, :790-792), uma por natureza, só se ≠ 0:
    - juros: `VALOR = -Σjuros`, OBS `'Ref. juros pgto lote <lote>'`, CODPLC = CC de juros;
    - acréscimos: `VALOR = -Σacréscimos`, OBS `'Ref. acréscimos pgto lote <lote>'`, CODPLC = CC de acréscimo;
    - descontos: `VALOR = +Σdescontos`, OBS `'Ref. descontos recebidos lote <lote>'`, CODPLC = CC de desconto.

    Colunas: `CODCX = GetID`, `DATA = DTVENC =` data da baixa, `VRTITULO = VALOR`, `OPERADOR`, `IDEMPRESA` = empresa do
    **login**, `TIPORECURSO='DINHEIRO'`, `CODCONTA=NULL`, `CODPARCEIRO=0`, `NRPARCELA=1`, `CODGRUPO=NULL`,
    `GERADO='SISTEMA'`, `IDLOTE`, `ORIGEM='BAIXA APAGAR'`. Produção confirma TIPORECURSO, ORIGEM, GERADO e CODCONTA nulo.

    ⚠️ **Binário novo:** a linha de descontos leva só o desconto **digitado**. `CAIXA(desc) = Σ|ACRE_DESC<0| − Σ
    APAGAR.DESCONTO` bateu em 337 dos 347 lotes com desconto. Os 119 lotes "sem linha de desconto" são, pela mesma conta, aqueles em que todo
    o desconto veio do título. O acréscimo bate sempre com a soma (152/152).
12. `Commit`.

**Depois do commit (:804-870):**
- `EMPRESAS.INTEGRACAO = 'AUTOMATICA'` (empresas 1, 2, 51, 52): `TIntegracaoContabilBaixaContasPagar.Integrar(lote)`, com
  **erro engolido** (`try … except end`, :1441-1451).
  - Diário da baixa: D fornecedor (`COALESCE(APAGAR.CODPLANOCONTAS_DEB_BAIXA_CP, PARCEIROS.CODCONTABIL_FOR)`) / C conta do
    banco (`CONTAS_BANCARIAS.CODLANCCONTABIL`), valor Σ VALORPG, `SitBaixaApg`.
  - Lançamentos adicionais de juros (`SitJurosPagos`), acréscimo (`SitAcrescimosPagos`) e desconto
    (`SitDescontosRecebidos`), com o CC da baixa.
  - Marca `CONTABILIZADO='S'` em APAGAR_BX e MCB (`UIntegracaoContabil.pas:1587-1900`).
- Cheques próprios gerados: "Deseja Imprimir os Cheques Próprios?" (`ModeloChequeProprio.fr3`).
- Move o arquivo de retorno para `<RETORNO_DIRETORIO>\Baixados` (roda mesmo sem retorno).
- "Documentos baixados com sucesso. Deseja fazer a emissão do recibo?" → `recibopagar.fr3` (Config\ ou Relatorios\), com a
  variável `VARIOS_FORNECEDORES`, a partir de `GET_APAGARBX WHERE LOTE = :LOTE`.

### 2.8 Cheques (**0 uso em toda a história**, só para registro)

- **Cheque de terceiros (idx 1)** → `TfrmLancaChequesBXapg` página 1 (`UlancChequesBXapg.pas:110-147`): multisseleção em
  `GET_CHEQUE` (com `FECHAMENTO_CAIXA='S'`, só `CONSILIADO='S'`). Se a soma não fecha: "Saldo lançado incorreto, deseja
  alterar o valor do Documento para o total Selecionado" (ajusta o recurso) ou "Saldo lançado incorreto" (:187-233).
- **Cheque próprio (idx 5)** → página 0. Pede número ("Informe o número do cheque."), valor ("Informe o valor do cheque."),
  emissão e vencimento ("Data não pode ser vazia!"). Na volta (`InformarRecurso` :1359-1431), para cada cheque:
  - INSERT em `CHQ_PROPRIO` (`CODCHQPROPRIO` = GetID, VALOR, DTEMISSAO, DTVENC, NROCHEQUE, CODCONTA, CODPARCEIRO e RAZAO
    do documento corrente, OPERADOR, `BAIXADO='N'`, IDEMPRESA, IDLOTE, HISTORICO `'DOCUMENTO GERADO ATRAVÉS DA BAIXA DO
    LOTE: <lote>'`);
  - com mais de 1 cheque, **um MCB por cheque** (`LIBERADO='N'`, IDPGTO CHEQUE, DTVENC = vencimento do cheque, VALOR =
    −cheque) e o MCB original é apagado;
  - INSERT em `RELACAO_CHQ_PROP` (CODRELACAOCHQ = GetID, CODMOVCONTA, CODCHQPROPRIO).
- Fechar o diálogo sem cheque apaga o recurso (`UlancChequesBXapg.pas:345-351`).

### 2.9 Manutenção de lote (reabrir e regravar)

- Entrada pela consulta de baixas (`UConsAPGbx.pas:203-290`, já convertida em `uConsAPGbx.md`). Valida
  `ReversaoPermitida(lote)`, carrega os documentos do lote (com `APAGAR_BX.INDR='I'`) e restaura "Calcula juro",
  `JUROS_EFETIVO` e `ACRE_DESC` da baixa. Aloca um **lote novo** (`GetID('IDLOTE')`), põe a data = `DATA_PAGAMENTO` da
  baixa antiga e abre a tela com `TipoBaixa=tbManutencao`. Os recursos **não** são recarregados: o usuário lança de novo.
- No gravar: `ValidaRetornoReversaoPermitida` (:566) e depois `ReverteLote(antigo)` (:691-697). Mensagens:
  - "O período contábil foi fechado até %s…";
  - "Não será possível reverter a baixa pois o caixa foi fechado." (`TContasBancariasBO.CaixaFechado`, fora do fonte);
  - "Não será possível reverter a baixa pois existem documentos que já foram contabilizados." (só com integração ≠
    AUTOMATICA);
  - "Não será possível reverter a baixa pois possuem vinculo com desconto de titulos";
  - "Baixa não foi encontrada." (`UReversaoBaixa.pas:15-18, 115-170`; `UReversaoBaixaContasPagar.pas:231-271`).
- O que `ReverteLote` faz (`UReversaoBaixaContasPagar.pas:96-176, 273-325`), por baixa:
  - estorna o contábil;
  - `APAGAR SET QUITADA='N', CODAPGCARTAO=NULL`;
  - reabre o `ADIANTAMENTO_FORN`.

  Por MCB do lote:
  - apaga `RELACAO_CHQ_PROP`;
  - marca `REVERTIDO='S'`;
  - insere o contra-movimento: `IDLOTE` novo, `IDLOTE_REVERSAO` = o lote, tipo invertido, `VALOR × −1`, `IDORIGEM=0`,
    datas = hoje se a conta for própria, HISTORICO `'Reabertura da baixa de contas a pagar, lote %d, realizada pelo
    usuário %s.'`.

  Depois, no lote inteiro:
  - `APAGAR_BX SET INDR='E', INDR_USUARIO, INDR_DATA=CURRENT_TIMESTAMP`;
  - `CHEQUE SET BAIXADO='N'`;
  - DELETE em `CHEQUE_REP`, `CHQ_PROPRIO`, `APAGAR WHERE IDLOTE AND QUITADA='N'` (o saldo aberto) e `BX_APAGAR_CRT_PROPRIO`;
  - DELETE das CAIXA **pelo texto** `UPPER(OBS) = 'REF. JUROS PGTO LOTE %d'` / acréscimos / descontos.
- Produção 2025-26: dos 76 lotes revertidos, **55 foram manutenção** (os mesmos títulos regravados em outro lote até
  10 min depois) e 21 foram reversão pura. Há 82 contra-movimentos "Reabertura…" desde 2025.

### 2.10 Arquivo retorno (**0 uso**, resumo)

`ProcessarArquivoRetorno` (:949-1090):
- Exige `RETORNO_DIRETORIO` ("Favor informar o diretório de arquivos de retorno no configurador geral/Retaguarda/Boletos").
  Em produção a config é **nula**, então o botão para aí.
- Lê o CNAB 240 de pagamentos: banco = cols 1-3, conta = cols 59-71, e exige o tipo '2' na col 143 ("Arquivo selecionado
  não é arquivo de retorno válido.").
- Coleta os códigos de barras dos segmentos J/G (cols 18-61). No Banco do Brasil converte para linha digitável e grava
  `APAGAR.RETORNO_OP` (cols 231-232).
- Carrega `GET_APAGAR WHERE CODBARRAS IN (…) AND QUITADA<>'S' AND RETORNO_OP IN ('BD','00')` ("Nenhum pagamento
  encontrado.").
- Lança sozinho um recurso idx 4 (DÉBITO EM CONTA) no valor total, na conta do arquivo, e trava os recursos.
- Há também "Prévia Retorno" (`uPreviaRetorno`).
- Produção: `RETORNO_OP` nulo em 100% dos títulos e `APAGAR_BX.NOME_RETORNO` (coluna do binário novo) nulo.

---

## 3. Validações e mensagens

### 3.1 O teste de saldo (`ValidaSaldoAnteriorNew`, `udmPrincipal.pas:2254-2376`)

Roda no **salvar recurso**, não no gravar, e só com o valor **daquele** recurso. Não soma outros recursos do mesmo lote
na mesma conta.

1. Lê a conta (`TContasBancariasVO`). **Chaveamento:** se `DTCHAVEAMENTO > 0` e a data da baixa ≤ `DTCHAVEAMENTO`: "O caixa
   está fechado, não é permitida alteração dos documentos." (:2318-2326). **Vale para qualquer conta**, caixa ou banco.
   Produção: só 263 (1899-01-01) e 42 (2021-01-01) têm chaveamento, então não dispara em 2025-26.
2. **Saldo** (VerifSaldo=True): `GetSaldoContaCorrente(conta, modalidade)` (:3877-3928) =
   `Σ MOV_CONTAS_BANCARIAS.VALOR` da conta com `LIBERADO='S'` e `UPPER(FORMAS_PGTO.MODALIDADE) = 'DINHEIRO'` (ou
   'CHEQUE'), **sem corte de data** (o marcador `/*DATA*/` nunca é substituído) e com `INNER JOIN FORMAS_PGTO`.
   Recusa **só se `CODBCO = 0`** (conta caixa) e `round(|valor|,2) > round(saldo,2)`: "Saldo insuficiente para esta
   operação." (:2328-2338). Conta de banco nunca é testada.
   - Consequência: o saldo é por **modalidade** (DINHEIRO), não o saldo total da conta. Movimento com IDPGTO de outra
     modalidade (ex.: BOLETO 8) não entra.
   - Produção: nos 237 pagamentos da tela em conta caixa desde 2025 (contas 201 e 61), recalculando o saldo acumulado em
     ordem de CODMOVCONTA, **nenhum passou do saldo** — coerente com a trava ativa no binário novo.
3. `LancaMov=False`: a função **não** lança nada nessa chamada.

### 3.2 Tabela de mensagens

| Mensagem (literal) | Condição | Onde | Dispara em produção? |
|---|---|---|---|
| Total de recursos ja informado! | adicionar recurso com restante 0 | :277-282 | UX |
| Nenhum documento foi selecionado ainda. | excluir doc com grade vazia | :457-458 | UX |
| Exclua os recursos antes de excluir um documento. / …antes de adicionar um documento. | há recurso lançado | :460-461, :896-897 | UX |
| Deseja realmente excluir este documento? | confirmação | :463 | UX |
| Informe o valor do recurso. | valor 0 | :1099-1100 | — |
| Valor deve ser maior que zero! / Valor superior ao restante da baixa! | saída do valor | :1654-1669 | — |
| Informe a conta corrente. | CODCONTA 0 | :1102-1103 | — |
| Nenhuma conta econtrada. | NROCONTA inexistente | :1539-1540 | — |
| É necessário informar a conta corrente! | conta vazia ou fora da view | :1548-1549 | — |
| Este Operador não tem permissão para manipular essa conta corrente. | sem linha em CONTAS_BANCARIAS_OP | :1551-1553 | a F3 já filtra |
| Esta conta corrente é conta caixa, não permite operações bancárias. | CODBCO=0 e tipo DOC/TRANSF/DÉBITO/CHQ PRÓPRIO | :1555-1556 | — |
| O operador não possui permissão para baixar contas a pagar nesta conta corrente. | `CBO_BAIXA_CP` ≠ 'S' | :1558-1562, :1140-1144 | não (225/225 'S') |
| A forma de pagamento do tipo devolução não foi encontrada. | idx 6 sem FORMAS_PGTO DESTINO='DEV' | :1109-1110 | sempre que tentado (DEVOLUCAO tem DESTINO 'RCB') |
| O caixa está fechado, não é permitida alteração dos documentos. | data ≤ DTCHAVEAMENTO da conta | udmPrincipal :2320-2325 | não (2025-26) |
| Saldo insuficiente para esta operação. | conta caixa e valor > saldo DINHEIRO liberado | udmPrincipal :2332-2337 | sim, é a trava viva (225 lotes em conta caixa) |
| A data informada para baixa excede a quantidade de dias permitidos para baixa futura! | data > hoje + QTDE_DIAS_BX_APG_FUTURA | :1599-1605 | aviso (200 dias no módulo) |
| Não é permitido realizar a baixa de contas  informando a data retroativa! | retroativa e config='N' | :1611-1617 | não (config 'S') |
| O centro de custo não pode ser uma receita. / …uma despesa. | TPCONTA errado | :1814-1817 | — |
| Nenhum documento foi informado para realizar a baixa. / Nenhum recurso foi informado. / Salve o recurso antes de gravar a baixa. | gravar | :543-550 | UX |
| O período contábil foi fechado até %s, entre em contato com o contador responsável. | DTPGTO ≤ CHAVEAMENTO_PERIODO | :552 | não (nulo) |
| Informe o centro de custo para juros. / …para acréscimos. / …para descontos recebidos. | soma ≠ 0 e CC vazio | :1796-1801 | — |
| O lote de manutenção não foi encontrado. + mensagens da reversão (§2.9) | manutenção | :563-566 | — |
| Total de recursos não confere com o total dos documentos. Deseja gerar uma baixa parcial? | Σ recursos ≠ Σ docs | :589-591 | sim, 331 lotes |
| A baixa parcial de documentos só pode ser gerada para documentos a pagar do mesmo fornecedor! | parcial com mais de um fornecedor | :676 | — |
| Ocorreram erros durante a gravação dos registros, a operação será cancelada. + #13 + Erro original: … | exceção na transação | :668, :799 | — |
| Deseja Imprimir os Cheques Próprios? / Documentos baixados com sucesso. + quebra + Deseja fazer a emissão do recibo? | pós-gravação | :829, :843 | UX |

Não existe no legado: mensagem de título já quitado ou agrupado (a view esconde), trava de valor zero no documento, trava
de bloqueio (só cor) e trava de "título em lote de cobrança".

---

## 4. Esquema (`ALL_TAB_COLUMNS`, owner PINHEIRAO)

**MOV_CONTAS_BANCARIAS** (37 colunas): CODMOVCONTA N(10) NN · CODCONTA N(10) NN · VALOR N(13,2) · DTEMISSAO TS ·
DTVENC TS · NRODOCUMENTO V30 · LIBERADO C1 · TIPOMOVIMENTO C1 · HISTORICO V300 · IDLOTE N(10) · CODOPCONTA N(10) NN ·
TIPO C1 · IDPGTO N(10) · CODADIANTAMENTO N(10) · DTLIBERACAO TS · CODDESTINO N(10) · CONTABILIZADO C1 · CHAVE V14 ·
BKPIDPGTO N · BKPIDPGTO2 N · IDENTIFICADOR V100 · NROPDV_FECHAMENTO N · CODOPERADOR N(10) · IDEMPRESA_FECHAMENTO N ·
DATA_FECHAMENTO TS · DTPGTOBX TS · ORIGEM C3 · IDORIGEM N(10) · IDLOTE_REVERSAO N(10) · REVERTIDO V1 · MOV_CONCILIADO V1 ·
CODCONTAGEM_CEDULAS N · USUCAD_LANCAMENTO_SALDO N · LANCAMENTO_SALDO C1 · CODCONTA_DESTINO N · RECURSO V50 · CLAO_ID N.
(Sem IDEMPRESA. Trigger `AUDIT_MOV_CONTAS_BANCARIAS`, que não recusa nada.)

**APAGAR_BX** (18): CODAPG N(10) NN · CODAPGBX N(10) NN · VALORPG N(13,2) · DTPGTO TS · OBS V300 · ACRE_DESC N(13,2) ·
JUROS N(13,2) · CODOPBX N(10) · IDLOTE N(10) · CONTABILIZADO C1 · DATA_OPERACAO TS · CODPLC_ACREDESC N(10) ·
CODPLC_JUROS N(10) · TX_JUROS N(15,2) · INDR V1 · INDR_USUARIO N(10) · INDR_DATA TS · NOME_RETORNO V50 (binário novo).
(Sem MULTA e sem CODAPG_GERADO, que são colunas do Apollo. Trigger `AUDIT_APAGARBX`.)

**CHQ_PROPRIO** (19): CODCHQPROPRIO N NN · VALOR N(13,2) · DTEMISSAO TS · DTVENC TS · NROCHEQUE N(10) · CODCONTA N ·
CODPARCEIRO N · OPERADOR N · BAIXADO C1 · DTBAIXA TS · OPERADORBX N · IDEMPRESA N · IDLOTE N · HISTORICO V150 · IDNF N ·
CADASTRADO_MANUALMENTE V1 · USULTALTERACAO N · DTULTIMALTERACAO TS · DTCADASTRO TS. **0 linhas.**

**RELACAO_CHQ_PROP** (3): CODRELACAOCHQ N NN · CODMOVCONTA N · CODCHQPROPRIO N. **0 linhas.**

**CHEQUE_REP** (8): CODCHQREP N NN · CODCHQ N NN · CODPARCEIRO N NN · DTREPASSE TS · LIBERADO C1 · DTLIBERACAO TS ·
IDLOTE N · OLD_CODPARCEIRO N. **0 linhas.** (`BX_APAGAR_CRT_PROPRIO`: IDBXAPCRTPROPRIO, IDCRTPROPRIO, CODAPG, IDLOTE —
0 linhas.)

**CONTAS_BANCARIAS_OP** (12, sem PK): CODCONTA N · CODOPERADOR N · CBO_BAIXA_CR V1 default 'S' · **CBO_BAIXA_CP V1
default 'S'** · VISUALIZAR_SALDOS · HABILITAR_TRANFER · HABILTIAR_LIBE_MOVIMENT · HABILTIAR_LANCA_SALDO ·
HABILTIAR_CHAVEAR_FEC_CXA · HABILTIAR_TROCA_VALORES · HABILTIAR_DETALHAR_CONTA · HABILTIAR_CONCI_OFX (todas V1). 225 linhas.

**CAIXA** (colunas que a baixa escreve): CODCX N NN · DATA TS NN · VALOR N(13,2) NN · VRTITULO · OBS V300 · OPERADOR ·
CODPLC N NN · IDLOTE · IDEMPRESA N NN · TIPORECURSO V25 · CODCONTA · CODPARCEIRO · NRPARCELA V10 · CODGRUPO · DTVENC DATE ·
GERADO V10 · ORIGEM V20.

**FORMAS_PGTO** relevante: IDPGTO, MODALIDADE, DESTINO (CXA/CHQ/RCB/TEF/CRT/QUE), IDEMPRESA. DINHEIRO por empresa:
1→1, 2→204, 51→167, 52→215; empresa 50 só tem 8 BOLETO. As DEVOLUCAO (23/203/165/214) têm DESTINO 'RCB', nenhuma 'DEV'.

---

## 5. Plano de cortes para o Apollo

**O que já existe:** `cobranca/apagar-baixa.service.ts` baixa **um título por vez**:
- DINHEIRO pela sessão de caixa, BANCO só no contábil;
- parcial por título, com `codapg_gerado`;
- juros/acréscimo/desconto na CAIXA (`baixa-caixa.ts`, mig 323 `seq_idlote`).

A reversão de lote vem de `cons-apg-bx`. **Nada disso grava `MOV_CONTAS_BANCARIAS`.** Os achados da auditoria
(`auditoria-travas/g3-financeiro.md`, itens 5-8) já pedem trocar a sessão de caixa pela conta caixa. Os cortes abaixo
substituem o modelo "título a título" pelo modelo do legado, "lote com N documentos e 1..N recursos".

### Corte A — o lote (≈ 100% do uso: 994/994 lotes em 2025-26)

- **Tela:** montar o lote com multisseleção sobre os títulos abertos (`QUITADA='N'`, não agrupados, sem ADCREDITO), das
  empresas do usuário (480 lotes misturam empresas). Grade com Calcula juro / Acre-Desc editáveis e as regras de §2.2,
  com base `VALOR + VENDOR` e `ACRE_DESC` inicial `= -DESCONTO` (binário novo). Mais: adicionar/excluir documento, CCs
  padrão da empresa com a checagem de TPCONTA, e data da baixa com os dois avisos de config.
- **Recursos 1..N**, sempre com conta corrente, nos tipos idx 0 (DINHEIRO), 2 (DOC), 3 (TRANSFERÊNCIA) e 4 (DÉBITO):
  - LIBERADO S/N por tipo;
  - conta caixa só aceita DINHEIRO;
  - **permissão por conta** (linha em `CONTAS_BANCARIAS_OP` + `CBO_BAIXA_CP='S'`);
  - **chaveamento** (`DTCHAVEAMENTO`) e **saldo DINHEIRO liberado só em conta caixa** (§3.1), testados por recurso. Sugestão
    fiel com um reforço: testar o acumulado dos recursos do lote na mesma conta.
  - valor ≤ restante.
- **IDPGTO:** a forma DINHEIRO **da empresa do login** (para o BOLETO 8 da empresa 50, gravar a DINHEIRO da empresa; não
  copiar o artefato, ou decidir com o usuário).
- **Gravar**, numa transação:
  - MCB por recurso com as colunas de §2.7.4. VALOR negativo, 'D', CODOPCONTA 0, HISTORICO literal, NRODOCUMENTO e ORIGEM
    nulos. Sugestão: preencher CODOPERADOR, que é coluna nova e inofensiva.
  - APAGAR_BX por documento, com a distribuição crescente por TOTALJUROS.
  - `APAGAR.QUITADA='S'`.
  - CAIXA de juros/acréscimo/desconto, com o desconto sem o `APAGAR.DESCONTO`.
  - Contábil automático (D fornecedor / C `CODLANCCONTABIL` da conta; adicionais por CC) — hoje o Apollo só faz para
    DINHEIRO/BANCO por título.
  - Recibo.
- **Parcial no nível do lote:** um só título-saldo `ORIGEM='B'`, mesmo fornecedor, "Data Vencimento" informada,
  `CODAPG_PAI`, OBS `Duplicatas:…`, `NRPARCELA '1/1'`, `IDLOTE`; documentos excedentes com VALORPG 0 e quitados. **331
  lotes em 2025-26, 254 só em 2026**, 201 deles em conta caixa: entra no corte A, não é opcional.
- **Manutenção (55 lotes):** reabrir o lote = reverter + regravar **numa transação só**. O legado comita a reversão antes,
  e isso não se copia. A reversão pura já existe em `cons-apg-bx`; falta o contra-MCB com `IDLOTE_REVERSAO` e
  `REVERTIDO='S'`, se ainda não houver.
- Integração com `seq_idlote` (mig 323) para o número do lote.

### Corte B — cheque próprio (0 uso; `CHQ_PROPRIO` vazia em toda a história)

Recurso idx 5, conta de banco: diálogo de cheques, um MCB por cheque com `LIBERADO='N'` e DTVENC do cheque, CHQ_PROPRIO,
RELACAO_CHQ_PROP e impressão `ModeloChequeProprio.fr3`. **Recomendação: não converter** sem pedido do usuário. Deixar o
tipo fora do combo e registrar a prova (0 linhas).

### Corte C — cheque de terceiros / repasse (0 uso; `CHEQUE_REP` vazia)

Recurso idx 1: seleção em `GET_CHEQUE`, `CHEQUE.BAIXADO='S'` + OBSERVACAO, CHEQUE_REP com `LIBERADO='N'`. **Não
converter**; mesma prova.

### Corte D — devolução (0 uso; morta no próprio legado)

Recurso idx 6: exige `FORMAS_PGTO.DESTINO='DEV'`, que não existe (as DEVOLUCAO são 'RCB'). No legado, sempre recusa.
**Não converter**; documentar.

### Corte E — arquivo retorno CNAB 240 de pagamentos (0 uso; `RETORNO_DIRETORIO` nulo, `RETORNO_OP` nunca preenchido)

Importar o retorno, casar pelo código de barras (`CODBARRASBLT`), recurso automático DÉBITO EM CONTA e a prévia.
**Não converter** agora. Se vier, entra junto com a remessa CNAB de pagamentos.

### Fora da tela, mas vizinho

- O escritor FRMMOVCAIXA (467 lotes de título quitado em 2026) já foi convertido em `lancamento-caixa.service.ts`.
- A baixa automática com cheque/cartão próprio do cadastro (`uAPagar.pas:1372-1500`) usa o mesmo DM e também tem 0 uso
  (tabelas vazias).

---

## 6. Surpresas: fonte × dado

1. **Binário novo pré-preenche o desconto do título no ACRE_DESC** (419 docs desde mar/2025) e tira esse valor da linha
   de CAIXA de descontos (337/347 lotes). O fonte parte do VALOR líquido da view e de ACRE_DESC 0.
2. **Binário novo grava `CODPLC_JUROS = 3707` nas linhas de desconto**, com juros 0 (818 linhas). O fonte só grava com
   juros.
3. **Juros nunca foram usados** (0 linhas com JUROS > 0 em toda a história, 0 CAIXA "Ref. juros"), embora 71 títulos
   abertos tenham TXJUROS > 0. O cálculo de juros pode entrar no corte A por paridade, mas não tem dado de prova.
4. **O BOLETO nos recursos é artefato** do `Locate` que falha na empresa 50, não uma escolha.
5. **MCB.CODOPERADOR e NRODOCUMENTO nunca preenchidos; MCB não tem IDEMPRESA.**
6. **Permissão `CBO_BAIXA_CP` existe e é checada, mas está 'S' em 100%** das 225 linhas. A trava que filtra de fato é a
   existência da linha operador×conta (e a F3 já esconde as contas sem linha).
7. **O teste de saldo é por modalidade DINHEIRO e só em conta caixa.** Banco nunca é testado, e o chaveamento vale para
   qualquer conta. Nos 237 pagamentos em conta caixa, nenhum passou do saldo.
8. **Cheques (próprio e de terceiros), devolução, adiantamento e arquivo retorno: 0 uso em toda a história.** A
   devolução já é impossível no próprio legado (DESTINO 'DEV' inexistente).
9. **ReverteLote comita sozinho** no meio da manutenção: reversão e regravação não são atômicas no legado.
10. **Parcial em conta caixa virou rotina em 2026** (201 lotes, cadeia de saldos da PINHEIRAO SERVIÇOS). Até 2025 era
    rara (0 em caixa).
11. **Data retroativa é a regra** (916/994 lotes com DTPGTO antes do dia da operação). A config que a proibiria está 'S' e
    marcada obsoleta.
12. `IntegraBaixaApagar` engole qualquer erro da integração contábil. Mesmo assim, 88 baixas de 2026 e 11 de 2025 ficaram
    sem `CONTABILIZADO='S'`.

---

## 7. Conversão — corte A, backend (24/09/2026)

`cobranca/baixa-apagar-lote.service.ts` + controller `cobranca/baixa-apagar` (RBAC do legado: `FRMBAIXAAPAGAR`,
`BTNADICIONARREGISTRO` no iniciar, `BTNGRAVAR` no gravar). Smoke §196 (11 casos).

- `POST iniciar` aloca o lote (`seq_idlote`), como o `GetID('IDLOTE')` do "Iniciar baixa"; o gravar recusa lote já usado.
- `GET titulos` (GET_APAGAR: abertos, sem ADCREDITO, não agrupados, das empresas de `RELACAO_OPERADOR_EMPRESA`), base
  `VALOR + VENDOR`, acréscimo/desconto inicial `−DESCONTO`. `GET contas` (as de `CONTAS_BANCARIAS_OP` do operador, ativas).
  `GET padroes` (CCs da empresa, configs de data, os 4 tipos de recurso).
- `POST gravar`, numa transação: MCB por recurso (literal da §2.7.4), APAGAR_BX por documento com a distribuição crescente,
  `QUITADA`, adiantamento, título-saldo da parcial (um por lote), CAIXA (desconto só o digitado). Depois do commit, com
  AUTOMATICA, `BaixaTronContabilService.integrar` do lote (erro engolido).
- Travas: tipo × conta caixa, vínculo operador×conta, `CBO_BAIXA_CP`, `DTCHAVEAMENTO` (qualquer conta), saldo DINHEIRO
  liberado só na caixa (reforço: desconta os recursos anteriores do lote na mesma conta), valor ≤ restante, parcial só com
  confirmação e mesmo fornecedor, CCs com o TPCONTA, período (`bloq_baixa_apg` + `CHAVEAMENTO_PERIODO`).
- Reversão (`reverterLoteNaTrx`), usada pela consulta de baixas para todo lote com MCB e pela manutenção: contábil do lote,
  títulos reabertos (`CODAPGCARTAO` nulo), adiantamento, contra-MCB + `REVERTIDO='S'`, `INDR='E'`, `DELETE APAGAR … IDLOTE
  AND QUITADA='N'` (o saldo em aberto; o baixado fica, como o legado — sem a trava REVERSAO_PARCIAL_SALDO_BAIXADO), CAIXA
  pelo texto. Trava: caixa fechado pelo chaveamento das contas do lote; contabilizado sem AUTOMATICA; desconto de títulos.
- Manutenção: `loteManutencao` reverte e regrava na mesma transação.

**Divergências conscientes:** o título-saldo leva a emissão do título quando não há NF (o legado grava a data zero do
Delphi, 1899-12-30); `CODPLC_JUROS=3707` nas linhas de desconto (binário novo, origem não identificada) não é copiado;
cheque próprio/terceiros, devolução e retorno ficam fora (0 uso, §5). A baixa título a título antiga
(`cadastro/apagar/:id/baixar`, sessão de caixa) segue no ar só até a tela nova assumir.

## 8. Conversão — corte A, tela (24/09/2026)

`/cobranca/baixa-apagar` (`BaixaApagarPage`, menu "Baixa de contas a pagar"): Iniciar baixa (o lote), pesquisa com
multisseleção (bloqueado em vermelho, fornecedor com débito em azul — só cor), grade com "Calcula juro" e Acre/Desc
editáveis enquanto não há recurso, totais, CCs com o padrão da empresa, recursos (tipo, conta do operador — a caixa só no
DINHEIRO —, valor sugerido = restante, histórico `REFERENTE A BAIXA DO LOTE: N`), avisos de data (não bloqueiam), parcial
com a pergunta do legado e o vencimento do saldo. Manutenção: botão na consulta de baixas → `?manutencao=<lote>` (valida o
`ReversaoPermitida` sem reverter, traz documentos e data, aloca lote novo). O painel "baixar título" do cadastro de Contas a
Pagar (invenção do Apollo) virou atalho para a tela. ✅ O recibo (`recibopagar.fr3`): `GET cobranca/baixa-apagar/recibo/:lote` + `imprimirRecibo.ts`.

## Recibo no layout do cliente (05/10/2026)

O recibo da baixa ("Documentos baixados com sucesso. Deseja fazer a emissão do recibo?") e o "Recibo" da consulta de baixas saem no
layout do cliente: `GET cobranca/baixa-apagar/recibo/:lote/impressao` (`Config\recibopagar.fr3`, RBAC FRMBAIXAAPAGAR ou FRMCONSAPGBX) e
`GET cobranca/baixa-receber/recibo/:lote/impressao` (`Config\recibo.fr3`, FRMBAIXAARECEBER ou FRMCONSRCBBX — a consulta do a receber
pergunta "Deseja fazer a emissão do recibo?" antes, como o legado). `dbdRecibo` = o `cdsDoctoBX` (`SELECT * FROM GET_APAGARBX WHERE LOTE`,
na ordem do FORNECEDOR; `GET_ARECEBERBX … ORDER BY DATA_VENCEU`), `dbdEmpresa` = a empresa do login, `VARIOS_FORNECEDORES` = mais de um
fornecedor no lote. O lote revertido lê a `GET_APAGARBX_REVERTIDAS` / `GET_ARECEBERBX_REVERTIDAS` (mig 407 — o `SetRevertido` da consulta;
4.669 / 613 linhas revertidas na produção; o A Pagar soma o TXJUROS ao VALOR e ao ACRES_DESC). O layout é o de `Config\` — na RELATORIOS o
mesmo nome existe no lote de `Relatorios\` com outro desenho; o de Config é o de código menor (`modeloFr3(…, { pasta: 'Config' })`). O
recibopagar de Config pergunta o "Layout de impressão" (Recibo — um por fornecedor — × Lista de recibos): o diálogo do FastReport sai na
janela de impressão e o OnClick do layout escolhe a página. O HTML próprio (`imprimirRecibo.ts`) saiu. Smoke §295.
