# APURAÇÃO DE ICMS / REGISTROS DE ENTRADAS E SAÍDAS — `uRelRegistros_ES` (+ `uDMRelRegistros_ES`)

Recon de 2026-08-19 (autônomo). Alvo eleito pela **varredura por dado** (placar `c1ab594`): a tabela com mais
volume entre as que não têm nenhuma referência no código novo e **têm fonte** no legado.

**Ausência provada no código**: `grep -rln "apuracao_icms\|APURACAO_ICMS"` em `apps/api/migrations` e
`apps/api/src` acha **uma única** ocorrência — comentários no `sped-efd-icms-ipi.service.ts`, que registram
exatamente esta lacuna: *"o legado LÊ o E110 de uma tabela pré-calculada APURACAO_ICMS (processo de …)"* e *"o port
do processo APURACAO_ICMS"* pendente. Ou seja: o SPED já **consome** a apuração; quem a **produz** nunca foi
migrado.

## 1. O que a tela faz

É o **livro de Registro de Entradas e Saídas** + a **apuração do ICMS** do período: o operador escolhe o intervalo
de datas e a empresa, e o processo varre as notas, classifica por CFOP/CST/espécie e grava três coisas — o
**detalhe por documento**, o **resumo por CFOP** e o **cabeçalho da apuração** (que é a estrutura do E110 do SPED).

## 2. As três tabelas (golden)

| tabela | linhas | papel |
|---|---:|---|
| `APURACAO_ICMS` | **41** (33 com detalhe) | o **cabeçalho** por `(DATAINI, DATAFIN, IDEMPRESA)` — é o E110 inteiro |
| `APURACAO_ICMS_DETALHES` | **1.155.893** | o detalhe **por documento**: `TIPO` E/S, `CST`, `CFOP`, `ESPECIE`, `BASE`, `VALOR_ICMS`, `ISENTAS_NAOTRIB`, `OUTRAS`, `TOTALNF`, `ICMS`, `ICMS_EFETIVO`, `CLASSFISCAL`, `CODIGO` |
| `ICMS_CFOP` | **606** (em 33 apurações) | o **resumo por CFOP**: `VRCONTABIL`, `BASECALCULO`, `IMPOSTO`, `ISENTAS`, `OUTRAS` |

Cabeçalho = E110 campo a campo: `SALDOANT`, `CREDITOENTRADA`, `OUTROSCREDITOS`, `ESTORNODEBITOS`,
`SALDOCREDORSEGUINTE`, `DEBITOSAIDA`, `OUTROSDEBITOS`, `ESTORNOCREDITOS`, `SALDODEVEDOR`, `DEDUCOES`, `ARECOLHER`.

Distribuição do detalhe: **saídas 1.141.333** linhas (18 CFOPs, 9 CSTs, 2 espécies) × **entradas 14.560** (35
CFOPs, 9 CSTs, 1 espécie) — o varejo tem muito mais documento de saída, e uma apuração grande tem ~64 mil linhas
de detalhe (a maior: código 481 com 63.867).

Apurações reais mais recentes: 2026-03/04 (com números: crédito de entrada 2.393,67 e saldo credor seguinte
2.376,87) e 2025-11/2025-05 (com `ARECOLHER` 2,55 e 1,44). A última linha (2026-06-25) está toda zerada — execução
vazia, não apuração.

## 3. Regras já identificadas no fonte (3.047 + 1.063 linhas)

- **gate por CFOP**: as três consultas do processo (`uRelRegistros_ES.pas:1330`, `:1924`, `:2099`) fazem
  `JOIN CFOP C ON C.CODCFOP = ... AND COALESCE(C.NAO_GERA_APURACAO_ICMS,'N') = 'N'` — CFOP marcado **fica fora da
  apuração**. Golden: `'S'` em **5** CFOPs, `'N'` em 8, **nulo em 382** (o COALESCE trata nulo como 'N'). A nossa
  tabela `cfop` **não tem** essa coluna.
- **reprocesso com confirmação** (`:1855-1885`): procura apuração de `(DATAINI, DATAFIN, IDEMPRESA)`; se existe,
  pergunta *"Ja existe apuração nesse período, deseja reprocessar?"* — **não** apenas recarrega a apuração gravada
  (`PopulaDadosApuracaoICMS`), **sim** apaga `ICMS_CFOP` e `APURACAO_ICMS_DETALHES` daquele código e refaz.
- **id app-side**: `CODAPURACAOICMSDETALHES = COALESCE(MAX(...),0) + 1` (`:2313`, `uDMRelRegistros_ES.pas:525`) — o
  mesmo padrão `GetID` do resto do legado (no novo: sequence).
- o cabeçalho é montado num dataset (`cdsRecolhimento*`), com uma variante **IPI** paralela (`cdsRecolhimentoIPI*`,
  zerada em `uDMRelRegistros_ES.pas:661-688`) — coerente com `APURACAO_IPI` **vazia** no golden.

