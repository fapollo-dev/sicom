# Recon NF_PROD — as ~90 colunas que a entrada de NF do legado grava e o Apollo não (25/09/2026)

Fonte do legado: `/Library/SicomGit/retaguarda-master/fonte` (mai/2020, latin1). Números de linha conferidos em cópia UTF-8.
Dado vivo: produção `hiperpinheirao` (somente leitura, `SET TRANSACTION READ ONLY`), itens de NF com `DTEMISSAO >= 2026-01-01`:
**60.717 itens de entrada** (tipo E) e **8.568 de saída**. LOG: `camposlog.txt` do conferidor (`tools/cutover/conferir-campos-da-log.py`).

## 0. Como ler a LOG (por que ~90 colunas aparecem em ~63 mil "Inseriu")

1. **`ZeroToFields(cdsItensNota)`** no `cdsItensNotaNewRecord` (`udmNF.pas:4785`) zera TODO campo numérico do item novo. A função está
   na biblioteca compartilhada (fora do fonte — `FuncoesApollo`); o nome e o dado confirmam: 63.566 de 63.566 inserts listam
   os numéricos. Por isso colunas que **nunca têm valor** (CREDITOICM, VICMSUFDEST, FCP_BC…) aparecem em 100% dos "Inseriu": entram **0**, não NULL.
   Logo depois, zeros explícitos (`udmNF.pas:4829-4854`) e dois flags:
   ```pascal
   cdsItensNotaITEM_PERDA_TOTAL.AsString           := 'N';   // :4856
   cdsItensNotaATUALIZA_MULTIPRECO_DECOMP.AsString := 'S';   // :4857
   ```
2. O form-base loga **todo campo do dataset**, inclusive os de JOIN. `ESPECIFICACAO` é `P.ESPECIFICACAO` (PRODUTOS) no SELECT do
   `qryItensNota` (`udmNF.dfm:2477`) com `ProviderFlags = []` (`udmNF.dfm:2950`, `:5065`): **nunca é gravada em NF_PROD** (1 linha não-nula
   em 60.717). **Falso positivo.**
3. **Fluxo real da entrada por XML**: importa (insert com os valores do XML + zeros) → "Análise de item" abre o diálogo de cada item
   em modo automático (`FormShow` → `AnaliseAutomaticaItens`, `uItensNF.pas:3890-3893` e `:641-683` → `Timer1Timer` `:3614-3622` →
   `btnOkClick`) → grava (os ~60 mil "Alterou" de PMZ/lucros/REPASSADO) → processa. Prova no dado de set/2026:
   NF de entrada **não processadas**: 91 itens, 38 já com PMZ/REPASSADO/ULTCUSTO (os já analisados), 79 com IDPISCOFINS, **0** com USOCONSUMO.
4. **Sem trigger** em NF_PROD na produção (`all_triggers`: só `ESTOQUE_NOTAS` e `AUDIT_NF`, ambas em NF); nenhum PL/SQL grava
   IDPISCOFINS/USOCONSUMO/VRCFOP_ABATIDO/IND_DEDUZ_DESON. Único DEFAULT de coluna: `IND_DEDUZ_DESON DEFAULT 'N'` (Oracle e PG).

## Grupo A — Valores DA NOTA do fornecedor (importação do XML)

**Onde**: `TNFe.ImportaNFe` (`NFe.pas:2842`), laço dos itens `cdsINF.Append` (`NFe.pas:3734`) … `cdsINF.Post` (`NFe.pas:4208`).
Chamado por `uNF.pas:5471` (importar XML) e `uNF.pas:6383` (recuperar XML). `cdsINF` = `cdsItensNota` (construtor `NFe.pas:447-507`, criado em `udmNF.pas:5984`).

| coluna | linha | fonte |
|---|---|---|
| VRCUSTOREAL | NFe.pas:4023 | `Prod.vUnCom` |
| VL_CUSTO / VL_UNITARIO | :4026-4029 | `Prod.vUnCom` (depois recalculado — ver grupo C) |
| TOTAL_PRODUTO_NOTA | :4033 | `Prod.vProd` |
| QTD_NOTA | :4034 | `Prod.qCom` |
| CFOP_ORIGINAL | :4035 | `StrToInt(Prod.CFOP)` (o CFOP do fornecedor, antes do 5→1/6→2) |
| FRETE (%) / FRETE_NOTA | :4039-4040 | `vFrete*100/(vProd-vDesc)` / `Prod.vFrete` |
| SEGURO (%) / SEGURO_NOTA | :4041-4042 | idem `vSeg` |
| DESCONTO (%) / DESCONTO_NOTA | :4047-4048 | `((vDesc/qCom)*100)/vUnCom` / `Prod.vDesc` |
| DEPSACESS / OUTRAS_DESPESAS_NOTA | :4053-4054 | `Prod.vOutro` |
| ARREDONDA | :4057-4068 | 'N' se qtd×fator×custo = vProd−vDesc, senão 'S' |
| IPI (%) / IPI_NOTA | :4078-4079 | `vIPI*100/(vProd-vDesc)` / `IPI.vIPI` |
| IPI_DEVOLUCAO (%) / _NOTA / _PERC_DEVOL | :4081-4083 | `vIPIDevol*100/(vProd-vDesc)` / `vIPIDevol` / `pDevol` (grupo impostoDevol) |
| CST / CST_NOTA | :4101-4109 | `GetCST(CST)` / `CSTICMSToStr(CST)`; se CSOSN: `CSOSNIcmsToStr` + VRCREDSN/ALIQCREDSN |
| ICME / BCR | :4148 / :4151 | `pICMS` / `vBC*100/(vProd-vDesc)` |
| ICMS_ALIQ_NOTA / ICMS_RED_BC_NOTA | :4153-4154 | `pICMS` / `pRedBC` |
| ICMS_ST_ALIQ_NOTA / ICMS_ST_RED_BC_NOTA | :4157-4158 | `pICMSST` / `pRedBCST` |
| **MVA_AJUSTADO** | :4159 | `ICMS.pMVAST` |
| VRICM / VRBASECALCULO | :4165-4166 | `vICMS` / `vBC` |
| ICMS_NOTA_VALOR / ICMS_NOTA_BC | :4168-4169 | `vICMS` / `vBC` |
| VRBASEST / VRICMST / STREAL | :4171-4173 | `vBCST` / `vICMSST` / `vICMSST` |
| **VRBASE_STEXTERNO** | :4174 | `ICMS.vBCST` |
| FCP_BC_ST / FCP_ALIQUOTA_ST / FCP_VALOR_ST | :4178-4180 | `vBCFCPSt` / `pFCPST` / `vFCPST` |
| FCP_BC_ST_RET / _ALIQUOTA_ST_RET / _VALOR_ST_RET | :4182-4184 | `vBCFCPStRet` / `pFCPSTRet` / `vFCPSTRet` |
| VRICMS_DESONERADO | :4186 | `ICMS.vICMSDeson` |
| (strings vazias → NULL) | :4192-4198 | |
| CST/CSOSN/ALIQUOTA remessa depósito | :4201-4206 | CFOP 5906/1906/1905 → CST 090, CSOSN 400, 'NTB' |

