# RASTREABILIDADE DE LOTE/VALIDADE NA NF — `NF_PROD_LOTE` (grupo `rastro` da NF-e)

Último item com volume da varredura por dado (56.521 linhas). O volume enganava nas duas direções: **não é
resíduo** (é o grupo `rastro` do XML da NF-e, regra fiscal) e **não está em uso corrente** (o dado para em
fev/2024). As duas coisas ao mesmo tempo, e as duas com prova.

## 1. Por que é regra fiscal viva

| procedência | o que diz |
|---|---|
| `NFe.pas:1796-1819` | na **emissão**, cada linha vira um `rastro` do item: `nLote` = `LOTE`, **`qLote` = `QUANTIDADE` do item ÷ `QTDLOTE`** (o legado divide a quantidade igualmente entre os lotes do item), `dFab` = `DTFABRICACAO`, `dVal` = `DTVALIDADE` |
| `NFe.pas:4212-4225` | na **importação de XML** é o inverso: para cada `rastro` faz `Locate('CODNFPROD;LOTE')` → **edita se achou, insere se não** |
| `uItensNF.pas:1908-1923` | grava e limpa os lotes junto com o item da NF |
| `uNFLoteValidade.pas` | a tela dos lotes de um item (`RetornarValores('NF_PROD_LOTE','LOTE;CODNFPROD',…)`) |
| `PRODUTOS.CONTROLE_VALIDADE` | **'S' em 41.540 dos 43.116 produtos (96%)** — a operação inteira controla validade |

⚠️ **Bug do legado a NÃO copiar** (`uItensNF.pas:1916-1918`): ao montar o registro de lote em memória ele faz
`vLote.DataFabricacao := cdsNF_Prod_LoteDTVALIDADE` — grava a **validade** no campo de **fabricação**. É por isso
que 6.981 linhas têm `DTFABRICACAO` e, em parte delas, ela é igual à validade. Na importação (o caminho deste
corte) os dois campos vêm separados do XML, então o bug não se reproduz; se algum dia a emissão entrar, o campo
tem de vir de `DTFABRICACAO`.

## 2. O que o dado diz

- 56.521 linhas · 44.528 itens de NF · 7.210 produtos · 2 empresas.
- criação por ano da NF: 2020 = 9.027 · 2021 = 2.268 · 2022 = 14.250 · **2023 = 28.246** · 2024 = 2.730 · **2025/2026 = 0**.
- por mês: 2023-11 = 3.489 · 2023-12 = 2.333 · 2024-01 = 2.209 · **2024-02 = 521** · depois **nada** — a mesma
  data-marco de fev/2024 dos outros clusters do tenant, e coerente com a casa emitir quase só NFC-e (99,8% do
  detalhe de saída da apuração de ICMS).
- **sujeira que proíbe validação retroativa**: `LOTE` em branco em **38.914 das 56.521** linhas (69%), validade no
  ano 4790 em 5 linhas, e lotes como `asdasd`. A carga tem de aceitar tudo isso.

## 3. Corte-1 entregue (mig 169)

- `nf_prod_lote` `(codnfprodlote, codnfprod → nf_prod, idempresa, idproduto, lote, dtvalidade, dtfabricacao)`,
  com **índice único de expressão `(codnfprod, coalesce(lote,''))`** — é a chave do `Locate` do legado, e o
  `coalesce` existe porque lote em branco é a maioria e precisa cair em uma linha só por item.
- o **parser de XML** passou a ler o grupo `rastro` (`NfeItemParsed.rastro`), forçando array quando há uma única
  ocorrência (o bug clássico do fast-xml-parser, que o parser já tratava para `det`/`dup`/`detPag`).
- a **importação** grava os lotes depois de persistir a NF, resolvendo `codnfprod` por `(codnf, nroitem)` e
  fazendo `INSERT … ON CONFLICT (codnfprod, coalesce(lote,'')) DO UPDATE` — o Locate→Edit/Insert do legado. É
  **best-effort**: o XML já está salvo e uma NF importada não pode cair por causa do rastro.
- smoke 53.3: um XML com três rastros no item 1 — dois do **mesmo lote** (o segundo edita o primeiro: validade
  2028-02-20 e a fabricação volta a nulo) e um de **lote em branco** — e o item 2 sem rastro, que não gera linha.

Nota de implementação: `onConflict().columns()` do Kysely só aceita nome de coluna, então o upsert com índice de
expressão foi escrito em SQL cru.

## 4. O que falta (declarado)

1. **Emissão**: quando o Apollo emitir XML de saída, o grupo `rastro` sai daqui, com `qLote = quantidade ÷ nº de
   lotes do item` (a fórmula do legado, `NFe.pas:1817`) e `dFab` do campo certo (não repetir o bug do §1).
2. **Tela dos lotes do item** (`uNFLoteValidade`): CRUD por item de NF — hoje o corte cobre só o caminho do XML.
3. **`CONTROLE_VALIDADE`/`DIAS_VALIDADE_MINIMO`/`VALIDADE` do produto**: as três colunas existem no golden e
   governam a exigência do lote na entrada; nenhuma foi ligada a validação (e não devem ser, retroativamente —
   ver a sujeira do §2). Entram junto com a tela, quando houver decisão do usuário sobre exigir lote.