### A fórmula do E110, campo a campo (lida no fonte)

Os dois totais são **campos agregados do dataset** (a definição vive no `.dfm`, `uDMRelRegistros_ES.dfm`):

```
TOTALCREDITO = SUM(SALDOANT + CREDITOENTRADA + OUTROSCREDITOS + ESTORNODEBITOS)
TOTALDEBITO  = SUM(DEBITOSAIDA + OUTROSDEBITOS + ESTORNOCREDITOS)
```

E o fechamento (`uDMRelRegistros_ES.pas:782-794`):

```
se (TOTALDEBITO − TOTALCREDITO) < 0 →  SALDOCREDORSEGUINTE = |diferença| ;  SALDODEVEDOR = 0
senão                               →  SALDODEVEDOR        = |diferença| ;  SALDOCREDORSEGUINTE = 0
ARECOLHER = SALDODEVEDOR − DEDUCOES
```

De onde vem cada parcela:

| campo | origem | procedência |
|---|---|---|
| `SALDOANT` | o **`SALDOCREDORSEGUINTE` da apuração do MÊS ANTERIOR** — busca por `DATAINI = StartOfTheMonth(dataInicial−1)`, `DATAFIN = EndOfTheMonth(dataInicial−1)` e a mesma empresa; não achou ⇒ 0 | `uRelRegistros_ES.pas:2380-2392` |
| `CREDITOENTRADA` | `TotEntrada + **TotEntradaSN**` — o total apurado das entradas **mais um total separado de Simples Nacional** (crédito de entrada de fornecedor SN) | `:2395-2396` |
| `DEBITOSAIDA` | `TotSaida` (total apurado das saídas) | `:2397` |
| `OUTROSCREDITOS`, `ESTORNODEBITOS`, `ESTORNOCREDITOS`, `DEDUCOES` | datasets próprios de **ajustes manuais** (`cdsOutrosCreditos`, `cdsEstornoDebito`, `cdsEstornoCredito`, `cdsDeducoes`), com `null → 0` | `uDMRelRegistros_ES.pas:762-778` |
| `OUTROSDEBITOS` | idem (ajuste manual) | idem |

⇒ **o encadeamento mensal é regra**: o crédito que sobra num mês entra como saldo anterior do mês seguinte, e a
busca é por **mês fechado** (início e fim do mês anterior), não pelo período arbitrário que o operador digitou.
Reprocessar um mês antigo, portanto, **não** recalcula os seguintes — fiel ao legado, e é o tipo de coisa que a
tela precisa deixar claro.

### Os totais: de onde saem `TotSaida`, `TotEntrada` e `TotEntradaSN`

O processo monta dois resumos por CFOP — `cdsCFOP` (saídas) e `cdsCFOPE` (entradas) — e depois acumula
(`uRelRegistros_ES.pas:2351-2374`):

```
TotSaida     = Σ VALOR_ICMS de todas as linhas do resumo de SAÍDAS
TotEntradaSN = Σ VALOR_ICMS das entradas com CLASSFISCAL='SN' e TIPO='E'
TotEntrada   = Σ VALOR_ICMS das demais entradas
```

⚠️ **Dois quirks do legado aqui, os dois a copiar com registro:**

1. o filtro das entradas é `if not((CFOP = 1403) and (CFOP = 1556))` — **condição impossível** (um CFOP não pode ser
   1403 **e** 1556 ao mesmo tempo), então **nunca exclui nada**. O comentário logo acima diz *"Tratativa de CFOPs
   nao geradores de credito"*, ou seja a **intenção** era excluir 1403 e 1556 (entradas com ST, que não geram
   crédito) e o `and` no lugar do `or` matou a regra. Copiar o comportamento (nada excluído) e registrar — mudar
   para `or` mudaria o imposto apurado, e isso é decisão do usuário, não minha.
2. nas saídas o comentário *"Tratativa de CFOPS nao geradores de debito"* **não tem código nenhum** embaixo: é
   comentário órfão. Nenhuma saída é excluída além do gate de CFOP da consulta.

E note que o split SN **não altera o E110**: o cabeçalho soma `TotEntrada + TotEntradaSN` de volta
(`:2395-2396`) — a separação existe para o quadro da tela, não para o imposto.

### A consulta das saídas (o recorte que define o que É documento da apuração)

`uRelRegistros_ES.pas:1915-1935`:

