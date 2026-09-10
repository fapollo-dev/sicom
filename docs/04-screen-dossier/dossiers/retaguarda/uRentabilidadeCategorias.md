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