Também copiados na importação (já gerenciados pelo Apollo, mas o Apollo não os preenche na importação): `MARKUP` = MULTI_PRECO.MARKUP (`NFe.pas:3927-3944`),
`ALIQPISE/S`, `ALIQCOFINSE/S` do PISCOFINS do produto (`:3967-3977`), `ICMS` do DET_ALIQUOTA (`:4113-4146`).

Nota **não** vinda de XML (digitada/emissão própria): no OK do item `ICMS_NOTA_BC := VRBASECALCULO` e `ICMS_NOTA_VALOR := VRICM`
quando `NF_IMPORTACAO_NFE<>'S'` e (`TIPO='S'` ou `TIPOEMISSAO=0`) — `uItensNF.pas:1814-1829`; nas inclusões por pedido/SCRAP/troca/inventário
`ICMS_NOTA_BC := TEMPBASEICME`, `ICMS_NOTA_VALOR := TEMPVLRICME` (`uNF.pas:13762-13779`, `13922-13932`, `14041-14042`, `14140-14141`, `14239-14240`, `14333-14334`, `18163-18164`).
Devolução de compra: FCP/IPI devolvido/VRBASE_STEXTERNO do pedido (`uNF.pas:12162-12201`).

**Produção 2026 (entrada)**: nas NF importadas (`NF_IMPORTACAO_NFE='S'`, 59.670 itens) CFOP_ORIGINAL 100% preenchido; itens sem XML: 0.
TOTAL_PRODUTO_NOTA≠0 em 52.546; ICMS_NOTA_BC≠0 em 21.813; FCP_*_ST≠0 em 4.419; FCP_*_RET 3.410; VRICMS_DESONERADO 320; IPI_DEVOLUCAO* **0**.
VRBASE_STEXTERNO = VRBASEST em 57.153/59.670; ICMS_NOTA_BC = VRBASECALCULO em 44.034 (a análise recalcula a base; a da nota fica).

**Apollo**: as colunas existem (mig 215) e são **LIDAS** — `conferencia-nf-indexador.service.ts:105-123` (lado "nota" da conferência; com os defaults
TOTAL_PRODUTO_NOTA=0 → qtd×vrcusto, QTD_NOTA=0 → quantidade), `devolucao-compra.aggregate.ts:104-146` e `devolucao-compra.service.ts:219-308`
(ICMS/IPI/FCP a devolver saem de `*_NOTA`). Mas a importação `recebimento.service.ts:318-352` **não grava nenhuma**: NF importada no Apollo
chega à devolução de compra com ICMS/IPI/FCP da nota zerados e à conferência com "nota" = sistema. O parser `nfe-xml.parser.ts:14-47/130-190`
não lê `prod.vFrete/vSeg/vOutro`, `pRedBC`, `pICMSST`, `pRedBCST`, FCP-ST/RET, `vICMSDeson`, `impostoDevol`.
⚠️ `recebimento.service.ts:344` grava `mva: it.pMVAST` — o legado põe pMVAST em **MVA_AJUSTADO**; o `MVA` do legado vem do `TEMPMVA` no OK
(`uItensNF.pas:1593`; TEMPMVA = MVA do produto `:2531` ou do indexador `:960`). Na produção MVA=MVA_AJUSTADO em 9.767 dos 14.117 itens com MVA_AJUSTADO≠0.

## Grupo B — Retrato do produto quando o item é escolhido

**Onde**: `TfrmItensNF.edtCodProdExit` (`uItensNF.pas:2265`), ramo entrada:
```pascal
edtMarkup.Field.AsCurrency         := cdsProdutosMARKUP.AsCurrency;     // :2555  (MARKUP)
edtVenda.Field.AsCurrency          := cdsProdutosVRVENDA.AsCurrency;    // :2556
cdsItensNotaULTCUSTO.AsFloat       := cdsProdutosVRCUSTO.AsCurrency;    // :2557
cdsItensNotaULTCUSTOREP.AsFloat    := cdsProdutosVRCUSTOREP.AsCurrency; // :2558
cdsItensNotaULTVENDA.AsFloat       := cdsProdutosVRVENDA.AsCurrency;    // :2559
if (cdsNotaNF_IMPORTACAO_NFE.AsString <> 'S') then
  if cdsProdutosVRCUSTOREAL.AsCurrency > 0 then
    cdsItensNotaVRCUSTOREAL.AsCurrency := cdsProdutosVRCUSTO.AsCurrency;  // :2567-2571
```
Repetido no ramo de reentrada `:2727-2742`. `cdsProdutos` = `MULTI_PRECO` da empresa ⋈ PRODUTOS (VRVENDA do filho se houver) — `udmNF.pas:6233-6307`.
"Recuperar XML" usa outra regra: `SetaUltCustoItens` (`uNF.pas:16130-16150`, chamado em `:6404`) → `ULTCUSTO := VRCUSTO` do próprio item.
**IDPISCOFINS**: fora do fonte de 2020 (binário novo) — não existe no dataset de 2020; o `ImportaNFe` só LÊ `PRODUTOS.IDPISCOFINS` para achar as
alíquotas (`NFe.pas:3917-3924`). Produção: preenchido em 59.398 itens, **95,4% = PRODUTOS.IDPISCOFINS**, já no item não processado (79/91), LOG inseriu=0/alterou=9.419.

