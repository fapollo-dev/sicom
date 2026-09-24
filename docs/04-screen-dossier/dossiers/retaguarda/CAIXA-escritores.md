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
| BAIXA CARTAO | 1.722 | R$ −85.411,37 | `UbaixaCartao.pas:1158/1188`, `UConciliadorCartao.pas:394` | FALTA |
| NF | 1.011 | R$ 764.054,09 | `udmNF.pas:9283` | ✅ C4 (`nf-caixa.ts`) |
| ARECEBER | 441 | R$ 687.687,98 | `uCadAReceber.pas:1075/1110` | ✅ 24/09 (`areceber-caixa.ts`: uma linha por documento — o título, ou o total das parcelas geradas juntas; edição relança; exclusão apaga) |
| manual (sem origem, 'S') | 166 | R$ −41.936,86 | `uMovCaixa` (FRMMOVCAIXA, 5.022 acessos) | FALTA — o `caixa_mov` do Apollo é outro modelo |
| BAIXA APAGAR | 112 | R$ 7.377,98 | `UBaixaApagar.pas:505` | FALTA |
| BAIXA ARECEBER | 33 | R$ −349,54 | `UBaixaAreceber.pas:1264` | FALTA |
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
