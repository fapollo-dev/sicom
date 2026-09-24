# A CAIXA GERENCIAL — quem escreve nela (épico transversal)

| | |
|---|---|
| **Status** | RECON (24/09/2026). O Apollo escreve na CAIXA só pela NF (`nf-caixa.ts`, C4 da situação) e pela conciliação OFX. |
| **Por que importa** | a CAIXA é o livro gerencial que a DRE de caixa, o fluxo de caixa e a DME leem (`rel-caixa-dre`, `rel-caixa`, `caixa-dme`). Sem os escritores, depois da virada esses relatórios perdem as despesas e as baixas. |

## 1. As origens na produção (CAIXA de 2026)

| origem | linhas | Σ valor | escritor no legado | Apollo |
|---|---:|---:|---|---|
| FECHAMENTO | 13.939 | R$ 19.951.875,03 | `UfinalizaFechamento.pas:1753` (efetivar do fechamento de caixa) | ✅ 24/09 corte 2 do fechamento (`fechamento-caixa.service.ts` `efetivar`: a linha por operação com REAL > 0 e a da quebra); a reabertura (corte 3) apaga |
| APAGAR (sistema) | 8.297 | R$ −25.132.770,34 | **binário novo**: o GRAVAR da tela de Contas a Pagar (também no faturamento da NF) refaz a CAIXA do grupo inteiro a partir do CX_APAGAR (§2) | ✅ 24/09 (`apagar-caixa.ts`, mig 327: faturamento da NF, título digitado, edição, exclusão e estorno) |
| APAGAR (manual 'S') | 462 | R$ −523.445,84 | ⚠️ correção: é o **lançamento de caixa** (`uMovCaixa`, F06) — a despesa gera um título já quitado (APAGAR + CX_APAGAR + APAGAR_BX), a CAIXA é o registro primário | ✅ 24/09 — conversão do F06 (`uMovCaixa.md`, `lancamento-caixa.service.ts`) |
| SCRAP | 4.880 | R$ −7.296.171,67 | `uCadSCRAP.pas:736` | ✅ 24/09 (`scrap-caixa.ts`: a diferença a cada gravação, com a linha de 0,00 do legado; a exclusão leva junto) |
| BAIXA CARTAO | 1.722 | R$ −85.411,37 | `UbaixaCartao.pas:1158/1188`, `UConciliadorCartao.pas:394` | ✅ a TAXA (24/09, `cartao-baixa.service.ts`: uma linha por lote no CC da taxa ou no de multa/juros; o estorno apaga). ✅ OUTRAS DESPESAS (24/09: o valor digitado sai do crédito, rateado pelos cartões — sobra no maior; a linha vai antes da taxa, no CC de descontos concedidos; 363 dos 1.362 lotes de 2026; o ajuste do rateio do legado tem o sinal trocado, não copiado). ⚠️ correção: o conciliador de cartão (`UConciliadorCartao.LancaCaixa`, ORIGEM 'CONCILIADOR CARTAO') **nunca escreveu** — 0 linhas em toda a CAIXA (2020-2026, medido em 24/09): morto, com prova |
| NF | 1.011 | R$ 764.054,09 | `udmNF.pas:9283` | ✅ C4 (`nf-caixa.ts`) |
| ARECEBER | 441 | R$ 687.687,98 | `uCadAReceber.pas:1075/1110` | ✅ 24/09 (`areceber-caixa.ts`: uma linha por documento — o título, ou o total das parcelas geradas juntas; edição relança; exclusão apaga) |
| manual (sem origem, 'S') | 166 | R$ −41.936,86 | ⚠️ correção: é a **conciliação OFX** ("Gerado pela conciliação bancária.", `CONFIG_LANCAMENTO_AUTO_OFX`) | ✅ já no Apollo (`conciliacao-bancaria.service.ts`, mig 298) |
| BAIXA APAGAR | 112 | R$ 7.377,98 | `UBaixaApagar.pas:505` | ✅ 24/09 (`baixa-caixa.ts`: juros/acréscimo/desconto no CC da baixa ou no padrão da empresa, lote `seq_idlote`; o estorno apaga) |
| BAIXA ARECEBER | 33 | R$ −349,54 | `UBaixaAreceber.pas:1264` | ✅ 24/09 (idem) |
| CONVENIO PARCEIRO | 1 | R$ −20.051,06 | `uConvenioParceiro.pas:136`, aberto só pelo agrupamento de contas a receber (`uAgrupaContasAReceber.pas:223`: o adiantamento de parceiro com o mesmo CNPJ vira A PAGAR + esta CAIXA) | FALTA — vai com o fluxo convênio do agrupamento (adiado em `areceber-agrupamento.service.ts`); 32 linhas desde 2020, 1 em 2026 |