**Apollo**: nada disso é gravado. `ultcusto`/`pmz`/`vrvendasug` são LIDOS de nf_prod por `precificacao-nf.service.ts:134` e
`precificacao-nf-bruta.service.ts:52`. A herança do produto já existe para o pedido de compra (`compras/pedido-heranca.ts`).

## Grupo C — Métricas de precificação por item (o OK do diálogo / "Análise de item")

**Onde**: `TfrmItensNF.btnOkClick` (`uItensNF.pas:1433`), com `TDMNF.CalcValorCusto` (`udmNF.pas:3773-3925`, disparado por `CalcValorNota` `:3928`)
e `TfrmItensNF.MargemL` (`uItensNF.pas:3312-3366`). Só nota de entrada no bloco de margem.

```pascal
// uItensNF.pas
TDMNF(fDMNF).cdsItensNotaCUSTO_REAL_UNIT.AsFloat := TDMNF(fDMNF).cdsItensNotaTEMPVRCUSTO.AsFloat;   // :1552 (se TEMPVRCUSTO>0)
MargemL;                                                                                          // :1555
TDMNF(fDMNF).cdsItensNotaVRAJCUSTODEC47530.AsFloat := TDMNF(fDMNF).cdsItensNotaTEMPVRAJCUSTO47530.AsFloat; // :1557
TDMNF(fDMNF).cdsItensNotaMVA.AsFloat  := TDMNF(fDMNF).cdsItensNotaTEMPMVA.AsCurrency;            // :1593
TDMNF(fDMNF).CalcValorNota(TDMNF(fDMNF).cdsNotaTIPO.AsString);                                   // :1595
TDMNF(fDMNF).cdsItensNotaVRCUSTOREP.AsFloat := TDMNF(fDMNF).cdsItensNotaTEMPVRCUSTOREP.AsFloat;  // :1597
TDMNF(fDMNF).cdsItensNotaVRCUSTOCSI.AsFloat := TDMNF(fDMNF).cdsItensNotaTEMPVRCUSTOCSI.AsFloat;  // :1598
TDMNF(fDMNF).cdsItensNotaPMZ.AsFloat        := TDMNF(fDMNF).cdsItensNotaTEMPPMZ.AsFloat;         // :1599
TDMNF(fDMNF).cdsItensNotaVRVENDASUG.AsFloat := TDMNF(fDMNF).cdsItensNotaTEMPVRVENDASUG.AsFloat;  // :1600
TDMNF(fDMNF).cdsItensNotaVRBASECALCULOICM_CALC.AsFloat := TDMNF(fDMNF).cdsItensNotaTEMPBASEICME.AsFloat; // :1605
VRICM_CALC := TruncarArredondar(TEMPBASEICME * (TEMPALIQUOTAICME/100), 'A'|'T' conforme ARREDONDA, 2) // :1606-1609
VL_UNITARIO := VRCUSTO / FATOREMBAL                                                                // :1618
```
O gravar da NF repete VRBASECALCULOICM_CALC/VRICM_CALC/VL_UNITARIO para todos os itens (`TfrmNF.btnGravarClick`, `uNF.pas:4920-4935`).

**CalcValorCusto** (`udmNF.pas`):
- créditos (não gravados!): `ICME := round(TEMPICMEEFETIVO × VRCUSTOFINAL/100)` se ALIQUOTA 'T*' e não SN; `PIS := round((ALIQPISE+ALIQCOFINSE)×VRCUSTOFINAL/100)` só LR (`:3808-3826`) → `TempCreditoICM/TempCreditoPIS` (`:3854-3855`).
- MG — Decreto 47.530: `TEMPVRAJCUSTO47530 := round(((VRBASE_STEXTERNO/QTDETOTAL − VRVENDA) × AliqInterna(INDEXADORTRIB))/100)` (`:3840-3851`; alíquota do INDEXADOR_TRIBUTARIO ou ICMS_ST_ALIQ_NOTA, `:3787-3803`). Empresas do cliente são todas MG.
- **custo REAL** `TEMPVRCUSTO` = VRCUSTOFINAL + (DEPSACESS+VRSEGURO+VRFRETE+VRIPI+VRIPI_DEVOLUCAO+VROUTRASDESP+ST+FCPST+DESPEXTRAP+VRCUSTOAJUSTENF)/QTDETOTAL + DESPFEDERATIVAS% + FRETE2% − PIS − ICME (`:3858-3874`); ST = VRICMST se STREAL=0, senão STREAL (`:3828-3831`).
- **custo REPOSIÇÃO** = mesma soma, sem créditos, − BONIFICACAO (`:3877-3892`).
- `MargemPreco := TMargemPreco.Create(empresa, produto, TEMPVRCUSTO)`; em TIPO_PRECIFICACAO D/M o custo é o de reposição (`:3898-3904`) — classe em `uMargemPreco.pas`.
- `MargemZero := 100 − (ALIQPISS+ALIQCOFINSS + ICMS(se 'T') + EMPRESA.DESPOPERACIONAL)` (`:3906-3907`);
  `TEMPVRCUSTOREP := CustoReposicao` (`:3911`); `TEMPVRCUSTOCSI := CustoReposicao − TempCreditoICM − TempCreditoPIS` (`:3912`);
  `TEMPPMZ := TEMPVRCUSTO / MargemZero × 100` (`:3914-3915`); `TEMPVRVENDASUG := round(MargemPreco.CalculaValorVenda(MARKUP))` (`:3921`).