```sql
FROM NF N
JOIN CFOP C ON C.CODCFOP = N.CFOP AND COALESCE(C.NAO_GERA_APURACAO_ICMS,'N') = 'N'
LEFT JOIN PARCEIROS P ON P.CODPARCEIRO = N.CODPARCEIRO
LEFT JOIN PARCEIROS_END E ON N.CODPARCEIRO_END = E.CODEND
WHERE N.NRONF <> '0' AND N.NRONF IS NOT NULL
  AND ((N.STATUSNFE <> 'D') OR (N.STATUSNFE IS NULL))          -- DENEGADA fica fora
  AND (((N.MODELO = 55) AND (N.CHAVENFE IS NOT NULL)
        AND (COALESCE(N.STATUSNFE,'P') <> 'I')) OR (MODELO <> 55))  -- NFe só com chave e NÃO inutilizada
  AND N.TIPO = 'S'
  AND TRUNC(N.DTCONTABIL) BETWEEN :DI AND :DF                  -- a data é a CONTÁBIL, não a de emissão
  AND N.IDEMPRESA = :EMP
  AND PROC = 'S' AND CANCELADA = 'N'                           -- só nota PROCESSADA e não cancelada
```

Cinco filtros que são regra, não detalhe: **data contábil** (não emissão), **processada**, **não cancelada**,
**denegada fora**, e **NFe sem chave ou inutilizada fora**. A espécie é literal (`'NF'`) e o `CODIGO` é
`CODNF||'NF'` — o mesmo formato que aparece em `APURACAO_ICMS_DETALHES.CODIGO`.

### ⚠️ O que o detalhe REALMENTE é: 99,8% da saída é CUPOM, não NF

Distribuição do golden por `TIPO` × `ESPECIE` (é o que decide o desenho do corte):

| tipo | espécie | linhas | documentos | Σ `VALOR_ICMS` | Σ `BASE` |
|---|---|---:|---:|---:|---:|
| S | **NFC** | **1.139.084** | **664.318** | **443.501,98** | 3.164.520,90 |
| E | NF | 14.560 | 9.940 | 230.401,27 | 1.690.012,09 |
| S | NF | 2.249 | 1.179 | 28.604,65 | 195.066,25 |

Ou seja: a apuração de ICMS deste tenant é, **em massa, apuração de NFC-e** — o débito de saída vem dos **cupons**
(R$ 443,5 mil contra R$ 28,6 mil de NF de saída). O `CODIGO` daquelas linhas termina em `NFC` (o das notas termina
em `NF`), o que confirma as três consultas do fonte: **NF de saída, NFC-e de saída e NF de entrada**.

Consequência para o corte: **a perna NFC-e não é opcional**. Sem ela o débito de saída sai ~94% menor — a apuração
não ficaria "parcial", ficaria **errada**. E isso não conflita com a regra "nada do PDV": o dado dos cupons já está
migrado (`vendas`, 11,9 milhões de linhas) e a apuração é tela de **retaguarda fiscal** — o que fica fora do escopo
é mexer no aplicativo do PDV, não ler a venda que ele gerou.

### A trava de contingência (compliance)

Antes de apurar, `VerificaNfcContigencia` (`:1901-1907`) avisa: *"Existem NFC-e em contigência no período, estas
não entrarão na apuração. Deseja continuar?"* — e o comentário do próprio legado explica por que a pergunta
existe: *"Nao permite passagem devido a possibilidade de sonegacao, venda realizada, porem nao inclusa na apuracao
de icms"*. É um aviso com consequência fiscal, e tem de aparecer na tela nova.

## 4. Irmãs vazias (cópia-fiel-negativa, registrar e não implementar)

`APURACAO_IPI`, `APURACAO_ICMS_ST`, `APURACAO_ICMS_ST_AJUSTES`, `APURACAO_CIAP`,
`APURACAO_ESTOQUE_ESCRITURADO`, `APURACAOCEREAL` — **todas com 0 linhas**. O tenant não usa nenhuma delas; o
caminho de IPI existe no fonte (datasets paralelos) mas nunca produziu dado.

## 5. Corte proposto

- **corte-1 — o processo da apuração**: as 3 tabelas (`apuracao_icms`, `apuracao_icms_detalhes`, `icms_cfop`) +
  `cfop.nao_gera_apuracao_icms`; as **três pernas** (NF de saída, **NFC-e de saída** — a que carrega 99,8% do
  detalhe — e NF de entrada) com o gate de CFOP e os cinco filtros; o resumo por CFOP; o cabeçalho E110 com o
  encadeamento mensal; o reprocesso idempotente (apaga detalhe/resumo e refaz); o aviso de contingência; e a tela
  com os três quadros.
  **O recon está completo** (§3): fórmula do cabeçalho, os três totais, os filtros das consultas, o gate de CFOP,
  o reprocesso, os dois quirks e a trava de contingência. O que resta é build + confrontar as 33 apurações do
  golden campo a campo (inclusive o encadeamento do saldo anterior entre meses).
- **corte-2 — o elo com o SPED**: trocar a leitura do E110 (hoje o `sped-efd-icms-ipi.service` espera a apuração
  pronta) para a apuração **produzida aqui**, e conferir o registro por CFOP contra o que o SPED emite.
- **fora, registrado**: IPI e as demais irmãs vazias.
