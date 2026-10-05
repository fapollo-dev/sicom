# RENTABILIDADE POR CATEGORIAS (`FRMRENTABILIDADECATEGORIAS`) — recon e corte-1

`uRentabilidadeCategorias.pas` (1.217 linhas). **275 acessos.**

## 1. O que a tela é, e por que não é a Consultoria

A Consultoria (`FRMCONSULTORIAATM`, mig 207) faz **venda menos custo** e para aí. Esta desce até o **lucro
líquido**, descontando imposto, encargo de compra, despesa operacional, IR e CSLL. São perguntas diferentes:
uma diz o que vende bem, a outra o que **dá lucro**.

## 2. A fórmula (`uRentabilidadeCategorias.dfm:1706`)

```
venda líquida = venda − ICMS efetivo − PIS/COFINS de saída
custo líquido = custo − crédito de ICMS − crédito de PIS/COFINS
                      + ICMS-ST + FCP-ST + acessórias − bonificação    (por UNIDADE)
                      + frete + frete2 + seguro + IPI                  (em % sobre o custo)
lucro bruto   = venda líquida − custo líquido − despesa operacional
lucro líquido = lucro bruto − IR − CSLL
```

### As regras que não se adivinha

| regra | onde |
|---|---|
| o **ICMS efetivo é por UF** — `DET_ALIQUOTA` casa por `ALIQUOTA` **e `UF`**, e a UF é a da empresa | join do `.dfm` |
| **o Simples não paga PIS/COFINS na saída** — `CLASSFISCAL = 'SN'` zera a parcela | `:1706` |
| **o crédito de PIS/COFINS da entrada** é zerado para `'SN'`, `'ME'` **e `'LP'`** — três regimes, não um | `:1706` |
| **o crédito de ICMS só existe se o produto é tributado** — `SUBSTR(PRODUTOS.ALIQUOTA,1,1) = 'T'` | `:1706` |
| **IR e CSLL têm piso zero** — prejuízo não gera imposto negativo | `:1708-1712` |
| a **despesa operacional** é o percentual digitado; em branco, o de `EMPRESAS.DESPOPERACIONAL` | `:346-348` |

⚠️ **os encargos misturam duas formas na mesma tabela**: ICMS-ST, FCP-ST, acessórias e bonificação entram
**por unidade** (× quantidade); frete, frete2, seguro e IPI entram **em percentual** sobre o custo. Errar isso
troca centavos por milhares.

⚠️ **o legado agrega percentual com `AVG`** dentro do mesmo `GROUP BY` em que soma valor com `SUM`. Ou seja, a
alíquota de uma categoria é a **média simples** das alíquotas dos produtos vendidos nela, **não a ponderada
pelo valor**. Copiado como está: mudar isso mudaria o número que o cliente confere há anos — mas se um dia ele
questionar por que a rentabilidade de uma categoria heterogênea parece estranha, a causa é esta.

## 3. Estado

Corte-1: os três níveis (departamento, grupo, subgrupo) com a fórmula completa, o modo simplificado e o
completo (cada desconto em coluna). Nenhuma migration de schema — todas as colunas já existiam.

**Fica**: o filtro por subgrupo do fornecedor, o "considerar apenas SCRAP" (que troca a fonte de `VENDAS` para
`SCRAP`/`SCRAP_ITEM`) e o modo de consulta que soma as notas fiscais junto com as vendas.

## O relatório do legado e as três impressões (05/10/2026)

A versão anterior do Apollo agregava por "nível" (departamento/grupo/subgrupo) — um resumo que o legado não tem. O legado
(`btnConsultaClick`) é um relatório **por SUBGRUPO × produto** (`sqqRel` do DFM, 18 KB de SQL), e é ele que os três layouts
imprimem. Agora portado expressão a expressão (`rentabilidade-legado.ts`):

- **`sqqRel`**: a venda do PDV agrupada por loja × dia × produto × promoção × IAT (e, com "considerar notas", as NF de saída com os
  CFOPs de venda — o `GetSQLNf`); por produto: TOTVENDA, TOTCUSTO, VRUNIT, crédito/débito de ICMS (crédito só para tributado, o
  ICM_EFETIVO da UF da loja), crédito/débito de PIS/COFINS (SN não debita; SN/ME/LP não creditam), ST, FCP-ST, frete, frete2,
  acessórias, IPI, bonificação, seguro, ADICIONAISCUSTO, VRCUSTOREAL, VENDALIQUIDA, LUCRO, a despesa operacional (a informada ou
  `AVG(EMPRESAS.DESPOPERACIONAL)`), a PERDA (scrap "LIXO/PERDA"/"ROUBO" no período × VRCUSTO; "só importados" filtra), LUCROLIQ,
  IR/CSLL com piso zero, LUCROFINAL, MARGEMBRUTA (sobre a venda líquida) e MARGEMFINAL (sobre a venda). `ORDER BY 1, 24 DESC` =
  SUBGRUPO, **FRETE** desc (a 24ª coluna — fiel). As divisões por zero do Oracle (que derrubariam o relatório) viram nulo.
- **`sqqAux`**: o lucro líquido de cada subgrupo depois de IR/CSLL — o denominador da PARTICIPACAO.
- **`RankingFamilias`** (só o que a rentabilidade usa: o LUCROFIN por família = (venda − (custo + frete + acessórias + IPI + ST))
  − ((ICMS saída − ICMS entrada) + PIS/COFINS), sobre as colunas desnormalizadas da VENDAS), ordenado decrescente: a posição é o
  **INDICE** do subgrupo.
- **o laço**: INDICE, PARTICIPACAO (lucro líquido do produto ÷ o do subgrupo × 100) e ACUMULADO (soma dentro do subgrupo); o
  `Locate` sem achado mantém o cursor — a linha "SEM GRUPO" herda o índice e o denominador da anterior, como no legado.
- **filtros**: departamento, grupo e subgrupo pela DESCRIÇÃO (o `SetaFiltro`: igual, começa, termina, contém, diferente); o
  fornecedor **substitui** os outros (`AndWhere :=` — os subgrupos dos produtos dele); as lojas do `GetMultiEmpresa`.
- **impressões** (`RgTipo`): COMPLETO em `at&m_rentabilidade_da_familia.fr3`; SIMPLIFICADO em `…_simp.fr3` ordenado por
  `INDICE;LUCROLIQ`; TOTAIS em `…_totais.fr3` com o `CriarCDSDeTotalizacao` (a soma de cada valor, o maior % de IR e CSLL);
  `frxDBDataset2` = a loja; `DATAI`/`DATAF`. Sem dados: "Não foram encontradas informações suficientes para construir um
  relatório. Refaça a pesquisa.".
- a tela passou a mostrar a grade do legado (por produto). O endpoint antigo por nível segue (o smoke dele também).
- smoke §297 (4 checks, a conta feita à mão); teste de renderização dos três layouts.