**MargemL** (`uItensNF.pas:3312-3366`; controles → campos pelo `uItensNF.dfm`: DBTdebitoICMS=DEBITOICM :2993, dbtVendaLiq=VENDALIQ :3037,
dbtLucroB=LUCROBRUTOV :3065, dbtLucroBp=LUCROBRUTOP :3080, DBTdespOperacional=DESPOPV :3123, dbtLucroL=LUCROLIQV :3145, dbtLucroLp=LUCROLIQP :3160,
dbtImpRendaV=IMPREND :3188, dbtContSocialV=CONTSOCIAL (dsItensNota) :3240, dbtMargemFinalV=MARGEML2V :3261, dbtMargemFinal=MARKUPL2 :3275):
```pascal
if EmpresaCLASSFISCAL = 'SN' then ICM := round(ALQSIMPLESNAC × VENDA/100); PIS := 0
else ICM := round(ICMS × VENDA/100) se ALIQUOTA 'T*' (senão 0); PIS := round((ALIQPISS+ALIQCOFINSS) × VENDA/100)
DEBITOICM := ICM; DEBITOPISCOFINS := PIS
VENDALIQ    := round(VENDA − ICM − PIS)
LUCROBRUTOV := round((VENDA − ICM − PIS) − TEMPVRCUSTO − BONIFICACAO)
LUCROBRUTOP := round(LUCROBRUTOV / (VENDA − ICM − PIS) × 100)
DESPOPV     := round(VENDA × DESPOPERACIONAL/100)
LUCROLIQV   := round(LUCROBRUTOV − DESPOPV);  LUCROLIQP := round(LUCROLIQV / VENDA × 100)
IMPREND/CONTSOCIAL := round(LUCROLIQV × IMPRENDA|CONTSOCIAL /100) se LUCROLIQV > 0, senão 0
MARGEML2V := round(LUCROLIQV − IMPREND − CONTSOCIAL);  MARKUPL2 := round(MARGEML2V / VENDA × 100)
```
(chamada também em `:760` CalculaNF, `:2101`, `:2950`, `:3125`). Mesma escada nos filhos da decomposição: `MargemLucroDecomposicao` `udmNF.pas:10347-10398`.
Herdadas do pedido de compra (`PEDIDOCOMPRA_I`) em vez de calculadas: `uNF.pas:5772-5790` (btnPedCompraClick) e `:2576-2593` (btnAddPedidoClick).

**Consumo no legado**: o processamento `UpdateProdutos` (`udmNF.pas:6778`) usa o gravado com fallback no TEMP (`:6924-6945`) e copia para MULTI_PRECO
(`:7182-7192`, `:7516-7571`) e HISTORICO_PROCESSAMENTO_NF (`:6848-6990`). CREDITOICM/CREDITOPISCOFINS do MULTI_PRECO saem dos TEMP (`:7528-7529`) —
por isso as colunas de NF_PROD ficam sempre 0.

**Produção 2026 (entrada)**: PMZ/VRVENDASUG ≠0 em 60.348; CUSTO_REAL_UNIT 59.947; VRCUSTOREP 60.670; VRCUSTOCSI 60.389; lucros ~57.1-57.4 mil;
IMPREND 50.014; CONTSOCIAL 49.763; DEBITOICM 7.802 (só tributados); VRAJCUSTODEC47530 18.553; VRICM_CALC 7.154; VRBASECALCULOICM_CALC 7.579;
VL_UNITARIO 100%. LOG: insert com 0 e ~53-65 mil "Alterou".

**Apollo**: `PrecificacaoCustoService.calcular` (`precificacao-custo.service.ts:153-235`) é a mesma escada (porta do FRMPRIFICACAOCUSTO, `UPrificacaoCusto.pas:1384-1479`,
que usa o mesmo `TMargemPreco`), e `PrecificacaoNfService.recalcular` (`precificacao-nf.service.ts:298-330`) já a alimenta com os componentes do item.
Diferenças a tratar ao reusar para o item da NF: (1) base: o diálogo usa custo **REAL** (TEMPVRCUSTO), o Apollo usa **CSI** (real = CSI + bonificação);
(2) PMZ: diálogo = real/(100−PIS−COFINS−ICMS−DESPOP)×100; Apollo = `fiscal.pmz(CSI, …)`; (3) LUCROBRUTOV do diálogo subtrai a BONIFICACAO de novo;
(4) componentes que o painel do Apollo não tem: DESPFEDERATIVAS, DESPEXTRA, FRETE2 do item, VRCUSTOAJUSTENF, IPI_DEVOLUCAO, Decreto 47.530.
O Apollo já grava DEBITOPISCOFINS (`nf.aggregate.ts:473`, `piscofins-rentab.ts:24`) — sem o zero do SN que o MargemL aplica (`uItensNF.pas:3319-3322`).
Leitores no Apollo que hoje recebem NULL para NF criada no Apollo: `precificacao-nf.service.ts:134/149/167` (PMZ, VRVENDASUG, ULTCUSTO, markup_autorizado, último custo de reposição),
`precificacao-nf-bruta.service.ts:52`, `previa-fornecedor.service.ts:317/540` (np.vrcustorep).
Observação lateral: o processamento do Apollo (`nf-processamento.service.ts`) só move estoque — o `UpdateProdutos` (custo/preço → MULTI_PRECO + HISTORICO_PROCESSAMENTO_NF) não foi encontrado portado.

