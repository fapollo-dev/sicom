# Spec de conversão — BAIXA DE CONTAS A RECEBER (`TfrmBaixaAreceber` / FRMBAIXAARECEBER)

> Recon READ-ONLY de 24/09/2026. Fonte: snapshot de **mai/2020** (`/Library/SicomGit/retaguarda-master/fonte/`), lido com
> `iconv -f latin1`. Produção: Oracle PINHEIRAO, só `SELECT` em transação READ ONLY, janela **2025-01-01 → 2026-09-24**.
> **Quando o fonte e o dado vivo discordam, o dado vivo decide** — cada caso está marcado com ⚠️ **VIVO≠FONTE**.
> Complementa `uCadAReceber.md` (cadastro + cortes já entregues da baixa por título), `uConsRCBbx.md` (consulta/reversão),
> `uConfBoleto-CNAB.md` (retorno), `CAIXA-escritores.md` §4 (linhas de CAIXA), `uAgrupaContas.md`, `uCadUsuarios.md` (senha DESC).

## 0. Fontes lidas

| Arquivo | Linhas | Papel |
|---|---|---|
| `Units/UBaixaAreceber.pas` / `.dfm` | 3.064 / 3.038 | a tela |
| `Units/UdmbaixaAreceber.pas` / `.dfm` | 698 / 2.436 | datamodule (SQLs, ProviderFlags, NewRecord) — não existe variante em `DmOld/`/`Objetos/` |
| `Units/ULancRecursosRCBbx.pas` / `.dfm` | 499 | sub-diálogo de cheques e permutas |
| `Units/UReversaoBaixaContasReceber.pas` + `Units/UReversaoBaixa.pas` | 355 + 172 | reversão/manutenção de lote |
| `Units/UconsRCBbx.pas` :250-380 | — | entrada da **manutenção de lote** |
| `Units/UIntegracaoContabil.pas` :14, :282-295, :1960-2013, :3346-3845 | — | `TIntegracaoContabilBaixaContasReceber` |
| `Units/udmPrincipal.pas` :894-897, :2131-2376, :3600-3614, :3877-3928 | — | `ValidaSaldoAnterior(New)`, `SenhaAdministrativa`, `GetSaldoContaCorrente` |
| **Não vieram no fonte:** `FuncoesApollo` (`SetaDataContaCorrente`, `GetID`, `TruncarArredondar`), `BO.ContasBancariasOp` (`OperadorBaixaCR`), `UFrmResumoBaixa` (só o form), `BO.FormasPgto`. O comportamento delas é inferido do nome + dado vivo (dito onde). |

---

## 1. Fluxo completo

### 1.1 Montar o lote (documentos)

**Entrada normal** — `btnAdicionarRegistroClick` (`UBaixaAreceber.pas:839-1006`):

- Zera estado: `TipoBaixa := tbNormal`, `Carregou/Juros := False`, data da baixa = `Now` (`:848-856`).
- Se `BAIXA_RCB_POR_CLIENTE = 'S'` → abre `TfrmConsCliRcb` (consulta por cliente), traz `edtJuro`, `DataJurosAte`
  e o **saldo de crédito** do cliente (`:858-886`). Senão, pesquisa `GET_RCB` multi-seleção (`:887-904`) com o filtro:
  `IDEMPRESA IN (<multiempresa>) AND COALESCE(AGRUPADO,'N')='N' [AND CONSILIADO='S' se EMPRESAS.FECHAMENTO_CAIXA='S'] AND QUITADA='N'`
  (`:891-896`). `DataJurosAte := Now` (`:902`). Coloração: vencidas (`DATA_VENCIMENTO < hoje`) em vermelho (`:2563-2570`, `:2449-2452`).
- Os códigos escolhidos são reabertos em `cdsDoctos` via `SELECT G.*, P.DIASPRAZO, COALESCE(P.DESCPADRAO,0) DESCPADRAO FROM GET_RCB G
  LEFT JOIN PARCEIROS P ON P.CODPARCEIRO = G.CODIGO_CLIENTE` + `WHERE G.QUITADA='N' AND G.CODIGO IN (...)` em blocos de **999**
  unidos por `UNION ALL` (`:906-944`; SQL em `UdmbaixaAreceber.dfm:1108-1113`).
- `cdsDoctosAfterOpen` zera `CALCULAJURO/ANTECIPA/ACREDESC/TXANTECIP` (`UdmbaixaAreceber.pas:585-604`).
- **Desconto do cliente** por prazo: se `DIASPRAZO>0 e DESCPADRAO>0 e DATA_VENDA+DIASPRAZO >= data da baixa` →
  `DESCONTO_CLIENTE := VALOR*DESCPADRAO/100` (`:949-956`; idem ao adicionar documento `:1956-1964`).
- Recalcula cada doc (`dbGridDadosColExit`, ver 1.2); pega o lote: `IdLoteBaixa := GetID('IDLOTE')` (`:976`, seq. `ID_IDLOTE`);
  abre `cdsContaCorrente` vazio do lote (`:978-980`); aplica juros (`edtJuroExit`, `:981`); doc com `TOTALCOMJUROS=0` recebe
  `VALOR` (`:985-997`).

**Adicionar documento** ao lote aberto — `BtnNovoDocumentoClick` (`:1885-1988`): só sem recursos
("`Exclua os recursos antes de adicionar um documento.`" `:1909`); exclui os já presentes (`CODIGO NOT IN`, `:1924-1927`).
⚠️ Bug do fonte: com `BAIXA_RCB_POR_CLIENTE='S'` o filtro usa `CODIGO_CLIENTE = <CODIGO do 1º doc>` (código do título, não do
cliente) (`:1928-1930`). **Excluir documento** (`:1198-1222`): só sem recursos, com confirmação.

**Grade de documentos** (`UBaixaAreceber.dfm`, `dbGridDados`): Documento (`DUPLICATA`), Fornecedor[sic] (`CLIENTE`),
Calcula Juro (check), Valor, Total Acre/Desc (`ACREDESC`), Total a baixar (`TOTALCOMJUROS`), Tx. Juros (**editável**), Vr. Juros,
R$ Acrés/Desc (`ACREDESC_VALOR`, **editável**), % Acrés/Desc (`PERCENTUAL`, **editável**), `DESCONTO_CLIENTE`, Tx.Antecip.
(**editável**), Antecipação (check), Emissão, Vencimento, Nro. Pedido. Rodapé: total a baixar (`TOTALGERAL = SUM(TOTALCOMJUROS)`),
total recursos, restante, troco.

- Marcar `CALCULAJURO` por clique exige **senha administrativa 'ADM'** (`:2324-2338`), mas o clique direito no título da
  coluna (ou tecla `T`) marca/desmarca **todos** sem senha (`:2474-2478`, `:2488-2536`).
- Atalhos: F8 → juros, F9 → recursos (`:2575-2585`); Enter na grade → botão recursos (`:2468-2472`).