Outros escritores no fonte sem linha em 2026: `UbaixaCheque.pas:352`, `UCadMapaDeCarga.pas:6036`,
`uCadAcordoComercial.pas:967`, `uCadClientes.pas:3964`. ⚠️ correção: a trigger `CAIXA_APAGAR` (BEFORE DELETE em CX_APAGAR) APAGA a CAIXA do rateio (`WHERE CODGRUPO AND CODCXAPAGAR`); até 02/2022 ela também inseria (9.111 linhas 'TRIGGER CAIXA_PAGAR').

## 2. APAGAR — a regra (reconstruída pelo dado em 24/09/2026; VALOR e OBS batem em 8.283 de 8.304 linhas de 2026)

- **O RATEIO (CX_APAGAR) é por GRUPO (APAGAR.CODGRUPO) × CC**, pendurado no 1º título do grupo (menor CODAPG) com o valor
  TOTAL (ΣV = Σ títulos em 6.395 de 6.396 grupos). Faturamento da NF: uma linha por CODCONTABILNF com CC e não adicional
  (TIPO = TIPOVALOR ou 'V'; 2.705 de 2.708 na criação). Título digitado: o CC da tela, com a situação do título.
  Previsão do manifesto: `CC_GERACAO_PREVISAO_APAGAR_MANIFESTO`/`SITUACAO_…`. Retenção de ICMS-ST: `CENTROCUSTO_RET_ICMSST`.
  Linhas D (desconto) e E (embutidos) só com `LANCAR_CENTROCUSTO_DESCACREJRS_CONTAS_PAGAR`.
- **A CAIXA é refeita pelo GRAVAR da tela** (o faturamento passa por ela): apaga as linhas do grupo e lança, por título ×
  CC, −round(valor × CC/Σrateio, 2); no último título o último CC fecha: −(base + ΣE − ΣD) − o já lançado nele (no
  agrupamento, base = −(Σ demais)). DATA = DTCOMPRA, DTVENC, CODPLC = o CC, CODNF, TIPORECURSO = TIPODOC, NRPARCELA,
  OPERADOR = quem grava, ORIGEM 'APAGAR', IDORIGEM = o título, CODCXAPAGAR; OBS = a do título sem CR + " , 9,86% do
  Documento nº <título>". Quem é criado por rotina (previsão, retenção) só ganha CAIXA quando alguém grava na tela
  (259 em 2026).
- **Apagar o rateio leva a CAIXA** (trigger `CAIXA_APAGAR` do Oracle, BEFORE DELETE em CX_APAGAR); a exclusão do título e a
  reversão do financeiro da NF apagam o rateio do grupo. A baixa não toca nem o rateio nem a CAIXA do título.
- **Entregue (mig 327):** o faturamento da NF (grupo, OBS " REFERENTE A NOTA FISCAL … EMITIDA EM …", parcela "i/N", rateio
  do CODCONTABILNF, CAIXA), o rateio da retenção ST (sem CAIXA), o título digitado (rateio pelo CC, CAIXA; editar refaz;
  excluir apaga) e o estorno. ⚠️ A mig 327 também sincroniza `apagar.dtcompra` (o do legado, carregado) com `dtvenda` (o
  que a tela do Apollo lia): o título migrado aparecia sem data de emissão. ✅ **Linhas D/E** (24/09, `uCadAPagar.md` §4: desconto e
  embutidos da tela viram as linhas D/E com `LANCAR_CENTROCUSTO_DESCACREJRS_CONTAS_PAGAR`). **Falta:** a previsão do manifesto.

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