## Grupo D — Repasse / indexador tributário (entrada, FIGURAFISCAL 'O'/'S')

Empresas do cliente: 1 e 50 = 'D' (desligado); **2, 51, 52 = 'O' (indexador obrigatório)**; todas MG; LR exceto 50 (SN).

- **INDEXADORTRIB** — `CarregaIndexadorTributario` (`uItensNF.pas:786-1004`): busca a figura (`cdsFigFiscal` por CODFIGURAFISCAL do produto, UF origem/destino, 'F'/'C', CODBARRA, NCM, parceiro, CFOP),
  desempata em sequência CODBARRA → NCM → CODCFOP → CODPARCEIRO → CNPJ_CPF (`:836-890`); achou: `INDEXADORTRIB := cdsFigFiscalCODINDEXADORTRIBUTARIO` (`:961`), CST pela OPERACAO (`:927-951`),
  CFOP/alíquota/redução/TEMPMVA (`:953-960`); não achou: `IndexadorNaoEncontrado` → INDEXADORTRIB := 0, REPASSADO := 'N' (`:792-794`).
- **MVA_AJUSTADO** — `:992` `:= IndexadorTributario.MVAAjustado` (`uIndexadorTributario.pas:259-285`: interestadual e fornecedor não-SN → `((MVA/100+1)*(AliqFonte/100−1)/((Aliq−FEM)/100−1)−1)*100`, 3 casas).
- **REPASSADO** — OK do item (`uItensNF.pas:1840-1856`):
  ```pascal
  if (FIGURAFISCAL <> 'D') and (LIBERA_NF_INDEXADOR <> 'S') then
    if (INDEXADORTRIB > 0) or FornecedorLivreDeIndexador or (FINALIDADE = '4') then REPASSADO := 'S'
    else if FIGURAFISCAL = 'O' then REPASSADO := 'N' else REPASSADO := 'S'
  else REPASSADO := 'S';
  ```
  Efeitos: trava o processamento com item 'N' ("Não é permitido processamento sem repassar todos os itens", `uNF.pas:15038-15077` e `uProcessaNotaFiscal.pas:724-790`);
  marca a esteira `stRepasseItens` se algum item 'S' (`uNF.pas:4978-4979`, `:5171-5181`).
- **VRICMS_STEXTERNO** (ST a recolher) — `RecalculaICMSST` (`uItensNF.pas:3369-3486`): entrada com indexador: `:= IndexadorTributario.VrICMSSTRecolher` (`:3414`, `:3427`)
  ou `VrICMSSTCalculado` p/ ST_EXTERNO sem destaque em CFOP 1403/2403 (`:3385`); sem indexador/SN/saída: 0. `edtStrealExit` (`:3266-3281`): `STREAL − VRICMST − FCP_VALOR_ST` (≥0) quando o total de base ST externo > 0.
  Fórmula `uIndexadorTributario.pas:372-389`: `(débito − crédito) − ST da nota`, com |x| ≤ 0,02 → 0.
- **VRICMS_STEXTERNO_SEPARADONF** — só `:3386` (ST_EXTERNO + 1403/2403 + nota não-XML). 0 em 100% de 2026.
- **VRBASE_STEXTERNO** no diálogo — `edtBaseSTExterno` (`uItensNF.dfm:1812`) := `VrBCSTCalculada` (`:3412`, `:3426`, `:3463`) ou a base da nota; rateio `uNF.pas:15554-15614`.

**Produção 2026 (entrada)**: REPASSADO 'S' 60.001 / 'N' 348 / NULL 368; INDEXADORTRIB>0 45.142 ('S' com 0: 14.859); MVA_AJUSTADO≠0 14.117; VRICMS_STEXTERNO≠0 1.549.
LOG: REPASSADO inseriu 2.723 / alterou 62.039; INDEXADORTRIB 7.779 / 56.307 (nasce na análise, não na importação).

**Apollo**: nenhuma ocorrência de `repassado`/`indexadortrib`. Existem as peças: `TributacaoRepository.resolverFigura` (`tributacao.repository.ts:96-150`, desempate por
especificidade aditiva — não sequencial, sem CNPJ_CPF, e **não devolve CODINDEXADORTRIBUTARIO nem ST_EXTERNO**) e `FiscalPricingService.calcularIcmsSt`
(`preco-fiscal.service.ts:109-160`, porta do TIndexadorTributario com MVA ajustado e débito−crédito), hoje usados só na saída (`nf-fiscal.service.ts:287/336`).
A esteira usa `codproduto > 0` como proxy do repasse (`nf.aggregate.ts:347-351`). O processamento não tem a trava do repasse.

## Grupo E — Decomposição na entrada