**Entrada por arquivo retorno** — `btnImportaArqRetornoBoletoClick` → `ProcessarArquivoRetorno` (`:1871-1883`, `:2596-2775`):
banco por literais do header (Itaú/BB/Bradesco/SICOOB, senão "`Este procedimento está liberado para os bancos: Itaú, Bradesco,
Banco do Brasil e SICOOB.`" `:2638-2668`); só boletos com `ValorRecebido > 0` (`:2679`); **nosso número → CODRCB**
(`StrToInt(copy(NossoNumero, len-8, len))`, `:2683`); títulos `COALESCE(QUITADA,'N')<>'S'` (`:2704`); **data da baixa = data do
arquivo** (`:2713`); **`ACREDESC := ValorRecebido − ValorDocumento`** (`:2724-2730`). O legado **não grava**: preenche a grade;
o operador lança o recurso e grava pelo fluxo normal. Histórico padrão do recurso: `'REF BX LOTE: <lote> - ARQ RET: <arquivo>'`
(`:400-401`). ⚠️ O retorno **não preenche `cdsDoctosRec`** → a baixa parcial (que conta clientes em `cdsDoctosRec`, §1.6) cai
sempre em "só pode ser gerada para duplicatas do mesmo cliente".

### 1.2 Cálculo por documento (`dbGridDadosColExit`, `UBaixaAreceber.pas:2340-2436`)

```
ACREDESC = PERCENTUAL*VALOR/100                        (:2368)
         + ACREDESC_VALOR                              (:2370)
         − DESCONTO_CLIENTE                            (:2373)
         + rateio(edtDesc_Acre)  = Arredonda(edtDesc_Acre*VALOR/TOTAL_VALOR, 2)   (:2376)
           (resíduo do rateio vai no ÚLTIMO registro)  (:2379-2383)
se FORCAR_JUROS_BAIXA_ARECEBER='SIM' → CALCULAJURO := True   (:2364-2365)
se CALCULAJURO:
   TOTALCOMJUROS = VALOR + ACREDESC
   se DATA_VENCIMENTO < DataJurosAte → DIAS_ATRAZO := Trunc(DataJurosAte − DATA_VENCIMENTO)   (:2393-2396)
   se DIAS_ATRAZO > 0 e DIAS_ATRAZO > DIAS_TOLERANCIA:                                        (:2398)
      base = TOTALCOMJUROS se CALCULAR_DESCONTO_SOBRE_JUROS_BXCR='S', senão VALOR           (:2401-2404)
      JURO = TruncarArredondar(((TXJUROS/30) * base / 100) * DIAS_ATRAZO, 'A', 2)
      TOTALCOMJUROS += JURO
   senão JURO := 0; TOTALCOMJUROS = VALOR + ACREDESC
senão TOTALCOMJUROS = VALOR + ACREDESC
se ANTECIPA e TXANTECIP>0: VR_ANTECIPACAO = TruncArred(TOTALCOMJUROS*TXANTECIP/100,'A',2); TOTALCOMJUROS −= VR_ANTECIPACAO  (:2417-2421)
```

- `edtJuro` (taxa % a.m. informada) — `edtJuroExit` (`:717-795`): na 1ª passada (`Carregou=False`) marca `CALCULAJURO` nos docs
  com `DATA_VENCIMENTO < DataJurosAte`; grava `TXJUROS := edtJuro` nos marcados. Confirmações: "`Deseja calcular juros para os
  documentos selecionados?`" (`:742`) / "`Deseja zerar o juro dos documentos?`" (`:756`).
- `DIAS_ATRAZO`/`DIAS_TOLERANCIA`/`JURO` iniciais vêm da view `GET_RCB` (calculados contra `CURRENT_DATE`; a view **já soma MULTA**
  em `TOTAL`, `TXMULTA`, `MULTA`, `TIPO_MULTA` — ⚠️ **VIVO≠FONTE**: essas colunas não existem no `sqqDoctos` de 2020).
- **Produção:** `CALCULAR_DESCONTO_SOBRE_JUROS_BXCR='N'`, `FORCAR_JUROS_BAIXA_ARECEBER='N'` (global e específica Retaguarda).
  **Juros nunca foram cobrados**: 0 de 7.190 baixas com `JUROS>0`/`TX_JUROS>0`, 0 títulos baixados com `TXJUROS>0`;
  `MULTA`/`TXMULTA` = 0 em todas. (`EMPRESAS.TXJUROPADRAO` nulo em todas.)

### 1.3 Recursos — os 10 itens do combo (`UBaixaAreceber.dfm:982-1017`)

`cbbTpRecurso` é `TJvDBComboBox` ligado a `cdsContaCorrente.MODALIDADE` (campo **não persistido**, vem do JOIN com FORMAS_PGTO).

| ItemIndex | Texto | Value | Forma localizada (`LocalizaFormaPgto(MODALIDADE, DESTINO)`, `:2312-2322`) | LIBERADO (`:326-355`) | Conta aceita (`:524-528`) | Sub-diálogo (`InformarRecurso` `:2121-2259`) |
|---|---|---|---|---|---|---|
| 0 | 1 - DINHEIRO | DINHEIRO | DINHEIRO / CXA | 'S' + DTLIBERACAO=data | caixa **ou** banco | — (SALDO:=VALOR) |
| 1 | 2 - CHEQUE | CHEQUE | CHEQUE / CHQ | *não setado* | **só caixa** (CODBCO=0) | cheques (`ULancRecursosRCBbx` pág. 0) + troco habilitado |
| 2 | 3 - DOC | DINHEIRO | DINHEIRO / CXA | 'S' | **só banco** | — |
| 3 | 4 - TRANSFERÊNCIA BANCÁRIA | DINHEIRO | DINHEIRO / CXA | **'N'** | só banco | — |
| 4 | 5 - DÉBITO EM CONTA | DINHEIRO | DINHEIRO / CXA | **'N'** | só banco | — |
| 5 | 6 - PERMUTA | DINHEIRO | DINHEIRO / CXA | **'N'** | só banco | permutas (pág. 1 → `PERMUTAS`) |
| 6 | 7 - ANTECIPAÇÃO BANCÁRIA | DINHEIRO | DINHEIRO / CXA | 'S' | só banco | — |
| 7 | 8 - CARTAO | CARTAO | CARTAO/CRT, senão CARTAO/TEF | **'N'** | caixa ou banco | `TfrmManipulaFin` pág. 2 → N linhas em `CARTAO` |
| 8 | 9 - CHEQUE PRE | CHEQUE PRE | CHEQUE PRE / CHP | *não setado* | só caixa | cheques + troco |
| 9 | 10 - SALDO | SALDO | DINHEIRO / CXA | 'S' | **conta desabilitada** (`SetEnabledCompSaldo`, `:372`) | — ; exige `BAIXA_RCB_POR_CLIENTE='S'` |

(O `in [0,2,3,4,5,6,9,10]` de `:326` cita um índice 10 que não existe.) `LocalizaFormaPgto` tenta `MODALIDADE+IDEMPRESA`, depois
`DESTINO+IDEMPRESA`, depois só `MODALIDADE` (`:2315-2320`). O recurso grava `IDPGTO` da forma localizada,
`TIPOMOVIMENTO='C'`, `DTEMISSAO=DTVENC=data da baixa` (`:357-365`); `ContaInterna` (`CONTAS_BANCARIAS.CONTA_PROPRIA='S'`) força
`LIBERADO='S'`, `DTLIBERACAO=Now` (`:376-395`, `:2056-2060`).

⚠️ **VIVO≠FONTE — o combo de produção é outro:** `MOV_CONTAS_BANCARIAS.RECURSO` (coluna que não existe no fonte) guarda o texto do
item: `1 - DINHEIRO`, `5 - DÉBITO EM CONTA`, `8 - CARTAO` e **`12 - PIX SICOOB`** (há ≥12 itens). O recurso CARTAO grava formas
**específicas** (`PIX POS` 101, `IFOOD 2` 205) que o `Locate('DESTINO','CRT')` do fonte não escolheria de forma determinística;
o PIX SICOOB gravou a forma `BOLETO` (IDPGTO 8, DESTINO RCB, empresa 50) na conta 182 com `LIBERADO` **nulo**. Hipótese (sem
fonte): o binário novo deixa escolher a forma. ⚠️ Desde **abr/2024** o recurso CARTAO **não gera mais linhas em `CARTAO`**
(2023: 84/85 lotes com CARTAO; 2024: 22/70; 2025: 0/101) — o fonte gera (`:2228-2252`, apply em `:1557-1558`).

**Conta corrente do recurso** — `edtCodContaExit` (`:494-570`) e `btnBuscaCCClick` (`:1008-1036`):
- busca por `NROCONTA` (TRIM; se >1, filtra a empresa logada) (`:2086-2119`); pesquisa F3 só contas `ATIVO<>'N'` com linha do
  operador em `CONTAS_BANCARIAS_OP` (`:1016-1026`).
- operador precisa de linha em `CONTAS_BANCARIAS_OP (CODOPERADOR, CODCONTA)` (`:521-522`) **e** `OperadorBaixaCR` (`:530-534`,
  repetido no salvar `:2030-2037`) — `BO.ContasBancariasOp` não veio; pela tela de contas é a flag `CONTAS_BANCARIAS_OP.CBO_BAIXA_CR`
  (`UCadContasBancarias.md` BR-12/13). Produção: todas as linhas das 10 contas usadas têm `CBO_BAIXA_CR='S'`.
- `ValidaSaldoAnterior(FORMA.CODCONTACORRENTE, FORMA.MODALIDADE, VALOR, LancaMov=True, VerifSaldo=False, 'SAIDA PARA BAIXA DE
  DOCUMENTOS', lote, data)` (`:544-558`) — a forma é a do **título** (`cdsDoctosIDPGTO`) ou a de `DESTINO='RCB'`. Efeito real
  (`udmPrincipal.pas:2131-2252`): (a) **chaveamento** — se `CONTAS_BANCARIAS.DTCHAVEAMENTO` da conta **da forma do título** (não da
  conta escolhida!) ≥ data da baixa: "`Caixa FECHADO não é permitida alteração dos documentos!`" (`:2189-2204`); (b) sem formas:
  "`Não a formas de pagamento configuradas para empresa!`" (`:2211-2216`); (c) `VerifSaldo=False` → **não checa saldo**; (d) o
  `LancaMovimento` anexa em `dmPrincipal.cdsContaCorrente`, que **nunca recebe ApplyUpdates** nesta tela → **nenhum efeito**.
  `GetSaldoContaCorrente` (`:3877-3928`, soma `VALOR` liberado por modalidade) só roda com VerifSaldo — irrelevante aqui.
  `ValidaSaldoAnteriorNew` (`:2254-2376`) **não é chamada** por esta tela.

**Valor do recurso** — `edtVlrBaixaEnter` sugere o restante (`:797-802`); `edtVlrBaixaExit` (`:804-837`): "`Valor deve ser maior
que zero!`"; se valor > restante e `MOSTRAR_TROCO_BAIXA_CR<>'S'`: cheque → `TROCO := excesso`; demais → **o excesso vira acréscimo
global** (`edtDesc_Acre := excesso; edtDesc_AcreExit` → pede senha DESC). Idem no salvar (`:2048-2054`).

`CalculaRestante` (`:286-305`): `restante = max(0, TOTALGERAL − SUM(VALOR recursos))`.

**Salvar recurso** — `btnpostrecursoClick` (`:1990-2078`) → `InformarRecurso` (`:2121-2259`): cheques exigem soma exata
("`Valor dos cheques incompleto!`" `ULancRecursosRCBbx.pas:232-236`), cheque salvo com `CONSILIADO='S'` (`:270`); cartão pede
operadora/parcelas e gera `CARTAO` por parcela: `DTVENDA`=data, `VALOR`=RoundTo(total/parcelas,−2), `CODOPERADORA`, `CODOPERADOR`,
`IDEMPRESA`, `IDPGTO`(CRT/TEF), `IDLOTE`, `NROPARCELA`, `LIBERADO='N'`, `CONSILIADO='N'` (`:2228-2252`). Excluir recurso cartão
apaga **todos** os recursos cartão (`:1167-1177`). ⚠️ Bug do fonte: o seletor de modalidade do cheque filtra
`DESTINO='CHEQUE' OR 'CHEQUE PRE'` (`ULancRecursosRCBbx.pas:206`), mas `DESTINO` é CHAR(3) ('CHQ') → pesquisa vazia.

**Recurso SALDO** (crédito do cliente, `APAGAR.ADCREDITO='S'`): só com `BAIXA_RCB_POR_CLIENTE='S'`; valor ≤ saldo; um por lote
(`:2011-2028`). No gravar sai do MCB (`:1562-1570`), quita os créditos `APAGAR` do cliente e relança a sobra via
`TfrmConsRCBbx.LancaSaldo` (`:1282-1297`), e os docs cobertos vão para `ARECEBER_BX_SALDO` (`:1603-1707`).

### 1.4 Desconto/acréscimo — duas travas distintas

1. **Senha DESC (empresa)** — `edtDesc_AcreExit` (`:675-699`): se o campo **global** `edtDesc_Acre ≠ 0` → `SenhaAdministrativa('DESC')`
   (`udmPrincipal.pas:3600-3614`); negada → zera, cancela o recurso em edição. Depois: desconto > soma dos valores →
   "`O valor do desconto não pode ser maior que a soma das contas.`" (`:690-695`). **Os campos por documento (`ACREDESC_VALOR`,
   `PERCENTUAL`) não pedem senha.** O excesso de recurso (troco='N') passa por aqui → pede senha DESC.
2. **Liberação por usuário (desconto máximo)** — `DescontoValidado` (`:420-492`), chamado ao adicionar recurso (`:278`) e ao gravar
   (`:1355`): soma `ACREDESC` do lote; se < 0: `PORCENTUAL_MAXIMO_DESCONTO`=0 e há usuários em
   `USUARIOS_LIBERAM_DESCONTO_MAXIMO_EXCEDIDO` → **sempre pede login**; se % > 0 e |desc| > total×% → pede login (ou
   "`Nenhum usuário foi definido para liberar o desconto.`"). Mensagens: "`Informe o login e senha de um usuário com permissão para
   liberar o desconto.`" / "`O usuário informado não tem permissão para liberar o desconto.`" (`:470-471`). Guarda
   `CODOPERADOR_LIBERACAO_DESCONTO`. Produção: % global **0**; liberadores 1 (programador), 3 (JFG), 102 (FLAVIA); FLAVIA tem % 100.
   ⚠️ **Bug provado no dado:** `OperadorLiberacaoDesconto` nunca é zerado (nem no cancelar `:1080-1107` nem após gravar
   `:1862-1868`) → vaza para os lotes seguintes da sessão: lotes 66506, 68505, 68506 têm liberação carimbada **sem desconto**. Não copiar.

### 1.5 Centros de custo (`ValidaCentroCustos`, `:2852-2889`; padrão `SetCentroCustoPadrao` `:2777-2809`)

Soma do **lote inteiro** (dataset da grade = `cdsDoctos`): juros (com `CALCULAJURO`), acréscimos (`ACREDESC>0`), descontos
(`ACREDESC<0`). Natureza com valor e CC vazio → "`Informe o centro de custo para juros.`" / "`…para acréscimos.`" /
"`…para descontos concedidos.`". Padrões `EMPRESAS.CODPLC_JUROS_RECEBIDOS/ACRESCIMOS_RECEBIDOS/DESCONTOS_CONCEDIDOS`
(produção: 1078/1078/2104 nas empresas 1,2,51,52; empresa 50 nula). Pesquisa: juros e acréscimo `TIPO_CONTA='RECEITA'`, desconto
`'DESPESA'`, só contas analíticas (comprimento = máscara) (`:1038-1078`). Diferente do A Pagar, **aqui a soma está certa**
(produção: linha de CAIXA = Σ do lote em **117/117** lotes com acréscimo e **35/35** com desconto).

### 1.6 Gravar — ordem exata (`btnGravarClick`, `:1248-1869`)

**Pré-validações (fora de transação):**
1. "`Nenhum documento foi selecionado para realizar a baixa.`" (`:1307-1311`); "`Salve ou cancele o recurso antes de gravar a baixa.`" (`:1313-1317`).
2. **Período contábil fechado**: `TIntegracaoContabil.PeriodoFechado(data da baixa)` (`:1319-1320`) → "`O período contábil foi fechado
   até %s, entre em contato com o contador responsável.`" (`UIntegracaoContabil.pas:14`, `:282-295`: `data ≤ CHAVEAMENTO_PERIODO`).
   Produção: `CONFIG_INTEGRACAO_CONTABIL.CHAVEAMENTO_PERIODO` **nulo** → nunca bloqueia hoje.
3. "`Não foi informado nenhum recurso, não é possivel continuar!`" (`:1337-1341`); doc com total ≤ 0 → "`O valor da conta deve ser maior que zero.`" (`:1343-1353`).
4. `DescontoValidado` (`:1355`); `ValidaCentroCustos` (`:1358-1367`).
5. Manutenção: "`O lote de manutenção não foi encontrado.`" + `ReversaoPermitida` (`:1369-1397`, ver §1.8).
6. **Recursos < total** → "`Total de recursos não confere com o total dos documentos. Deseja gerar uma baixa parcial?`" (`:1403-1405`).
   Não → volta. Sim → exige todos do mesmo cliente **em `cdsDoctosRec`** (senão "`A baixa parcial de documentos só pode ser gerada para
   duplicatas do mesmo cliente!`" `:1487-1491`), pede **nova data de vencimento** (`frmRetornaInfo`, `:1432-1435`) e **grava o título-saldo
   ANTES e FORA da transação** (`ApplyUpdates` em `:1466`) — ⚠️ se a baixa falhar depois, o saldo fica órfão. Colunas do título-saldo
   (`:1441-1464`): `CODRCB`(GetID), `CODOPERADOR`, `CODPARCEIRO`(doc corrente), `QUITADA='N'`, `CODEMPRESA`=doc, `GERADO='SISTEMA'`,
   `VALOR = total a baixar − recursos`, `DTVENC`=data digitada, `DTVENDA`=`DATA_VENDA` do doc corrente, `TXJUROS`=`EMPRESAS.TXJUROPADRAO`,
   `IDPGTO`=1ª forma `DESTINO='RCB'`, `TIPODOC='DUPLICATA'`, `DUPLICATA='DUP-001/001'`, `IDLOTE`, `OBS='Documento gerado da baixa parcial do
   lote: <lote>'`, `CONSILIADO='S'`, `DOCNF`=`NRO_NF`, **`ORIGEM='B'`**. Pergunta "`Deseja imprimir o boleto?`" (`:1469`).
7. **Recursos > total**: só se `MOSTRAR_TROCO_BAIXA_CR='S'` → `TFrmResumoBaixa` + MCB de troco preparado (`:1499-1541`; mensagens
   "`A forma de pagamento "DINHEIRO" não foi encontrada.`" / "`Informe a conta corrente para a forma de pagamento %s.`"). Produção 'N'.

**Transação** (`StartTransaction` `:1543` … `Commit` `:1803`; erro → "`Ocorreu um erro durante a baixa e o processo será revertido.`"+msg, rollback `:1806-1814`):

| # | Escrita | Linha |
|---|---|---|
| 1 | Manutenção: `ReverteLote(lote antigo)` | `:1545-1551` |
| 2 | `SetaDataContaCorrente(cdsContaCorrente, data)` (FuncoesApollo — reimpõe as datas do recurso; vivo: `DTEMISSAO=DTVENC=DTPGTO` em 99%) | `:1553` |
| 3 | `CARTAO` (ApplyUpdates) | `:1557-1558` |
| 4 | `SetOperadorObs`: `HISTORICO := [HISTORICO + ' - '] + 'Baixa das contas a receber realizada pelo(a) usuário(a) <NOME>.'` | `:1560`, `:2822-2844` |
| 5 | recurso SALDO removido do MCB | `:1562-1570` |
| 6 | **INSERT `MOV_CONTAS_BANCARIAS`** (ApplyUpdates de `cdsContaCorrente`) | `:1572-1573` |
| 7 | `CHEQUE` / `PERMUTAS` (ApplyUpdates) | `:1575-1585` |
| 8 | MCB de troco (só `MOSTRAR_TROCO='S'`) | `:1587-1591` |
| 9 | `LancaNovoSaldo` (recurso SALDO): `UPDATE APAGAR SET QUITADA='S' WHERE ADCREDITO='S' AND QUITADA='N' AND CODPARCEIRO=…` + `LancaSaldo` da sobra | `:1598-1599`, `:1282-1297` |
| 10 | Loop dos docs **ordenados por `TOTALCOMJUROS` ascendente** (`:1595`): `ARECEBER_BX_SALDO`/`ARECEBER_BX` (abaixo) | `:1601-1750` |
| 11 | por doc: `UPDATE ARECEBER SET QUITADA='S', ANTECIPADO=iif(ANTECIPA,'S','N') WHERE CODRCB=…` (`sqqUpdate`, `UdmbaixaAreceber.dfm:2199-2205`) | `:1752-1755` |
| 12 | por doc com `CODADIANTAMENTO>0`: `UPDATE ADIANTAMENTO_FORN SET QUITADA='S'` | `:1757-1758`, `:1224-1246` |
| 13 | por doc: `AtualizaAgrupamento(True)` → se `AGRUPAMENTO='S'` e `CODGRUPO>0`: `UPDATE ARECEBER SET QUITADA='S' WHERE AGRUPADO='S' AND CODGRUPO_AGRUPAMENTO_RCB=<CODGRUPO>` | `:1762`, `:236-259` |
| 14 | `CAIXA` juros (+), acréscimos (+), descontos (−) | `:1767-1769`, `:1260-1280` |
| 15 | ApplyUpdates `ARECEBER_BX`, `ARECEBER_BX_SALDO` | `:1771-1775` |
| 16 | `LancaTroco` (troco de cheque) | `:1777-1801`, `:2273-2310` |

**Depois do commit:** log texto `Logs\BaixaReceber\ddMMyyyy\BaixasComSucesso.log` (`:1805`, `:3031-3062`); se
`EMPRESAS.INTEGRACAO='AUTOMATICA'` → `IntegraBaixaAreceber` **fora da transação, com `except end` que engole o erro** (`:1831-1832`,
`:2261-2271`); "`Documentos baixados com sucesso. Deseja fazer a emissão do recibo?`" → `Config\recibo.fr3` sobre `GET_ARECEBERBX
WHERE LOTE=:LOTE` (`:1842-1850`, `UdmbaixaAreceber.dfm:1884-1888`).

**`ARECEBER_BX` por doc (caminho sem SALDO, `:1709-1750`)** — `CODRCBBX`=GetID('CODRCBBX'); `CODRCB`; **`VALORPG`** = alocação corrida:
`baixado := total recursos; baixado −= TOTALCOMJUROS; VALORPG = TOTALCOMJUROS se baixado>0, senão max(0, TOTALCOMJUROS+baixado)`
(o doc que "estoura" recebe o resto; os seguintes recebem **0** — todos são quitados); `DTPGTO`=data da baixa; `OBS='DOCUMENTO BAIXADO NO
LOTE: <lote> - ' + Trim(dbmObs.Text)` (o HISTORICO do recurso corrente, já com o sufixo do operador); `ACRE_DESC=ACREDESC`;
`JUROS`,`TX_JUROS` (só com `CALCULAJURO`); `CODOPBX`; `IDLOTE`; `CODOPERADOR_LIBERACAO_DESCONTO` (se ≠0); `CODPLC_ACREDESC` = CC acréscimo
se >0 / CC desconto se <0; `CODPLC_JUROS` se juros>0; `TX_ANTECIPACAO`,`VR_ANTECIPACAO` (se `ANTECIPA`). `OnNewRecord`
(`UdmbaixaAreceber.pas:543-549`): `DATA_OPERACAO`=hora do servidor, `INDR='I'`, `INDR_USUARIO`, `INDR_DATA`. `CONTABILIZADO` é
gravado depois pela integração. ⚠️ **VIVO≠FONTE:** produção grava também `VALOR_PERC_MULTA` = cópia do título (3.413 linhas 'F');
`MULTA`/`TXMULTA` = 0. `OBS_EDITAVEL` nunca escrito aqui. Caminho com SALDO: rateio por `Indice = parte/TOTALCOMJUROS` entre
`ARECEBER_BX_SALDO` e `ARECEBER_BX` (`:1603-1707`, `TruncarArredondar(...,'A',2)`, resíduo no BX).

**`MOV_CONTAS_BANCARIAS` — colunas exatamente como escritas** (ProviderFlags `UdmbaixaAreceber.dfm:351-444`; `NewRecord` `:578-583`):

| Coluna | Valor | Origem |
|---|---|---|
| CODMOVCONTA | `GetID('CODMOVCONTA')` | `UdmbaixaAreceber.pas:581` |
| CODCONTA | conta escolhida no recurso | `:509` |
| VALOR | **positivo** = valor digitado do recurso (pode incluir o excesso que virou acréscimo) | `edtVlrBaixa` |
| DTEMISSAO / DTVENC | data da baixa | `:359-360`, `:1553` |
| NRODOCUMENTO | **nunca preenchido** (vivo: 100% nulo) | — |
| LIBERADO / DTLIBERACAO | ver tabela 1.3; `ContaInterna` → 'S' + `Now` | `:326-365`, `:2056-2060` |
| TIPOMOVIMENTO | `'C'` | `:358` |
| HISTORICO | obs digitada (padrão `'BAIXA DO LOTE <n>'` · `'<CLIENTE> - BAIXA DO LOTE <n>'` se por cliente · `'REF BX LOTE: <n> - ARQ RET: <arq>'`) + `' - Baixa das contas a receber realizada pelo(a) usuário(a) <NOME>.'` (obrigatório: "`É obrigatório informar o histórico da baixa.`") | `:397-406`, `:2008-2009`, `:2833-2835` |
| CODOPCONTA | `0` | `UdmbaixaAreceber.pas:582` |
| IDLOTE | lote da baixa | `:580` |
| IDPGTO | forma localizada (tabela 1.3) | `:357` |
| CODOPERADOR | **não escrito** (vivo: 100% nulo) — só o troco grava | — |
| RECURSO | ⚠️ **VIVO≠FONTE**: texto do item do combo (ex. `1 - DINHEIRO`) — não existe no fonte | vivo |

Demais colunas (`ORIGEM`, `IDORIGEM`, `DTPGTOBX`, `TIPO`, `REVERTIDO`…) ficam nulas (vivo confirma). `CONTABILIZADO` vem da integração.

**MCB de troco** — `LancaTroco` (`:2273-2310`, cheque, `MOSTRAR_TROCO<>'S'`): `CODCONTA`=conta do recurso-cheque, `DTEMISSAO=DTVENC=Now`
(não a data da baixa), `LIBERADO=iif(ContaInterna,'S','N')`, `DTLIBERACAO` idem, `CODOPCONTA='0'`, `CODOPERADOR`, **`VALOR=−troco`**,
`HISTORICO='Troco referente a baixa de contas a receber do lote <n>'`, `TIPOMOVIMENTO='D'`, `IDLOTE`, `IDPGTO`=forma DINHEIRO/CXA.
Via resumo (`MOSTRAR_TROCO='S'`, `:1518-1530`): conta = `FORMAS_PGTO.CODCONTACORRENTE` da DINHEIRO, datas = baixa, `LIBERADO='S'`, `'D'`,
`VALOR=−troco`, `HISTORICO='Troco referente a baixa de contas a receber, lote nº <n>'`, `CODOPCONTA=0`, `CODOPERADOR`.

**CAIXA** (`LancaCaixa` `:1260-1280`): `CODCX`=GetID, `DATA`=`DTVENC`=data da baixa, `VALOR=VRTITULO`, `OBS` =
`'Ref. juros recebidos lote <n>'` / `'Ref. acréscimos recebidos lote <n>'` / `'Ref. descontos concedidos lote <n>'` (desconto com valor
**negativo**), `OPERADOR`, `CODPLC`=CC da natureza, `IDEMPRESA`=empresa logada, `TIPORECURSO='DINHEIRO'`, `CODCONTA=NULL`,
`CODPARCEIRO=0`, `NRPARCELA=1`, `CODGRUPO=NULL`, `GERADO='SISTEMA'`, `IDLOTE`, `ORIGEM='BAIXA ARECEBER'`. (Já convertido, mig 323 — `CAIXA-escritores.md` §4.)

**CHEQUE recebido** (`cdsChequesNewRecord` `UdmbaixaAreceber.pas:551-563` + diálogo): `CODCHQ`=GetID, `OPERADOR`, `CODPARCEIRO`=cliente do
doc corrente, `BAIXADO='N'`, `IDEMPRESA`, `QTDECHQ=1`, `IDLOTEBXRCB`=lote, `OBSERVACAO='REFERENTE A BAIXA DO LOTE: <n>'`, digitados
`NROCHEQUE`, `BOMPARA`, `DTEMISSAO`, `VALOR`, `TITULAR`(default = cliente), `CODBCO`, `IDPGTO`, `CODPARCEIRO`; `CONSILIADO='S'`
(`ULancRecursosRCBbx.pas:270`). `CODMOVCONTA` é campo interno (não persiste). O MCB do cheque vai para conta **caixa**.

**Contábil** (`TIntegracaoContabilBaixaContasReceber.Integrar`, `UIntegracaoContabil.pas:3547-3845`): lotes com `ARECEBER_BX`
não contabilizado, `VALORPG>0`, `INDR='I'`, **título sem `COD_DESCONTO_TITULO`** (`:3519-3545`). Crédito = cada BX na conta
`COALESCE(ARECEBER.CODPLANOCONTAS_CRED_BAIXA_CR, PARCEIROS.CODCONTABIL)` (`:3481-3517`) + MCB de valor negativo (troco) no crédito
(`:3620-3647`); débito = MCB positivos na `CONTAS_BANCARIAS.CODLANCCONTABIL` (`:1960-1984`, exclui histórico `DEVOLUÇÃO DE CHEQUE`).
**Sem MCB o lote não contabiliza**: "`Os registros de baixa de contas a receber referentes ao lote <n> não foram encontrados.`"
(`:3658-3659`). Situação `SitBaixaRcb` (prod. 2009), `DIARIO.CODORIGEM=16`; depois por BX: juros (origem 56, `SitJurosRecebidos` —
prod. **nula**), acréscimo (57, sit. 878, D cliente/C CC) e desconto (58, sit. 879, D CC/C cliente), exigindo `CODPLC_JUROS`/
`CODPLC_ACREDESC` ("`O centro de custo para … não foi informado na baixa da conta a receber nº <n>.`" `:3729-3730`, `:3769-3770`).
Marca `ARECEBER_BX.CONTABILIZADO='S'` e `MOV_CONTAS_BANCARIAS.CONTABILIZADO='S'` (`:3683-3695`).

### 1.7 Manutenção de lote e reversão

Entrada em `UconsRCBbx.pas:278-380`: "`Informe o lote para realizar a manutenção.`"; valida `ReversaoPermitida`; recarrega os docs do lote
antigo (juros/antecipação/acréscimo da BX), gera **lote novo**, data da baixa = a do lote antigo, trava juros e acréscimo global
(`:368-369`). Ao gravar, reverte o antigo dentro da transação (`UBaixaAreceber.pas:1545-1551`).

`ReversaoPermitida` (`UReversaoBaixa.pas:115-144` + `UReversaoBaixaContasReceber.pas:228-271`) e mensagens (`UReversaoBaixa.pas:15-18`,
`:160-170`): período fechado (hoje e `DTEMISSAO` de cada MCB) → msg de período; **caixa fechado** (`TContasBancariasBO.CaixaFechado` por
MCB) → "`Não será possível reverter a baixa pois o caixa foi fechado.`"; BX contabilizada com integração ≠ AUTOMATICA →
"`…existem documentos que já foram contabilizados.`"; título com `COD_DESCONTO_TITULO` → "`…possuem vinculo com desconto de titulos`";
lote vazio → "`Baixa não foi encontrada.`".

`ReverteLote` (`UReversaoBaixaContasReceber.pas:273-353`): estorna contábil (`Estornar`, `UIntegracaoContabil.pas:3346-3479` — apaga
`DIARIO` 16/56/57/58, zera `CONTABILIZADO`); por título `QUITADA='N', ANTECIPADO=NULL` (`:95-105`); `AtualizaAdiantamentoFornecedor`
⚠️ grava `QUITADA='S'` (não reabre o adiantamento — `:68-79`); agrupamento → membros `QUITADA='N'` (`:81-93`); sobra de SALDO vira
`APAGAR` de crédito (`:206-226`, `:333-336`); `DeletaBaixa` (`:107-181`): cada MCB do lote vira `REVERTIDO='S'` e ganha um **espelho**
(novo `IDLOTE`, `IDLOTE_REVERSAO`=lote, tipo invertido, `VALOR` negado, datas = hoje se conta própria, `HISTORICO='Reabertura da baixa de
contas a receber, lote <n>, realizada pelo usuário <nome>.'`, `IDORIGEM=0`) — **sem MCB: "`Movimentação não encontrada.`"**; apaga
título-saldo parcial (`OBS LIKE '%PARCIAL DO LOTE: n%' OR IDLOTE=n`) e as BX dele; `ARECEBER_BX`/`_SALDO` → `INDR='E'`; `DELETE`
de `CHEQUE`(IDLOTEBXRCB), `PERMUTAS`, `CARTAO`, `CAIXA` (3 textos do lote).

### 1.8 Datas

`edtDataBaixaExit` (`:583-641`): futura acima de `QTDE_DIAS_BX_RCB_FUTURA` → "`A data informada para baixa excede a quantidade de dias
permitidos para baixa futura!`" (só se >0); retroativa com `PERMITE_BX_RCB_DATA_RETROATIVA='N'` → "`Não é permitido realizar a baixa de
contas  informando data retroativa!`". Produção: futura = **0 (sem limite)**; `PERMITE_BX_RCB_DATA_RETROATIVA` está `OBSOLETO='T'`,
substituída por `QTDE_DIAS_BX_RCB_DATA_RETROATIVA`=0 (⚠️ **VIVO≠FONTE**: config nova). Vivo: 1 lote com **DTPGTO 24/05/5022**
(R$ 1.000, com linha de CAIXA de desconto em "5022") — o limite zero deixou passar.

### 1.9 Configurações em produção (CONFIGURACOES / _ESPECIFICAS)

| Config | Global | Específica | Efeito |
|---|---|---|---|
| MOSTRAR_TROCO_BAIXA_CR | N | — | excesso vira acréscimo (cheque: troco) |
| BAIXA_RCB_POR_CLIENTE | N | usuário 1 = S | SALDO e filtro por cliente só p/ o programador |
| PORCENTUAL_MAXIMO_DESCONTO | 0 | usuário 102 = 100 | todo desconto pede liberação (exceto FLAVIA) |
| USUARIOS_LIBERAM_DESCONTO_MAXIMO_EXCEDIDO | S | usuários 1, 3, 102 | liberadores |
| CALCULAR_DESCONTO_SOBRE_JUROS_BXCR | N | — | base do juro = VALOR |
| FORCAR_JUROS_BAIXA_ARECEBER | N | Retaguarda = N | — |
| QTDE_DIAS_BX_RCB_FUTURA | 0 | Retaguarda = 0 | sem limite |
| PERMITE_BX_RCB_DATA_RETROATIVA | S (obsoleta) | Retaguarda = S | — |
| **Só no binário novo:** QTDE_DIAS_BX_RCB_DATA_RETROATIVA=0 · PERMITIR_BAIXA_SALDO_CREDITO=N · GERAR_CREDITO_TROCO_BAIXA_CR=N · GERAR_ADIANTAMENTO_TROCO_BAIXA_CR=N | | | sem fonte |

---

## 2. Catálogo de validações/mensagens (verbatim)

| Condição | Mensagem | Onde |
|---|---|---|
| adicionar recurso com restante 0 | `Total de recursos ja informado!` | `:273` |
| SALDO sem config por cliente | `Recurso disponível somente quando o sistema está configurado para filtrar previamente o cliente.` | `:314`, `:2014` |
| conta inexistente | `Conta não encontrada.` | `:511` |
| sem linha em CONTAS_BANCARIAS_OP | `Este Operador não tem permissão para manipular essa conta corrente.` | `:522` |
| recurso bancário em conta caixa | `Esta conta corrente é conta caixa, não permite operações bancárias!` | `:525` |
| cheque em conta banco | `Esta conta corrente é conta banco, não permite operações de caixa!` | `:528` |
| sem `CBO_BAIXA_CR` | `O operador não possui permissão para baixar contas a receber nesta conta corrente.` | `:533`, `:2035` |
| chaveamento da conta da forma | `Caixa FECHADO não é permitida alteração dos documentos!` | `udmPrincipal.pas:2196` |
| empresa sem formas | `Não a formas de pagamento configuradas para empresa!` | `udmPrincipal.pas:2213` |
| data futura / retroativa | (ver §1.8) | `:598-613` |
| desconto global > soma | `O valor do desconto não pode ser maior que a soma das contas.` | `:692` |
| liberação de desconto | `Nenhum usuário foi definido para liberar o desconto.` · `Informe o login e senha de um usuário com permissão para liberar o desconto.` · `O usuário informado não tem permissão para liberar o desconto.` | `:460-471` |
| valor do recurso ≤ 0 | `Valor deve ser maior que zero!` · `É obrigatório informar o valor do recurso.` | `:812`, `:2001` |
| conta obrigatória | `É obrigatório informar a conta corrente.` | `:2006` |
| histórico obrigatório | `É obrigatório informar o histórico da baixa.` | `:2009` |
| SALDO > saldo do cliente / repetido | `O valor informado (x) é maior que o saldo do cliente (y).` · `Um recurso do tipo saldo já foi informado.` | `:2017-2024` |
| recurso já coberto | `O total de documentos deste recurso já foi atingido!` | `:2129` |
| cheques/permutas incompletos | `Valor dos cheques incompleto!` · `Valor das permutas incompleto!` | `ULancRecursosRCBbx.pas:234`, `:242` |
| excluir recurso sem recurso | `Não existem recursos para serem excluídos.` | `:1163` |
| documentos × recursos | `Nenhum documento foi selecionado ainda.` · `Exclua os recursos antes de excluir um documento.` · `Exclua os recursos antes de adicionar um documento.` | `:1204-1209`, `:1909` |
| pesquisa vazia (por cliente) | `Não existem titulos selecionados para baixa!` | `:879` |
| consulta sem acesso | `Operador não possui acesso ao formulário solicitado. Verifique!` | `:1144` |
| gravar | `Nenhum documento foi selecionado para realizar a baixa.` · `Salve ou cancele o recurso antes de gravar a baixa.` · `Não foi informado nenhum recurso, não é possivel continuar!` · `O valor da conta deve ser maior que zero.` | `:1309-1348` |
| período contábil | `O período contábil foi fechado até %s, entre em contato com o contador responsável.` | `UIntegracaoContabil.pas:14` |
| centros de custo | `Informe o centro de custo para juros.` / `…acréscimos.` / `…descontos concedidos.` | `:2884-2888` |
| parcial | `Total de recursos não confere com o total dos documentos. Deseja gerar uma baixa parcial?` · `A baixa parcial de documentos só pode ser gerada para duplicatas do mesmo cliente!` · `Ocorreu um erro durante a baixa parcial.` | `:1405`, `:1489`, `:1476` |
| troco (MOSTRAR='S') | `A forma de pagamento "DINHEIRO" não foi encontrada.` · `Informe a conta corrente para a forma de pagamento %s.` · `Forma de pagamento "Dinheiro" não encontrada.` | `:1508-1511`, `:1791` |
| erro na transação | `Ocorreu um erro durante a baixa e o processo será revertido.` | `:1809` |
| manutenção | `O lote de manutenção não foi encontrado.` · `Informe o lote para realizar a manutenção.` + mensagens de §1.7 | `:1380`, `UconsRCBbx.pas:286` |
| retorno | `Arquivo não encontrado:` · `Não á registro(s) de boleto com valor(s) recebido(s) no arquivo retorno.` · `Os boletos não foram encontrados no sistema ou já foram baixados.` · bancos (§1.1) | `:2622-2711` |
| sucesso | `Documentos baixados com sucesso. Deseja fazer a emissão do recibo?` | `:1842` |

**Não existem no legado (provado por grep em `UBaixaAreceber.pas`):** trava por **lote de cobrança** (`LOTE_COBRANCA` só é coluna da view),
trava por **remessa** (`REGISTRO_ARQ_REMESSA` só aparece no boleto `:2938`), verificação de **saldo** da conta (VerifSaldo=False), exigência
de caixa aberto. O `TITULO_EM_LOTE` do app atual é regra do Apollo, não do legado.

---

## 3. Perfil de produção (2025-01-01 → 2026-09-24; `ARECEBER_BX.INDR='I'`)

**Volume:** 958 lotes · 7.190 baixas · R$ 6.186.583 (2025: 631 lotes/4.379/R$ 3,58 M; 2026: 326/2.809/R$ 2,61 M; +1 lote "5022").
~40 lotes/mês desde jun/2025. 9 operadores (FLAVIA 728 lotes, LARISSA FREITAS 96, SUIAME 48, JFG 43…). 18 lotes revertidos (17
re-baixados). `ARECEBER_BX_SALDO`: **0 linhas em toda a história**.

**MCB:** **958/958 lotes (100%) têm MOV_CONTAS_BANCARIAS**; Σ MCB = Σ VALORPG (R$ 3.580.334,66 × 3.580.330,26 em 2025; idêntico em 2026).
Todas `TIPOMOVIMENTO='C'`, `VALOR>0`, `CODOPCONTA=0`, `NRODOCUMENTO` e `CODOPERADOR` nulos, `ORIGEM/IDORIGEM` nulos.

**Classificação dos lotes (por histórico do MCB):**

| Origem | Forma (FORMAS_PGTO do MCB) | Conta | Lotes | Docs | Valor |
|---|---|---|---|---|---|
| **Arquivo retorno** (`REF BX LOTE … ARQ RET: CN*.RET`) | DINHEIRO (1) | banco (182: 400, 322: 10) | **410** | **4.002** | **R$ 4.964.745** |
| Manual, 1 recurso | DINHEIRO | **banco** (182: 245, 42: 129, 322: 15…) | 392 | 1.259 | R$ 785.122 |
| Manual, multi-recurso (1 título, 47-90 linhas PIX POS) | PIX POS (101) / IFOOD 2 | banco (conta 1 "CONTA CARTAO") | 99 | 948 | R$ 168.509 |
| Manual, 1 recurso | DINHEIRO | **caixa** (61 "FLAVIA DE OLIVEIRA": 45, outras 3) | 48 | 970 | R$ 112.320 |
| Desconto de títulos (outra tela, `uDescontoTitulo`) | DINHEIRO | caixa (61/201) | 6 | 6 | R$ 147.976 |
| Retorno com recurso `12 - PIX SICOOB` | BOLETO (8) | 182 | 1 | 3 | R$ 7.873 |
| Manual PIX POS 1 linha | PIX POS | 1 | 2 | 2 | R$ 39 |

- **Recursos por lote:** 859 lotes com 1 MCB; 99 com 47-90 (todos fev-mai/2025: um cliente pagando por PIX POS, cada PIX uma linha,
  encadeando **baixa parcial** diária). Nenhum lote mistura tipos.
- **RECURSO (texto do combo):** `1 - DINHEIRO` 849 lotes (801 em conta **banco** — o operador usa "dinheiro" para depósito/PIX em banco),
  `8 - CARTAO` 101, `5 - DÉBITO EM CONTA` 1, `12 - PIX SICOOB` 1, nulo 7 (as 6 do desconto de título + o lote 5022).
- **Caixa (CODBCO=0) × banco:** 54 lotes em caixa (48 manuais + 6 desconto de título) × 904 em banco.
- **LIBERADO:** DINHEIRO 'S' com `DTLIBERACAO`=data (856 linhas); PIX POS/IFOOD/DÉBITO **'N', quase todas com `DTLIBERACAO` nulo** (6.705 — seguem 'N'
  até hoje); PIX SICOOB **nulo**.
- **HISTORICO — 5 amostras reais:**
  1. `REF BX LOTE: 91413 - ARQ RET: CN23096A.RET - Baixa das contas a receber realizada pelo(a) usuário(a) FLAVIA.`
  2. `BAIXA DO LOTE 91146 - VIA PIX - Baixa das contas a receber realizada pelo(a) usuário(a) FLAVIA.`
  3. `BAIXA DO LOTE 69770 - Baixa das contas a receber realizada pelo(a) usuário(a) SUIAME.`
  4. `RECEBIMENTO DONA NEUZA - Baixa das contas a receber realizada pelo(a) usuário(a) …` (obs totalmente digitada)
  5. `- Baixa de contas a receber via desconto de titulo nº 132551 realizada pelo(a) usuário(a) LETICIA ADM2.` (outra tela)

  Padrões: `BAIXA DO LOTE N - Baixa…` 6.925 linhas · `REF BX LOTE: N - ARQ RET: …` 411 · `… - VIA PIX - …` 128 · resto texto livre.
- **Cheque recebido na baixa:** **0** em 2025-26 (toda a história: 10 cheques, 2022-23; 4 MCB CHEQUE em 2022).
- **Cartão:** 101 lotes com forma CRT, **0 linhas em `CARTAO`** (⚠️ VIVO≠FONTE, ver §1.3). Permuta: **0** na história. SALDO: **0** na história.
- **Troco:** **0** linhas MCB "Troco referente…" na história (MOSTRAR_TROCO='N').
- **Baixa parcial:** **107** títulos-saldo `ORIGEM='B'` gerados em **106 lotes** (98 = cadeia PIX POS; 6 dinheiro; 1 IFOOD; 1 PIX POS).
  História: 187 em 2023, 55 em 2024, 28 em 2025, 1 em 2026.
- **Acréscimo/desconto:** 175 baixas/117 lotes com acréscimo (R$ 3.737,70 — **93 dos 117 lotes vêm do arquivo retorno**,
  `ValorRecebido−ValorDocumento`); 54 baixas/35 lotes com desconto (R$ −2.794,66; 34 manuais). Liberação de desconto gravada em 20
  baixas/7 lotes (operadores 3 e 102). CAIXA `BAIXA ARECEBER`: 117 acréscimos (R$ 3.737,70) + 35 descontos (R$ −2.794,66) — batem 100%.
  Juros: **0**. Multa: **0**. Antecipação: **0**.
- **Títulos baixados:** `ORIGEM` nulo 5.816 · `W` 1.226 · `B` 89 · `Q` 58 · `P` 1 (vide `ARECEBER.ORIGEM`: F/W/Q/B no dado vivo). Empresa 50
  (BOLETO/OPERADOR) 4.442 · 1 2.441 · 2 307; forma do título `IDPGTO` 8 BOLETO 4.448 · 5 CONVÊNIO 2.389 · 202 293 · 23 50 · 235 10.
  `REGISTRO_ARQ_REMESSA='S'` em 4.411 (61%); `AGRUPAMENTO='S'` em **66** (AtualizaAgrupamento em uso); `COD_DESCONTO_TITULO` 7 (as 6
  baixas da outra tela + 1); `CODADIANTAMENTO` **0**; `LOTECOB` 1; vencidos na data da baixa 5.363 (75%).
  **391 lotes com mais de um cliente**; 19 lotes com títulos de mais de uma empresa.
- **Datas:** 289 lotes no mesmo dia · 185 com 1 dia de atraso · 268 com 2-7 · 137 com 8-31 · **78 com >31 dias retroativos** · 1 futuro (5022).
- **Contábil:** 7.131/7.190 BX `CONTABILIZADO='S'` (as 59 fora: 52 da empresa 50 — sem `INTEGRACAO` — as 6 do desconto de título e 1 avulsa);
  DIARIO 2025+: origem 16 = 14.603 linhas, 57 = 173, 58 = 53 (56 = 0).

---

## 4. Plano de cortes (ordenado por uso)

O app hoje baixa **um título por vez**, recurso DINHEIRO → sessão de caixa interna / BANCO → só contábil, e **não grava
MOV_CONTAS_BANCARIAS** (`apps/api/src/modules/cobranca/areceber-baixa.service.ts:86-203`). No legado **100% dos lotes gravam MCB** e o
contábil do legado **exige** o MCB. Esse é o buraco principal.

| Corte | Conteúdo | Uso que cobre | Números |
|---|---|---|---|
| **A — Lote + recurso em conta (MCB)** | lote com N títulos (pesquisa GET_RCB com o filtro de §1.1; alocação por `TOTALCOMJUROS` ascendente, `VALORPG` corrido); **1..N recursos** gravando MCB com as colunas exatas de §1.6 (`C`, valor +, `CODOPCONTA=0`, IDPGTO da forma, `RECURSO` texto, HISTORICO + sufixo do operador verbatim, LIBERADO por tipo); regras conta caixa×banco (`:524-528`), `CONTAS_BANCARIAS_OP`+`CBO_BAIXA_CR`, chaveamento; ARECEBER_BX completo (OBS `DOCUMENTO BAIXADO NO LOTE:`, INDR, DATA_OPERACAO, VALOR_PERC_MULTA do título); `QUITADA/ANTECIPADO`; agrupamento; CAIXA (já existe); contábil passando a debitar a conta do MCB (origem 16/57/58). Recursos: DINHEIRO (caixa e banco), DOC, TRANSFERÊNCIA, DÉBITO, ANTECIPAÇÃO, CARTAO (forma CRT escolhida, LIBERADO 'N', **sem** tabela CARTAO — como o vivo). | toda baixa manual | **541 lotes** (392 banco + 48 caixa + 99 multi-PIX + 2), 3.179 docs, R$ 1,07 M; 100% dos lotes precisam de MCB |
| **B — Arquivo retorno** | ler CNAB (Itaú/BB/Bradesco/SICOOB; hoje o nome `CN*.RET` = SICOOB), nosso número → CODRCB, `ACREDESC = recebido − documento`, data = data do arquivo, histórico padrão `REF BX LOTE: n - ARQ RET: arq`; grava pelo corte A | maior volume por valor | **410 lotes, 4.002 docs, R$ 4,96 M (80% do valor)**; 93 lotes com acréscimo |
| **C — Parcial + desconto/acréscimo global com liberação** | título-saldo `ORIGEM='B'` (colunas de §1.6 item 6; **dentro** da transação — divergência consciente do `:1466`); senha DESC só no campo global/excesso; `DescontoValidado` (% máximo + usuários liberadores, gravando `CODOPERADOR_LIBERACAO_DESCONTO` **sem** o vazamento entre lotes); excesso → acréscimo (MOSTRAR_TROCO='N') | encadeamento PIX POS; descontos | **106 lotes parciais**, 35 lotes com desconto, 7 com liberação |
| **D — Manutenção/reversão de lote** | `ReversaoPermitida` + `ReverteLote` (MCB espelho `REVERTIDO`/`IDLOTE_REVERSAO`, `INDR='E'`, apaga saldo parcial/CAIXA/CHEQUE/CARTAO) — **sem** o bug do adiantamento (`QUITADA='S'` na reversão) | correções | 18 reversões, 17 re-baixas |
| **E — Juros/multa/antecipação por documento** | fórmula de §1.2 (TXJUROS/30, tolerância, base configurável, `ADM` p/ marcar); multa da view GET_RCB; antecipação | hoje nulo | **0** baixas com juros, multa ou antecipação em 2025-26 |
| **F — Cheque recebido, troco, SALDO, permuta** | CHEQUE (`IDLOTEBXRCB`, conta caixa, `LancaTroco`), resumo de troco (`MOSTRAR_TROCO='S'`), SALDO/`ARECEBER_BX_SALDO`/crédito `APAGAR`, permuta | legado sem uso | cheque 0 (10 na história, último 2023); troco 0; SALDO 0; permuta 0 |

Adiantamento (`CODADIANTAMENTO`, 0 uso) entra no A só como o `UPDATE ADIANTAMENTO_FORN` já mapeado em `uCadAdiantamentoFornecedor.md`.
Recibo (`recibo.fr3`) e boleto do saldo parcial acompanham os cortes A e C.

## 5. Surpresas e divergências a decidir

1. **MCB em 100% dos lotes** e o contábil do legado **depende** dele (`UIntegracaoContabil.pas:3658`); o app atual não grava MCB.
2. **O combo de produção tem ≥12 recursos** (`12 - PIX SICOOB`) e a coluna `RECURSO` — ausentes no fonte de 2020.
3. **80% do valor recebido entra por arquivo retorno** (410 lotes); o app não tem retorno.
4. **"Dinheiro" em conta banco** é o uso dominante (801 lotes): o recurso DINHEIRO do legado não significa espécie; o app assume que sim.
5. **Cartão parou de gerar `CARTAO` em abr/2024**; os PIX POS ficam `LIBERADO='N'` para sempre (R$ 166,9 mil).
6. **Bugs do legado provados ou lidos (não copiar):** vazamento de `OperadorLiberacaoDesconto` entre lotes (3 lotes no dado);
   título-saldo da parcial gravado fora da transação (`:1466`); reversão marca adiantamento como `QUITADA='S'`; retorno impede parcial
   (`cdsDoctosRec` vazio); chaveamento checado na conta da forma do título, não na conta do recurso; data futura sem limite (lote em 5022);
   filtro de cliente com o código do título (`:1930`); modalidade do cheque com `DESTINO='CHEQUE'` em campo CHAR(3); erro da integração
   contábil engolido (`:2269`).
7. **Juros, multa, antecipação, cheque, troco, SALDO e permuta = 0** em 2025-26 — são os cortes E/F, no fim da fila.

---

## 6. Conversão — corte A (+ parcial, liberação de desconto e reversão/manutenção), backend (24/09/2026)

`cobranca/baixa-receber-lote.service.ts` + controller `cobranca/baixa-receber` (RBAC `FRMBAIXAARECEBER`, `BTNADICIONARREGISTRO`,
`BTNGRAVAR`). Smoke §197 (9 casos).

- Tipos de recurso usados em produção: DINHEIRO (caixa ou banco), DOC, TRANSFERÊNCIA, DÉBITO, ANTECIPAÇÃO (banco), CARTAO
  (a forma escolhida, CRT/TEF, LIBERADO 'N', sem linha em CARTAO — como o vivo). `MOV_CONTAS_BANCARIAS.RECURSO` com o texto do
  combo; conta própria libera na hora. Sem teste de saldo (VerifSaldo=False). Chaveamento na conta do RECURSO (o legado olha a
  conta da forma do título — defeito não copiado).
- Documento: `% × valor + R$ − desconto do cliente (DIASPRAZO/DESCPADRAO) + rateio do global`; juro simples com "Calcula juro".
  Senha DESC só no acréscimo/desconto GLOBAL; `DescontoValidado` (% máximo + liberadores) grava
  `CODOPERADOR_LIBERACAO_DESCONTO` por lote (sem o vazamento do legado).
- Gravar numa transação: MCB (C, positivo, histórico `BAIXA DO LOTE N` + sufixo), ARECEBER_BX (OBS `DOCUMENTO BAIXADO NO LOTE:`,
  `VALOR_PERC_MULTA` do título), `QUITADA`/`ANTECIPADO`, adiantamento, cascata do agrupamento, título-saldo da parcial DENTRO da
  transação, CAIXA (soma do lote). Contábil do lote com AUTOMATICA depois do commit.
- Reversão (`reverterLoteNaTrx`, usada pela consulta de baixas para lote com MCB e pela manutenção): espelho com o RECURSO e
  datas de hoje só na conta própria, `REVERTIDO`, títulos QUITADA N/ANTECIPADO nulo, adiantamento REABRE (o legado grava 'S'),
  membros do agrupamento reabrem, o título-saldo e as baixas dele apagados (como o legado), INDR E, CHEQUE do lote e CAIXA.

Fora (0 uso em 2025-26): cheque, cheque pré, permuta, SALDO, troco, antecipação por documento. Próximo: tela web e o arquivo
retorno (corte B, 80% do valor).
