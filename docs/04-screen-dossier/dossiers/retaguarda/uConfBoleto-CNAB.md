# CNAB de COBRANÇA (boleto + remessa) — `uConfBoleto` / `FRMCONFBOLETO`

Dossiê de **recon** (2026-08-18). Nenhuma linha de código migrada ainda: este documento é a base do corte-1.
Tudo aqui foi verificado no fonte Delphi (`/Library/SicomGit/retaguarda-master/fonte/Units`) e no Oracle de
homologação (`pinheirao`, **READ-ONLY**). Onde há número, há query.

## 1. O que a tela faz

Emite boletos dos títulos **A RECEBER** e gera o **arquivo de remessa CNAB** para o banco (e o de
cancelamento/alteração de vencimento). O cabeçalho do próprio fonte descreve o fluxo: selecionar títulos →
"Boleto" emite → o arquivo de remessa é gravado em `SICOM/Remessa/Boleto_Remessa_(banco)`.

Ações do enum `TAction` (`uConfBoleto.pas:58`): `taEmitirBoleto`, `taCancelarBoleto`, `taImprimirBoleto`,
`taReimprimirBoleto`, **`taGerarRemessa`**, **`taGerarRemessaAlteracaoVencimento`**.

O boleto e o arquivo são produzidos pela biblioteca **ACBrBoleto** (`ACBrBoleto1: TACBrBoleto`,
`ACBrBoletoFCFR1`), ou seja: o *layout* é da lib, mas **a regra de quem entra, com que número, valor,
vencimento, instruções e onde isso é gravado é do cliente** — é essa parte que se migra, com o layout
reconstruído a partir do golden (§4).

## 2. Estado no Oracle (liveness)

| Tabela | Linhas | Janela | Papel |
|---|---:|---|---|
| `ARQUIVO_REMESSA_ARECEBER` | 306 | 2022-02-23 → **2025-03-10** | 1 linha por arquivo gerado; **`ARQUIVO` é CLOB em BASE64** |
| `REF_REMESSA_ARECEBER` | 5.142 | — | títulos de cada remessa (`COD_REMESSA_ARECEBER` × `CODRCB`) |
| `REMESSAS_BOLETOS` | 457 | 2020-09-17 → 2025-03-10 | log da remessa por banco/conta (`TIPOREMESSA` `'E'`=envio 456, `'AV'`=alteração de vencimento 1) |
| `REMESSAS_BOLETOS_CONTAS` | 7.459 | — | títulos por remessa (a geração anterior) |
| `CONF_INTEG_BANCARIA` | 4 | — | a configuração por conta/banco (§3) |
| `EMPRESA_REMESSA` | 4 | — | `DESABILITA_REMESSA` por terminal |

Bancos usados (`REMESSAS_BOLETOS`): **Itaú 341 = 386 remessas (84%)**, Banco do Brasil 001 = 55, Santander 33 = 15.

`APAGAR.REMESSA_GERADA='S'` = **18 títulos em 3 lotes** ⇒ o CNAB de **pagamento** (`ufrmProcessaAPagar.pas`,
`VTASCNAB`) é resíduo; `uCNAB_240_Pagar.pas` e `uCNAB_240_Pagar_Itau.pas` são **stubs vazios** (classe sem
membros). **`REMESSA_LOTE` (4.003) NÃO é CNAB** — é a replicação do PDV (`HISTORICO_PDV` 1.483, `NFC` 872,
`CX_VENDAS` 718, `VENDAS` 356, `CARTAO` 290, `CAIXA_PDV` 109). `RETORNO_BOAVISTA` / `RETORNO_PAG_BOAVISTA`
também não são CNAB bancário: são **conciliação de cartão** (épico já migrado).

Colunas do título que a tela carimba (`ARECEBER`): `REGISTRO_ARQ_REMESSA`, `NOME_ARQ_REMESSA`,
`LOGIN_ARQ_REMESSA`, `DATA_ARQ_REMESSA`, `STATUS_BOLETO`, `NOSSO_NUMERO_BOLETO`, `DESCONTO_BOLETO`,
`DESCONTO_BOLETO_TIPO`, `REMESSA`.

## 3. `CONF_INTEG_BANCARIA` — as 4 configurações reais

20 colunas; o que decide o comportamento: `CODBCO` (banco interno) · `CODFORNBCO` (código FEBRABAN) ·
`AGENCIA` · `NRCONTA` · **`LAYOUTREMESSA`** · `TIPO_INTEG_BANCARIA` · `IDENTEMPRESABCO` (convênio) ·
**`SEQUENCIAREMESSA`** (o sequencial do arquivo) · `NOSSO_NUMERO_INICIAL` · `INICIAIS_ARQUIVO` ·
`OBS_BOLETO` · `DIAS_BAIXA_BOLETO` · `ARQTESTE` · `HABILITAR_BOLECODE`.

| codconf | empresa | banco | agência | conta | FEBRABAN | layout | seq |
|---:|---:|---:|---|---|---|---|---:|
| 2 | 1 | 526 | 3034 | 35194-4 | 341 | **C400** | 0 |
| 21 | 50 | 526 | 3034 | 23055-1 | 341 | **C400** | 5 |
| 81 | 50 | 621 | 2591-7 | 59052-5 | 001 | **C400** | 1 |
| 102 | 1 | 660 | 3167 | 130045239 | 0542455 | **C240** | 0 |

`ARQTESTE='N'` nas quatro (nenhuma em homologação bancária).

## 4. O layout, validado contra os 306 arquivos reais