**Onde**: `TDMNF.InsereProdutosDaDecomposicao` (`udmNF.pas:9921-10906`), chamado do OK do item quando `ProdutoEntraDecomposto` (`uItensNF.pas:1858-1929`, diálogo
`frmItemDecomposicaoNotaFiscal`), do editar da NF (`VerificaProdutosComEntradaEmDescomposicao`, `uNF.pas:3954` → `:17435-17580`) e do recálculo (`uNF.pas:8804-8890`).
Cada filho (produto da decomposição com PERCENTUAL>0):
```pascal
cdsItensNotaCFOP_ORIGINAL.AsInteger := ACfopOriginal;                         // :10568
cdsItensNotaQUANTIDADE := round(AQtdTotal × PERCENTUAL/100, 3)                // :10575
VRCUSTO := rateio por PERCENTUAL (+ perda) ou por VRVENDA                    // :10577-10597
if PERCENTUAL_PERDAS = 100 then VRCUSTO := 0.01; ITEM_PERDA_TOTAL := 'S'      // :10587-10590
cdsItensNotaDECOMPOSICAO.AsString                := 'S';                      // :10648
cdsItensNotaCODPRODUTOPAI_DECOMPOSICAO.AsInteger := ACodProdutoComposto;      // :10649
cdsItensNotaATUALIZA_MULTIPRECO_DECOMP.AsString  := ifThen(vAtualizaMultiPreco,'S','N'); // :10650
cdsItensNotaDESCRICAO_PRODPAI_DECOMP.AsString    := ADescricaoProdutoComposto;// :10651
cdsItensNotaNROITEM_DECOMP.AsInteger             := ANroItemPai;              // :10652
```
+ indexador do filho (`:9975-10162`), ST externo (`:10239-10336`), margem (`:10347-10398`), lotes (`:10660+`).
**Produção 2026**: 7.124 itens-filho (12% da entrada) com CODPRODUTOPAI/DESCRICAO_PRODPAI/NROITEM_DECOMP; mas **DECOMPOSICAO='N' em todos** (nenhum 'S' em 2026) —
o binário novo mudou o flag (fora do fonte de 2020). ATUALIZA_MULTIPRECO_DECOMP: 'S' 56.707 / 'N' 2.392.
**Apollo**: nenhuma decomposição no item da NF (0 ocorrências de codprodutopai_decomposicao/nroitem_decomp); o cadastro de decomposição existe em `produto.aggregate.ts`.

## Grupo F — Zeros e constantes do NewRecord (sem valor de negócio na entrada)

`cdsItensNotaNewRecord` (`udmNF.pas:4758-4860`) + `ZeroToFields` (`:4785`, biblioteca fora do fonte).
Sempre **0** em 2026 (entrada): CREDITOICM, CREDITOPISCOFINS (nunca atribuídos — só os TEMP), MARKUPL (`:4838`; só lido em `:7527`), VRPIS, DESPEXTRA, FRETE2,
FCP_BC, VICMSUFDEST, VICMSUFREMET, VFCPUFDEST (1 linha), ICMS_UF_DEST_BC, PRODUC_PESO_LIQ_EXP/BRUTO_EXP, IPI_DEVOLUCAO/_NOTA/_PERC_DEVOL, VRSALDOFLEX, VRCOMISSAO,
VRCUSTOAJUSTENF, VRICMS_STEXTERNO_SEPARADONF, VRCFOP_ABATIDO.
Constantes: ITEM_PERDA_TOTAL 'N' (`:4856`), ATUALIZA_MULTIPRECO_DECOMP 'S' (`:4857`), IND_DEDUZ_DESON 'N' (DEFAULT da coluna, Oracle e PG — o Apollo já recebe),
**BENEFICIO = 2** em 59.099/59.099 (2 = checkbox desmarcado, `uItensNF.dfm:3843-3844`; o fonte de 2020 põe **1** no insert pelo diálogo, `uItensNF.pas:3816` —
o 2 no insert vem do binário novo).
Onde têm semântica real (quase só saída): DIFAL `CalculaICMSInterestadual` (`udmNF.pas:3467-3558`: FCP_BC, VFCPUFDEST, ICMS_UF_DEST_BC, VICMSUFDEST, VICMSUFREMET — 0 também na saída de 2026);
VRSALDOFLEX/VRCOMISSAO do pedido de venda (`uNF.pas:1650-1651`); PRODUC_PESO_* do pedido de produção (`uNF.pas:2264-2265`); FRETE2/IPI_DEVOLUCAO por rateio do cabeçalho
(`RateioNota`, `udmNF.pas:4920-4940`) e digitação (`uItensNF.pas:3074`, `:4169`); DESPEXTRA (`uItensNF.pas:2995`).

## Grupo G — Flags de fluxos posteriores e casos avulsos

- **USOCONSUMO** := `PRODUTOS.USO_CONSUMO` no processamento (`UpdateProdutos`, `udmNF.pas:7299`). Produção: 0/91 itens não processados; só processados.
- **SINCRONIZADO_CFOP / _ALIQ / _CST** := 'S' na tela Sincronizar (`uSincronizaCFOPNotaFiscal.pas:176`, `:234`, `:289`). Apollo: o de-para de CFOP existe
  (`nf-processamento.service.ts:~100-115`) mas não marca o flag; ALIQUOTA/CST não portados.
- **CODOPERADOR_LIB_ESTOQUENEG** := usuário que autorizou (ou o logado se a config permite) ao **reverter** com estoque negativo
  (`PermiteReverterComProdutoEstoqueNeg`, `udmNF.pas:11600-11690`, chamado em `uNF.pas:8994`). Apollo: ✅ `liberarEstoqueNegativo` (`nf-processamento.service.ts`) no processar e no reverter — com 'N' a liberação por login dos usuários da config, gravada no item.
- **IDSITUACAO_NF** — **já coberto**: `nf.aggregate.ts:340-344` (`UPDATE nf_prod SET idsituacao_nf = n.idsituacao_nf … IS NULL`), espelho de `uItensNF.pas:3887`,
  `uNF.pas:13700/16043`. Falso positivo do conferidor (não está em `colunas`).
- **ESPECIFICACAO** — falso positivo (ver §0).
- **VRFRETE** — em 2020 é `fkInternalCalc` (`udmNF.dfm:4827-4830`) = `GetPorcentagem(TOTALPRODS, FRETE)` (`udmNF.pas:4141`); persistido pelo binário novo (59.133 não-nulos, 267 ≠0).
- **VRCFOP_ABATIDO**, **IND_DEDUZ_DESON**, **IDPISCOFINS** — fora do fonte de 2020 (binário novo).
- **ORIGEMPRODUCAO** — INSERT direto da Produção/Mapa de carga (`uCadProducao.pas:3483-3488`, `UCadMapaDeCarga.pas:5471-5476`); lido em `uItensNF.pas:3984`. 401 linhas 'N' em 2026.
- **INFORMACOES_ADICIONAIS** — saída de devolução de compra: `'Devolucao Ref. Nota Fiscal: ' + chave` (`uNF.pas:12237-12239`); **já feito** no Apollo
  (`devolucao-compra.service.ts:303`, gravado como "extra" depois da NF criada, `:395-402`). Na entrada: 0 linhas.

