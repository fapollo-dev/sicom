# ANÁLISE DE COMPRA × VENDA (`FRMRELENTSAI`) — completa

`uRelEntSai.pas` (586) + `.dfm` (1.440) + `udmRelEntSai` + `URelEntSaiGrid`. **84 acessos, 10 operadores.**

## 1. O que a tela responde

Por **produto**: quanto entrou pela nota e quanto saiu pela venda, em quantidade e em dinheiro, lado a lado.
Diferença positiva quer dizer que vendeu mais do que comprou no período — saiu da prateleira.

Não confundir com **Entradas e Saídas** (`FRMRELENTRADASSAIDAS`, `uRelEntradasSaidas.md`): aquela lista notas
e compara totais; esta cruza a **venda do PDV** com a **compra por nota**, produto a produto.

## 2. As duas pernas na mesma unidade

**Saídas** — `vendas`, com a venda líquida de sempre: truncamento por `IAT` ('A' arredonda, o resto trunca),
mais acréscimos, menos descontos (promoção, departamento e os acréscimos negativos).

**Entradas** — `nf_prod` das notas de entrada processadas, com **`QUANTIDADE × FATOREMBAL`**. A nota vem em
caixa e a venda é em unidade: sem o fator, 10 caixas de 12 apareceriam como 10 contra 90 vendidas, e a
comparação não faria sentido.

## 3. ⚠️ A mesma coluna, três telas, dois entendimentos

O custo de entrada aqui é `VRCUSTO − VRCUSTO × DESCONTO/100` — `NF_PROD.DESCONTO` tratado como
**percentual**, que é o que ele é (máximo exatamente 100, mediana 13,36, e a conta fecha com `VRDESCPROD`).

| tela | trata `DESCONTO` como | |
|---|---|---|
| Análise compra × venda (esta) | percentual | ✅ |
| Relatório de compras (`uRelCompras.md`) | percentual | ✅ |
| Entradas e saídas (`uRelEntradasSaidas.md`) | **valor** | ❌ **R$ 178.994,93/ano** |

Registrado aqui porque quem for conferir os três relatórios vai encontrar a divergência — e precisa saber
qual está certo.

⚠️ o legado repete nesta tela o `NP.DESCONTO` **sem `coalesce`** no frete e no seguro (`:513`), o mesmo
descuido do relatório de compras: com desconto nulo a parcela vira NULL e a linha some da soma. Protegido.

## 4. O que não conta

Nota de entrada **não processada** e venda **cancelada** ficam de fora dos dois lados. Contá-las inverteria o
sinal da diferença e mandaria o comprador repor o que já está na prateleira.

## 5. Cobertura (§117 do smoke, 4 checks)

1. as duas pontas na mesma unidade: 10 caixas de 12 = 120 entradas contra 90 saídas, diferença −30;
2. o desconto como percentual (800,00 de compra) e a venda líquida com promoção (1.340,00);
3. nota não processada e venda cancelada fora;
4. data invertida recusada.

## 6. O que ficou de fora

**Resolvido de outro jeito:** a exportação para Excel é o CSV da grade.

**Ainda falta:** a segunda visão da tela — a **análise por pedido de compra** (`GeraConsultaPedidos:461`),
que cruza o que foi pedido com o que entrou; o cliente tem pedidos de compra migrados, então ela entra quando
alguém pedir.
