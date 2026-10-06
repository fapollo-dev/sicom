# ANÁLISE DE COMPRA × VENDA (`FRMRELENTSAI`) — completa (as duas visões)

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

## 4. O que não conta — e o que conta (corrigido em 06/10/2026)

Nota de entrada **não processada** e venda **cancelada** ficam de fora dos dois lados. Contá-las inverteria o
sinal da diferença e mandaria o comprador repor o que já está na prateleira.

⚠️ O corte de 09/2026 tinha seis diferenças do fonte, corrigidas:
- **lojas**: as do `GetMultiEmpresa` (era só a do login);
- **NF cancelada processada**: o fonte filtra só `TIPO = 'E' AND PROC = 'S'` — ela **conta** (3 na produção); o Apollo a tirava;
- **venda**: `V.CANCELADO = 'N'` (o nulo fica fora; nenhum no último ano) e a **descrição da venda** (`V.DESCRICAO`), com
  `LEFT JOIN PRODUTOS` — o produto que mudou de nome sai em duas linhas (a da venda com o nome antigo e a da nota com o atual),
  porque o agrupamento externo é por descrição;
- **departamento**: `F.CODFAMILIA = P.CODDPTO` sem filtro de tipo; nos **pedidos**, o filtro de departamento é o do PEDIDO
  (`F` é `PE.CODDPTO`);
- **fornecedor**: `PA.CODPARCEIRO` (o parceiro do produto);
- **o dia** da venda é o da loja.

## 4b. A impressão (`btnImprimirClick`) ✅ 06/10/2026

`Relatorios\Rel_Analise_Compra_Venda2.fr3` (934) com o `cdsConsulta` no `dbdConsulta` e as variáveis DtInicial, DtFinal (o layout lê
`[Dtfinal]` — o FastReport não distingue maiúsculas) e Empresa. O script do layout esconde a coluna da loja quando IDEMPRESA = '0'
(o agrupar por produto). Sem linhas: "Não há movimento no filtro informado. Verifique!". O `CkbExibirGrade` (mostrar a grade antes de
imprimir) é a própria grade da tela.

## 5. Cobertura (§117 do smoke, 7 checks; teste de renderização do 934)

1. as duas pontas na mesma unidade: 10 caixas de 12 = 120 entradas contra 90 saídas, diferença −30;
2. o desconto como percentual (800,00 de compra) e a venda líquida com promoção (1.340,00);
3. nota não processada e venda cancelada fora;
4. data invertida recusada;
5. a visão por pedidos;
6. a NF cancelada processada, a descrição da venda, as lojas e o agrupar;
7. o Imprimir e o "sem movimento".

## 6. O que ficou de fora

**Resolvido de outro jeito:** a exportação para Excel é o CSV da grade.

**✅ A segunda visão (25/09/2026):** `GeraConsultaPedidos` (`:461`) — o dossiê a chamava de "por pedido de compra", mas
as saídas são os **PEDIDOS de venda** digitados (`PEDIDOS`, a digitação de pedidos): quantidade, valor **truncado**
(qtde × vrvenda), o departamento do próprio pedido, a descrição do pedido e só `CANCELADO = 'N'`; o agrupar por
produto não vale nesta visão (o fonte sempre separa por loja). `GET relatorios/compra-venda?modo=pedidos`, o rádio
"Saídas: Vendas / Pedidos" na tela, smoke §117.5. A digitação parou em fev/2025, mas o histórico está carregado.
