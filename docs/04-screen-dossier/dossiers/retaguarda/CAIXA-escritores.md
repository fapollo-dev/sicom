# A CAIXA GERENCIAL — quem escreve nela (épico transversal)

| | |
|---|---|
| **Status** | RECON (24/09/2026). O Apollo escreve na CAIXA só pela NF (`nf-caixa.ts`, C4 da situação) e pela conciliação OFX. |
| **Por que importa** | a CAIXA é o livro gerencial que a DRE de caixa, o fluxo de caixa e a DME leem (`rel-caixa-dre`, `rel-caixa`, `caixa-dme`). Sem os escritores, depois da virada esses relatórios perdem as despesas e as baixas. |

## 1. As origens na produção (CAIXA de 2026)

| origem | linhas | Σ valor | escritor no legado | Apollo |
|---|---:|---:|---|---|
| FECHAMENTO | 13.939 | R$ 19.951.875,03 | `UfinalizaFechamento.pas:1753` (efetivar do fechamento de caixa) | FALTA — corte 2 do fechamento (`uFechamentoCaixa-finalizacao.md`) |
| APAGAR (sistema) | 8.297 | R$ −25.132.770,34 | **binário novo** (o texto "100,00% do Documento nº" não está no fonte de 2020); `uAPagar.pas:4961` (`GeraCaixa`) só cobre o convênio de funcionários | FALTA |
| APAGAR (manual 'S') | 462 | R$ −523.445,84 | idem (títulos digitados na tela) | FALTA |
| SCRAP | 4.880 | R$ −7.296.171,67 | `uCadSCRAP.pas:736` | ✅ 24/09 (`scrap-caixa.ts`: a diferença a cada gravação, com a linha de 0,00 do legado; a exclusão leva junto) |
| BAIXA CARTAO | 1.722 | R$ −85.411,37 | `UbaixaCartao.pas:1158/1188`, `UConciliadorCartao.pas:394` | ✅ a TAXA (24/09, `cartao-baixa.service.ts`: uma linha por lote no CC da taxa ou no de multa/juros; o estorno apaga). FALTA a 2ª linha, OUTRAS DESPESAS (363 dos 1.360 lotes de 2026) — a baixa do Apollo não tem o campo; e o conciliador de cartão |
| NF | 1.011 | R$ 764.054,09 | `udmNF.pas:9283` | ✅ C4 (`nf-caixa.ts`) |
| ARECEBER | 441 | R$ 687.687,98 | `uCadAReceber.pas:1075/1110` | ✅ 24/09 (`areceber-caixa.ts`: uma linha por documento — o título, ou o total das parcelas geradas juntas; edição relança; exclusão apaga) |
| manual (sem origem, 'S') | 166 | R$ −41.936,86 | `uMovCaixa` (FRMMOVCAIXA, 5.022 acessos) | FALTA — o `caixa_mov` do Apollo é outro modelo |
| BAIXA APAGAR | 112 | R$ 7.377,98 | `UBaixaApagar.pas:505` | ✅ 24/09 (`baixa-caixa.ts`: juros/acréscimo/desconto no CC da baixa ou no padrão da empresa, lote `seq_idlote`; o estorno apaga) |
| BAIXA ARECEBER | 33 | R$ −349,54 | `UBaixaAreceber.pas:1264` | ✅ 24/09 (idem) |
| CONVENIO PARCEIRO | 1 | R$ −20.051,06 | `uConvenioParceiro.pas:136` | FALTA |

Outros escritores no fonte sem linha em 2026: `UbaixaCheque.pas:352`, `UCadMapaDeCarga.pas:6036`,
`uCadAcordoComercial.pas:967`, `uCadClientes.pas:3964`. Nenhuma trigger do Oracle escreve na CAIXA (user_source).

## 2. APAGAR — o maior, e do binário novo

Uma linha de CAIXA por linha de rateio do título (`CX_APAGAR`): `IDORIGEM` = CODAPG, `CODCXAPAGAR` = a linha do
rateio, valor NEGATIVO, `CODPLC` = o centro de custo da linha, `CODNF`, `TIPORECURSO` = a forma (BOLETO…),
`CODGRUPO` do título, `NRPARCELA` '1/1', `DTVENC` do título, OBS "REFERENTE A NOTA FISCAL <nro> EMITIDA EM
<data>\n , 100,00% do Documento nº <codapg>". Cobertura 2026: 7.737 de 8.077 títulos vindos de NF e 462 de 651 manuais
têm CAIXA; CX_APAGAR em 6.833/8.077 e 649/651. O faturamento da NF do Apollo cria o título mas NÃO grava CX_APAGAR nem
CAIXA. **Reconstruir pelo dado** (a regra do percentual, a data, o que acontece na baixa, no estorno, na exclusão).

