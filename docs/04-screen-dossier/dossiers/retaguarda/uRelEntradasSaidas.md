# ENTRADAS E SAÍDAS (`FRMRELENTRADASSAIDAS`) — completa (comparativo pelo binário novo em 06/10/2026)

`uRelEntradasSaidas.pas` (635) + `.dfm` (3.644, quase todo layout de FastReport). **148 acessos, 20 operadores.**

## 1. Os dois relatórios

1. **Listagem** — as notas de entrada e saída do período, item a item;
2. **Comparativo** — por produto e loja: quanto entrou, quanto saiu (notas e PDV), custo médio, venda média, a diferença,
   os estoques, markup/margem e a última NF de entrada. **É o SQL do binário novo** (§7) — o fonte de 2020 é outro.

## 2. ⚠️ O bug do desconto — R$ 178.994,93 por ano (listagem)

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

## 3. ⚠️ A nota não processada estava contada duas vezes (corte de 09/2026 — substituído pelo §7 no comparativo)

O `WHERE` do legado é só `TIPO = 'E' AND DTCONTABIL BETWEEN` — **não filtra `PROC` nem `CANCELADA`**.

Mas o próprio comparativo tem a coluna `VABERTO`, que soma exatamente as notas com `PROC = 'N'`. Ou seja: a
mesma mercadoria aparecia como **entrada do período** e como **"a entrar"** — e viraria entrada de novo no dia
em que a nota fosse processada.

Nota não processada **não movimentou estoque**. O movimento passou a exigir `PROC = 'S'`; o "a entrar"
continua mostrando o que está a caminho. Cada coisa contada uma vez.

## 4. A unidade do comparativo

A quantidade é `QUANTIDADE × FATOREMBAL` **nos dois lados**. A nota vem em caixa e a venda é em unidade; sem
o fator, entrada e saída não se comparam — o mesmo cuidado da Precificação de NF, aqui pelo motivo oposto.

## 5. Cobertura (§109 do smoke, 6 checks; teste de renderização do layout 958)

1. o bug do desconto na listagem, com o valor correto (800,00) e o do legado (980,00) lado a lado;
2. o comparativo do binário novo: entrada sem desconto, saída de NF pelo custo, vendas do PDV (a cancelada fora), as CFOPs de fora;
3. estoques loja/depósito/total, markup e margem, a última NF de entrada (sem filtro de CFOP/período), última data com movimento;
4. uma linha por loja, o fornecedor por N.CODPARCEIRO × P.CODFOR, a hora inicial que tira o primeiro dia;
5. o Imprimir no layout do cliente (variáveis e dataset) e o "sem dados";
6. data invertida recusada.

## 6. O que ficou de fora

**Resolvido de outro jeito:** os relatórios `.fr3` — a grade imprime em paisagem e exporta em CSV.

**✅ Os rádios Custo e Venda (25/09/2026):** no legado eles só passam `CCusto`/`CVenda` ao `.fr3` do comparativo, cujo
script troca a coluna: custo **médio** do período × custo de **reposição** atual (`VRCUSTOREP` da linha de preço);
venda **média** × **valor** de venda atual (`VRVENDA`). A API já devolvia os quatro; a tela ganhou os rádios, que
trocam a coluna da grade (e, com ela, a impressão e o CSV).

## 7. ✅ O comparativo do binário novo (06/10/2026)

O vigia do V$SQL da produção capturou o SQL que o binário novo roda (sql_id `8atxanr5aywa0`, guardado em
`docs/05-migration-engineering/capturas-vsql/entradas-saidas-8atxanr5aywa0.sql`). Ele **diverge do fonte de 2020** e o Apollo, que
tinha sido escrito do fonte, foi refeito por ele:

| | fonte 2020 / Apollo de 09/2026 | binário novo (a produção) |
|---|---|---|
| pernas | entrada e saída de NF | NF de **saída**, NF de **entrada** e as **vendas do PDV** (não canceladas) |
| CFOP | nenhuma regra | saída só nas 15 CFOPs de venda (5102…6927); entrada sem as 12 de devolução/retorno (1202, 1411, 1553, 1918, 2202…) |
| valor da entrada | QTDE × VRCUSTO − desconto | **QTDE × VRCUSTO**, nada descontado |
| valor da saída de NF | QTDE × VRVENDA | **QTDE × VRCUSTO** (pelo custo) |
| venda do PDV | — | QTDE × VRVENDA pelo IAT (A arredonda, o resto trunca) |
| NF | (Apollo: PROC = 'S') | PROC = 'S' e não cancelada, pela data contábil |
| agrupamento | produto | produto e **loja** (FANTASIA), ordem LOJA, DESCRIÇÃO |
| colunas novas | VABERTO ("a entrar") | ATIVO_VENDA/ATIVO_COMPRA, estoque do depósito e total, MARKUP, MARGEM, ÚLTIMA NF de entrada (número e emissão; a última processada do produto na loja, sem CFOP nem período), departamento/grupo/subgrupo/seção, fornecedor, última data com movimento — **sem VABERTO** |

- **Lojas**: `GetMultiEmpresa` (o Apollo usava só a do login), recortadas às do operador.
- **Filtros** (`VerificaFiltro`): entrada por `N.CODPARCEIRO`, saída e venda por `P.CODFOR`; departamento, grupo, subgrupo e o produto
  pelo **código** (`edtCodProd`).
- **Hora** (`edtHora1/2`, visíveis, 00:00 e 23:59): D1/D2 = data + hora comparados com `TRUNC(data)` — hora inicial depois de 00:00
  tira o primeiro dia inteiro; a final não muda nada.
- **Imprimir** (`btnImprimirClick`): `Relatorios\Rel_EntradasESaidas_Comparativo.fr3` (958) com `frxDBDRelComparativo`, DtInicial,
  DtFinal, Empresas "(1,2)", OutrosFiltros (`FiltrosUtilizados`: "Fornecedor: …;Depto: …;Grupo: …;SubGrupo: …;Produto: …;" ou "Sem outros
  filtros;") e CCusto/CVenda (o script troca as colunas). O `frxdbdtstDocs` do layout só está num `COUNT(MasterData1)` — não é dado.
  O `_Comparativo_2` (959, agrupado também por fornecedor) existe na RELATORIOS mas nenhuma opção da tela o carrega no fonte.
- **Listagem**: segue pelo fonte de 2020 — o layout vivo (1421) lê campos que o fonte não tem e o SQL dela não foi capturado.