## Cortes propostos (menor risco primeiro)

0. **Higiene do conferidor** (zero código de negócio): tirar ESPECIFICACAO (join), IDSITUACAO_NF (aposGravarTrx), IND_DEDUZ_DESON (DEFAULT), INFORMACOES_ADICIONAIS (extra da devolução).
1. **Zeros/constantes do NewRecord** — `nf-item-padrao.ts` / `aposGravarTrx`: `coalesce(col, 0)` nos numéricos do grupo F e C/D (o que o ZeroToFields faz),
   ITEM_PERDA_TOTAL 'N', ATUALIZA_MULTIPRECO_DECOMP 'S', BENEFICIO 2. Sem dependência; risco ≈ 0 (leitores já usam COALESCE). Usar o padrão "só preenche o que falta"
   (como o idsituacao_nf) para não pisar valor preservado.
2. **Valores da nota (XML)** — estender `nfe-xml.parser.ts` (vFrete/vSeg/vOutro por item, pRedBC, pICMSST, pRedBCST, FCP-ST/RET, vICMSDeson, impostoDevol) e gravar no
   `recebimento.service.ts` os *_NOTA, CFOP_ORIGINAL, VRBASE_STEXTERNO, MVA_AJUSTADO (e rever o `mva: pMVAST`), FCP_*, VRICMS_DESONERADO, IPI_DEVOLUCAO*, CST_NOTA,
   VRCUSTOREAL/VL_UNITARIO. Gravar como "extras" (padrão da devolução) ou incluir em `colunas` com o formulário repassando. Destrava a devolução de compra e a conferência.
   Dependência: só o parser. Risco baixo (valores verbatim; smoke com XML real).
3. **Retrato do produto** — ULTCUSTO/ULTCUSTOREP/ULTVENDA/MARKUP (+VRCUSTOREAL fora de XML, IDPISCOFINS) no insert do item, de MULTI_PRECO/PRODUTOS.
   Dependência: nenhuma. Risco baixo. Alimenta a Precificação NF.
4. **Métricas de precificação do item** — CUSTO_REAL_UNIT, VRCUSTOREP, VRCUSTOCSI, PMZ, VRVENDASUG, VRAJCUSTODEC47530, escada do MargemL, VRBASECALCULOICM_CALC,
   VRICM_CALC, VL_UNITARIO final; herdar do pedido de compra quando vier dele. Reusar `PrecificacaoCustoService` com um modo "item da NF" (base REAL, PMZ do diálogo,
   bonificação, DESPFEDERATIVAS/FRETE2/DESPEXTRA/47.530). Dependências: cortes 2-3 (componentes e MARKUP), config TIPO_PRECIFICACAO. Risco médio (arredondamento
   — conferir contra a produção item a item). Pré-requisito do porte do `UpdateProdutos`.
5. **Indexador/repasse** — INDEXADORTRIB (resolverFigura devolvendo o código, desempate sequencial com CNPJ), MVA_AJUSTADO, VRICMS_STEXTERNO (calcularIcmsSt − ST da nota,
   tolerância ±0,02), REPASSADO + trava do processamento + esteira pelo REPASSADO. Dependências: corte 2 (base/ST da nota), cadastro de indexador. Risco médio-alto
   (bloqueia processamento nas empresas 2/51/52 — ligar com o dado).
6. **Fluxos posteriores** — USOCONSUMO no processar; SINCRONIZADO_* na sincronização (+ ALIQ/CST); CODOPERADOR_LIB_ESTOQUENEG quando o override de negativo for portado.
7. **Decomposição na entrada** — épico próprio (explode o item, rateio de custo/perda, lotes, indexador e margem por filho; flag DECOMPOSICAO do binário novo='N').
   Dependências: 4 e 5. Risco alto.

## Status (25/09/2026)

