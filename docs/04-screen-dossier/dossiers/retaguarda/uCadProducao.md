# PRODUÇÃO (`FRMCADPRODUCAO`) — corte 1 + impressão (06/10/2026)

`uCadProducao.pas` (4.189) + `.dfm` (4.549) + `uDMProducao.pas`/`.dfm`. **109 acessos** (MENUEXPRESS). API `cadastro/producao`
(agregado + `processar`/`reverter`/`impressao`), tela `/producao`.

## 1. O uso real (produção, 06/10/2026)

- **43 produções** de 10/2020 a 10/2024 (2020: 6 · 2021: 12 · 2022: 19 · 2023: 5 · 2024: 1); 11 abertas; sempre a mesma empresa
  solicitante e produtora. O módulo está **parado** desde 10/2024 — `ITENS_PRODUCAO_TRANSFERENCIA` e `HISTORICO_PROD_PRODUCAO` terminam
  em 11/2023 e estão fora da carga com o veredito MORTA (`tools/cutover/conferir-tabelas-fora.py`), como `ESTOQUE_PROD` e os `*_HIST`.
- `RECEITA_PROD`: 86 linhas, 10 acabados.

## 2. O corte 1 (mig 122)

Documento mestre-detalhe; `processar` explode a receita (qtde × receita ÷ RECEITAFATOR), grava os insumos, baixa e entra no estoque
com kardex; `reverter` estorna pelo gravado. As simplificações e o motivo estão no cabeçalho da mig 122 e do `producao.service.ts`.

> ⚠️ **Correção de premissa (06/10/2026):** a mig 122 diz que a conversão de unidade KG/LT "no dado real é MORTA — só o acabado 301084".
> **Na produção não é:** 8 das 86 linhas da `RECEITA_PROD` de hoje têm a receita em KG/LT e o produto em outra unidade, e **13 das 43
> produções** gravaram insumos assim (137 linhas KG→UN, 6 LT→UN). Se o módulo voltar a ser usado, o `processar` do Apollo recusa essas
> receitas (`PRODUCAO_CONVERSAO_NAO_SUPORTADA`) — falha alta, não baixa errado. A conversão no processar fica para o corte 2, com a regra
> do §3 (que a impressão já usa). `FATORCXPROD` e `FATORCXPROD_UTIL` são 1 em todas as linhas.

## 3. A impressão (`ImprimirProduo1Click`) ✅

`Relatorios\Producao.fr3` (880) com:
- `frxDBDatasetProducao` = `QryRelProducao`: `P.*`, a razão social das empresas solicitante e produtora, o NOME do operador e
  STATUS_DESC (ABERTO/PROCESSADO). São JOINs — sem operador não há produção, e aí a mensagem "Produção não encontrada na base de dados
  para imprimir o relatório.";
- `frxDBDatasetItens` = `QryRelProducaoItens`: o acabado (código de barras, descrição, quantidade, unidade) e cada insumo gravado, com os
  dois campos calculados do `cdsRelProducaoItensCalcFields`:
  - **QUANTIDADE_COMERCIAL**: pelo `ProdutoConvertePeloFatorCaixaProducao(unidade do produto, unidade da receita)` — ramo-caixa:
    `ConverteQuantidadeProducaoPeloFator` (÷ `RECEITA_PROD.FATORCXPROD` da primeira receita em que o insumo aparece, quando > 1); ramo
    KG/LT: `ConverterQuantidade`, que está no `FuncoesApollo` (ausente). Reconstruído por duas provas: o ramo equivalente da própria tela
    faz `qtde ÷ FATOR_CONVERSAO` (uDMProducao.pas:676, o fator gravado no item = `RetornaFatorConversao`, o FATOR da `FATOR_CONVERSAO` com
    DE = unidade da receita) e o dado das transferências fecha com isso (`QTDE_TRANSF = QTDE_ORIGEM × FATOR`: 94 UN × 0,3 = 28,2 KG).
    Sem fator, a quantidade como está;
  - **TOTAL** = QUANTIDADE_COMERCIAL × VRCUSTO;
- `frxDBDatasetEmpresa`: a empresa do login.

⚠️ O legado grava os insumos **na digitação** (`CarregarProdutosDaReceita`); o Apollo, no processar. Na produção **aberta** a impressão
explode a receita na hora com a conta do `CarregarProdutosDaReceita` (cada linha uma vez por insumo, o serviço também, QTDE ×
FATORCXPROD_UTIL no ramo-caixa, proporcional ao RECEITAFATOR, 3 casas, custo da MULTI_PRECO). Na processada lê o gravado — que no Apollo
não tem as linhas de serviço (o processar não as grava).

**Lista de transferência** (`mniProdutosparatransferncia1Click`, `Producao_lista_transferencia.fr3`): processada, lê
`ITENS_PRODUCAO_TRANSFERENCIA`; aberta, calcula pelo `ESTOQUE_PROD` — as duas tabelas MORTAS. ⛔ fica fora com o módulo de transferência.

## 4. Cobertura

Smoke §47f (corte 1) + §47f.5b (impressão da aberta: cabeçalho, receita explodida com o serviço, o ramo-caixa, total, a mensagem) e
§47f.6c (KG → UN pelo FATOR_CONVERSAO); teste de renderização do layout 880.