O CLOB `ARQUIVO` está **em Base64**; decodificado dá o arquivo exato que foi ao banco — é o golden.
Varredura completa (306/306 decodificados, 0 falhas, 3.787 registros de título):

- linhas de **400 chars: 7.055** · linhas de **240 chars: 124**
- tipos de registro: `0` (header) 415 · `1` 3.787 · `9` (trailer) 291 · **`7` 1.343 + `5` 1.343**
  ⇒ três layouts convivem: **Itaú 400 (detalhe `1`)**, **BB 400 (detalhe `7` + complemento `5`)** e um **CNAB 240**
- extensões: `.TXT` 236 · `.REM` 70
- nos 3.787 detalhes Itaú: carteira **109** (3.785; 2 em branco), ocorrência **01 = remessa** (3.784; `06`×1, `71`×2),
  banco cobrador **341** (100%), espécie **01 = duplicata mercantil** (100%), aceite **N** (100%)

### 4.1 Itaú CNAB 400 — posições confirmadas byte a byte

HEADER (tipo `0`): `01` + `REMESSA` + `01` + `COBRANCA` (12-26) + agência (27-30) + `00` + conta (33-37) +
DAC (38) + brancos + nome do cedente 30 (47-76) + `341` (77-79) + `BANCO ITAU SA` (80-94) +
data de gravação `DDMMAA` (95-100) + brancos + sequencial `000001` (395-400).

DETALHE (tipo `1`):

| campo | pos | golden |
|---|---|---|
| registro | 1 | `1` |
| tipo de inscrição / CNPJ do cedente | 2-3 / 4-17 | `02` + 14 dígitos |
| agência / `00` / conta / DAC | 18-21 / 22-23 / 24-28 / 29 | `3034` `00` `23055` `1` |
| instrução de alegação | 34-37 | `0000` |
| uso da empresa (25) | 38-62 | brancos |
| **nosso número (8)** | 63-70 | `00065706` |
| quantidade de moeda (13) | 71-83 | zeros |
| **carteira (3)** | 84-86 | `109` |
| uso do banco (21) | 87-107 | brancos |
| código da carteira | 108 | `I` (escritural) |
| **código de ocorrência** | 109-110 | `01` (remessa) |
| seu número (10) | 111-120 | ` - 001/001` |
| **vencimento `DDMMAA`** | 121-126 | `100325` |
| **valor (13, centavos)** | 127-139 | `0000000160348` = 1.603,48 |
| banco cobrador / agência cobradora | 140-142 / 143-147 | `341` / `00000` |
| espécie / aceite / emissão | 148-149 / 150 / 151-156 | `01` / `N` / `100225` |
| instrução 1 / 2 | 157-158 / 159-160 | `00` `00` |
| mora ao dia / data-limite de desconto / valor do desconto | 161-173 / 174-179 / 180-192 | zeros |
| IOF / abatimento | 193-205 / 206-218 | zeros |
| tipo de inscrição e documento do sacado | 219-220 / 221-234 | `02` + 14 |
| nome do sacado (30) | 235-264 | — |
| sequencial | 395-400 | `000003` |

TRAILER (tipo `9`): `9` + brancos + sequencial (395-400) = total de registros do arquivo.

## 5. Cortes propostos

- **corte-1 — Itaú CNAB 400, envio (`TIPOREMESSA='E'`)**: `conf_integ_bancaria` (cadastro + sequencial),
  seleção dos títulos elegíveis, **nosso número** (sequencial da config + DAC), montagem header/detalhe/trailer
  nas posições da §4.1, persistência (`arquivo_remessa_areceber` com o texto — **sem** o Base64 do legado, que é
  artefato do CLOB — + `ref_remessa_areceber` + `remessas_boletos`) e o carimbo no título
  (`registro_arq_remessa`/`nome_arq_remessa`/`data_arq_remessa`/`login_arq_remessa`/`nosso_numero_boleto`).
  Validador estrutural próprio (400 chars por linha, tipos 0/1/9, sequencial contínuo, trailer = contagem,
  soma dos valores) — o mesmo padrão do validador do SPED, que já pegou reject de PVA.
- **corte-2 — Banco do Brasil 400** (detalhe `7` + complemento `5`) e **CNAB 240** (a 4ª config).
- **corte-3 — retorno** (baixa automática): o legado processa em `UdmBaixaApagar` + `uPreviaRetorno`
  (prévia antes de importar). Precisa de um arquivo de retorno real como golden — **não há tabela de retorno de
  cobrança no Oracle**, então é recon próprio.
- **fora**: CNAB de pagamento (`ufrmProcessaAPagar` + `VTASCNAB`) — 18 títulos/3 lotes, e as units
  `uCNAB_240_Pagar*` são stubs vazios. Registrar como resíduo, não migrar sem pedido.

## 6. Riscos e decisões já resolvidas pelo dado

1. **O sequencial do arquivo é de estado** (`CONF_INTEG_BANCARIA.SEQUENCIAREMESSA`): gerar remessa **incrementa**
   a config — precisa de lock na transação (o mesmo padrão dos numeradores já migrados).
2. **Nosso número tem DAC** (módulo 10 sobre agência+conta+carteira+nosso número, no Itaú) — regra pública,
   verificável contra os 3.787 títulos do golden: é o teste de aceitação do corte-1.
3. **Base64 no CLOB é artefato do legado** (o ACBr grava o arquivo e o app o encoda p/ guardar): guardar texto
   puro no novo e declarar a divergência — o cutover decodifica na carga.
4. Carteira/espécie/aceite/banco cobrador são **constantes no golden** (109/01/N/341): entram como default da
   config, não como campo de tela.