| corte | status | onde |
|---|---|---|
| 0 higiene do conferidor | ✅ | `conferir-campos-da-log.py`: `COBERTAS` (ESPECIFICACAO, IDSITUACAO_NF, INFORMACOES_ADICIONAIS), coluna com DEFAULT de migration conta como gravada na inclusão, FK conta como gerenciada — 327 → ~200 campos |
| 1 zeros/constantes do NewRecord | ✅ | mig 351: DEFAULT 0 nas 72 colunas numéricas não gerenciadas que o NewRecord nunca deixa NULL (perfil nulo×zero de 2026: 59.099/60.717 de entrada e 8.475/8.568 de saída; os 1.618 de entrada restantes são importações sem o NewRecord — sem LOG "Inseriu" — e ficam NULL); constantes ITEM_PERDA_TOTAL N, ATUALIZA_MULTIPRECO_DECOMP S, DESTACICMSSN N (binário novo), BENEFICIO 2, DECOMPOSICAO N, ORIGEM_ESTOQUE E. Smoke §235.1 |
| 2 valores da nota (XML) | ✅ | `nfe-item-importacao.ts` + `recebimento.service.ts`: o item como o ImportaNFe o monta — FATOREMBAL (FATORCX/FATORKG do produto e o fator do MANIFESTO, NFE_NAO_CADASTRADAS_ITENS: o Apollo gravava 1 e metade dos itens de 2026 são caixa), CODPRODNOTA = código de barras do produto (99,8%), UNIDADE do XML, PIS/COFINS do cadastro, ICMS = ICM efetivo da DET_ALIQUOTA (99,9%), ICME, BCR, IPI/FRETE/SEGURO em %, DEPSACESS, NCM/CEST pela config, remessa para depósito; os valores da nota como extras no item (TOTAL_PRODUTO_NOTA, QTD_NOTA, CFOP_ORIGINAL, *_NOTA, MVA_AJUSTADO = pMVAST — o Apollo punha no MVA —, VRBASE_STEXTERNO, FCP-ST/retido, desonerado, crédito SN, IPI devolvido); NF_IMPORTACAO_NFE='S' no cabeçalho (o motor o descartava); VL_UNITARIO = VRCUSTO/FATOREMBAL em toda gravação (99,98%). Smoke §236 |
| 3 retrato do produto | ✅ | `retratoDoProduto` (nf.aggregate.ts): ULTCUSTO/ULTCUSTOREP/ULTVENDA/MARKUP/VRCUSTOREAL/IDPISCOFINS na inclusão de entrada e na edição pelo diálogo (qualquer tipo); a inclusão de saída não tira. Smoke §235.2 |
| 4 métricas de precificação | ✅ | `nf-custo-item.ts`: porta de CalcValorNota (entrada) + CalcValorCusto + MargemL, conferida contra 13.103 itens da produção (custo real 99,2%, CSI 98,1%, PMZ 98,8%, créditos 100%; teste-ouro `nf-custo-item.spec.ts` com 60 itens reais). Gravada no item novo ou editado no diálogo (CUSTO_REAL_UNIT 0 = pendente) e na importação depois dos valores da nota; VRBASECALCULOICM_CALC/VRICM_CALC em toda gravação. Smoke §242. Diferença conhecida: itens com frete rateado depois da análise (63 de 13.103) — o legado guarda o custo de antes do rateio |
| 5 indexador/repasse | ⏳ | — |
| 6 fluxos posteriores | ✅ | SINCRONIZADO_CFOP/ALIQ/CST (smoke §237); USOCONSUMO no processar (§241); **CODOPERADOR_LIB_ESTOQUENEG** — `liberarEstoqueNegativo` (PermiteReverterComProdutoEstoqueNeg: saldo atual na entrada, saldo − qtde na saída, depósito com ORIGEM 'D'; 'S' grava quem processou — 19% dos itens de entrada de 2026 —, 'N' exige login dos autorizados da config; no processar e no reverter, não no cancelar) — smoke §255 |
| 7 decomposição na entrada | ⏳ | — |

### Achados para os próximos cortes (25/09/2026)

- **SPED — CST_ICMS**: o Apollo monta `origem_estoque[0] + CST(2)`; no legado ORIGEM_ESTOQUE é 'E' em 100% dos itens (seria "E60") e
  o SPED do legado usa `FormatFloat('000', NF_PROD.CST)` (Uspedfiscal.pas:2789) — no de PIS/COFINS, `GetCstIcms(CST, SN)`
  (UspedPisCofins.pas:958). Corrigir o SPED antes de o import passar a gravar 'E' no ORIGEM_ESTOQUE (hoje grava a origem do produto).
- ✅ **Cabeçalho da NF importada** (NFe.pas:3150-3450): FINALIDADE, DTHORASAIDA, INDICADOR_PRESENCA, VERSAOXML, VALIDATOTALNF = vNF,
  os totais da nota, IMP_MANIFESTO 'S'/IMP_IMPORTADORMASSA 'N', RATEIO×3 'N', TIPOFRETE, volumes, NF avulsa do fisco, o pedido da análise
  do manifesto (GetMaiorPedidoCompraPelaChaveNFe), o destinatário (outra loja/nenhuma → recusa), o fornecedor sem FRN marcado (o Apollo
  recusava) com CODPARCEIRO_END, e a transportadora (TRA 'S'; sem cadastro → recusa com os dados). E o **TOTALNF do legado**
  (`nf-total.ts`: + FCP-ST + serviço + outros + desconto final − desonerado; complementar = IPI + ST) — 98,7% das notas de 2026 (a conta
  antiga, 93%). Smoke §238. ✅ A web abre o cadastro com os dados da recusa (`ImportarXmlModal`); o fornecedor traz o IDCIDADE do `cMun`, a transportadora pelo município + UF (28/09).
- **CSOSN/CST/CSTPISCOFINS do item importado**: o legado deixa CSOSN e CSTPISCOFINS NULL na entrada (99,9% / 100%) e o CST final
  sai da análise do item (indexador — corte 5); o Apollo grava os do XML, e o SPED de PIS/COFINS depende do CSTPISCOFINS.

### Cabeçalho da NF — NewRecord e total de conferência (25/09/2026)

- ✅ mig 352: DEFAULT 0 nas 40 colunas numéricas do cabeçalho que o `ZeroToFields(cdsNota)` nunca deixa NULL (6.447/6.521 de entrada e
  754/771 de saída em 2026; as 74 de entrada restantes são da importação em massa) e as constantes do `cdsNotaNewRecord` (STEXTERNO N,
  SEQUENCIA_NFE S, RATEIO_IPI/RATEIO_IPI_DEVOLUCAO/RATEIO_ST N, TPEMISSAO 1, COMPLEMENTO N, VERSAOXML 400) + NOTA_NEUTRA e ABATER_ICMS_DESON
  N (binário novo). VALIDATOTALNF da SAÍDA = total da nota (uNF.pas:4688). Smoke §239.
- ⏳ **"Total NF" da ENTRADA** (edtValidaNF → VALIDATOTALNF): campo obrigatório no gravar da entrada ("É necessário informar o campo total
  NF, para dar continuidade!", uNF.pas:4647) e a conferência `CompareTotals` com a tolerância EMPRESAS.TOLERANCIANF — a tela do Apollo não
  tem o campo (a importação já grava o vNF).