## 3. Ordem proposta

1. APAGAR (faturamento da NF + tela) — o rateio `CX_APAGAR` e a CAIXA por linha.
2. ✅ SCRAP (`uCadSCRAP.pas:736`) — gravar do scrap.
3. BAIXA CARTAO, ✅ ARECEBER, BAIXA APAGAR/ARECEBER.
4. O movimento de caixa gerencial (`uMovCaixa`, F06) — conversão da tela.
5. FECHAMENTO — no corte 2 do fechamento de caixa.

## 4. BAIXA APAGAR / BAIXA ARECEBER — recon (24/09/2026)

**Fonte** (`UBaixaApagar.pas:501-523`, chamadas em `:790-792`): ao gravar a baixa em lote, uma linha de CAIXA por natureza
com valor ≠ 0 — juros (`'Ref. juros pgto lote N'`, negativo, CC `EdtCodPlcJuro`), acréscimos (`'Ref. acréscimos pgto lote
N'`, negativo, CC `EdtCodPlcAcrescimo`) e descontos (`'Ref. descontos recebidos lote N'`, positivo, CC `EdtCodPlcDesconto`).
DATA e DTVENC = data da baixa, TIPORECURSO 'DINHEIRO', CODPARCEIRO 0, NRPARCELA '1', GERADO 'SISTEMA', IDLOTE, ORIGEM
'BAIXA APAGAR'. `ValidaCentroCustos` (`:1766`) soma juros (com `CALCULAJURO`), acréscimos (`ACRE_DESC > 0`) e descontos
(`ACRE_DESC < 0`) e exige o CC de cada natureza com valor. A Receber é o espelho (`UBaixaAreceber.pas:1264`):
`'Ref. acréscimos recebidos lote N'` (+) e `'Ref. descontos concedidos lote N'` (−). O CC fica também em
`APAGAR_BX.CODPLC_ACREDESC` / `CODPLC_JUROS` (e em `ARECEBER_BX`).

**Produção 2026:** 47 acréscimos (R$ −2.792,68, CC 4) e 65 descontos (R$ 10.170,66, CC 1077); nenhum juros. Acréscimo: a
linha = Σ `ACRE_DESC > 0` do lote em **47/47**. Desconto: **31/144** lotes com desconto batem — ⚠️ **defeito do legado**: a
soma percorre o dataset da GRADE de parcelas (`GrdParcelasDBTableView1.DataController.DataSource.DataSet`), que é detalhe do
fornecedor posicionado; só entram os descontos do fornecedor em foco (lote 90372: descontos 9,37 + 186 + 95 + 95, CAIXA
195,37 = os dois primeiros; 79 lotes com desconto e nenhuma linha). O certo é a soma do lote inteiro — não copiar.

**✅ Convertido (24/09, mig 323):** `baixa-caixa.ts` — os CCs vêm do painel de baixa (opcionais) ou do padrão da empresa;
sem CC para a natureza com valor, 422 com a mensagem do legado; a baixa ganha o lote do `seq_idlote` (o `ID_IDLOTE`,
que também passa a numerar a baixa de cartão — o `seq_cartao_lote` começava em 1 e repetiria lotes da carga) e grava
IDLOTE/CODPLC_ACREDESC/CODPLC_JUROS/TX_JUROS; o estorno apaga as linhas pelo texto do lote. O acréscimo não tem campo no
painel do Apollo (a API aceita).

**Era a lacuna:** a baixa (`apagar-baixa.service.ts` / `areceber-baixa.service.ts`) é por título, não gravava `IDLOTE` nem
`CODPLC_ACREDESC`/`CODPLC_JUROS`, e a tela não pede os centros de custo. Converter = a baixa pedir os CCs quando houver
juros/acréscimo/desconto (as mensagens do `ValidaCentroCustos`), gravá-los em APAGAR_BX/ARECEBER_BX e lançar as linhas;
o "lote" do Apollo é a baixa (`IDLOTE` nulo → `-codapgbx` no `cons-apg-bx`). O estorno apaga as linhas (a reversão do
legado exclui o CAIXA do lote).
