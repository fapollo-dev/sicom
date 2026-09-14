# ENTRADAS E SAÍDAS (`FRMRELENTRADASSAIDAS`) — completa

`uRelEntradasSaidas.pas` (635) + `.dfm` (3.644, quase todo layout de FastReport). **148 acessos, 20 operadores.**

## 1. Os dois relatórios

1. **Listagem** — as notas de entrada e saída do período, item a item;
2. **Comparativo** — por produto: quanto entrou, quanto saiu, custo médio, venda média, a diferença, e a
   posição de estoque ao lado (loja, depósito, e o que está a caminho).

## 2. ⚠️ O bug do desconto — R$ 178.994,93 por ano

O legado calcula o valor do item como `(QUANTIDADE × VRCUSTO) − NP.DESCONTO` (`aqqRelE`, `.dfm:896`).

**`NF_PROD.DESCONTO` é PERCENTUAL, não valor.** O dado prova de três formas (produção, 14/09/2026):

| prova | número |
|---|---|
| faixa da coluna | máximo exatamente **100**, mediana **13,36**, em 17.014 itens com desconto |
| a conta fecha | `QUANTIDADE × VRCUSTO × DESCONTO/100` bate **casa a casa** com `VRDESCPROD` |
| outra tela | o Relatório de Compras usa a mesma coluna como percentual |

Numa nota de **12.874,40** com 24,31% de desconto, o legado subtrai **24,31** em vez de **3.130,40**.

Somando as entradas de 2026 (59.929 itens): legado **19.389.175,03** contra **19.210.180,10** — **178.994,93
a mais**. Aqui usamos `VRDESCPROD`, e a listagem mostra uma coluna "Sistema antigo" com o número que o legado
daria, para a conferência lado a lado não virar chamado.

## 3. ⚠️ A nota não processada estava contada duas vezes

O `WHERE` do legado é só `TIPO = 'E' AND DTCONTABIL BETWEEN` — **não filtra `PROC` nem `CANCELADA`**.

Mas o próprio comparativo tem a coluna `VABERTO`, que soma exatamente as notas com `PROC = 'N'`. Ou seja: a
mesma mercadoria aparecia como **entrada do período** e como **"a entrar"** — e viraria entrada de novo no dia
em que a nota fosse processada.

Nota não processada **não movimentou estoque**. O movimento passou a exigir `PROC = 'S'`; o "a entrar"
continua mostrando o que está a caminho. Cada coisa contada uma vez.

## 4. A unidade do comparativo

A quantidade é `QUANTIDADE × FATOREMBAL` **nos dois lados**. A nota vem em caixa e a venda é em unidade; sem
o fator, entrada e saída não se comparam — o mesmo cuidado da Precificação de NF, aqui pelo motivo oposto.

## 5. Cobertura (§109 do smoke, 4 checks)

1. o bug do desconto, com o valor correto (800,00) e o do legado (980,00) lado a lado;
2. o comparativo: médias, diferença de quantidade e de valor;
3. a nota não processada fora do movimento e dentro do "a entrar";
4. data invertida recusada, e a cancelada fora dos dois relatórios.

## 6. O que ficou de fora

**Resolvido de outro jeito:** os relatórios `.fr3` — a grade imprime em paisagem e exporta em CSV.

**Ainda falta:** os rádios **Custo** (médio × reposição) e **Venda** (média × valor atual), que trocam a base
das colunas de média do comparativo; hoje usamos sempre o realizado do período.
