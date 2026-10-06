# FRMRELLISTAPRECOSFORNECEDOR — Prévia do fornecedor / análise de giro

**3.903 acessos** (a 4ª tela mais usada da fila de impressões). `uRelListaPrecosFornecedor.pas` (2.055) + `.dfm` (3.212) +
`udmRelListaPrecosFornecedor` (428 + 1.351) + `uRelListaPrecosFornecedorGrid` (a grade de prévia do "Exibe Grade").
API `POST relatorios/previa-fornecedor/{matriz,periodo,impressao}`. Tela `/relatorios/previa-fornecedor`. Smoke §47n (1-12).
Código: `apps/api/src/modules/relatorios/previa-fornecedor.service.ts` — o cabeçalho de cada método traz a procedência e as divergências.

## 1. O que faz

O comprador escolhe o fornecedor (e/ou departamento, grupo, subgrupo, seção, marca, produto, situação de compra) e vê, produto a
produto, o giro em períodos — com estoque, mínimo/máximo, última entrada e custos — para decidir o pedido.

- **`rdgPeriodo`** (padrão "15 Dias"): 5 anos · 5 meses · 5 semanas (domingo→sábado) · 15 dias · 5 dias · 30 dias (5 blocos de 6) ·
  anual (12 meses) · "Habilita Período" (outra geração do cálculo: uma faixa livre, `MontaSqlPorPeriodo`).
- **`rdgVisualizar`**: Vendas (VENDAS ∪ NF de saída nos 8 CFOPs) · **Pedidos** (a tabela PEDIDOS) · Entradas e Saídas (+ NF de entrada).
- As linhas vêm de PRODUTOS ⋈ ESTOQUE da loja — o produto sem giro aparece com zero na tela.

## 2. Divergências conhecidas (ver o cabeçalho do serviço)

- uma loja só: o SQL de linhas do legado seleciona `M.VRCUSTOREP` e só faz o join com MULTI_PRECO com uma loja (`FAtivo`); com várias
  lojas o SQL quebra no legado. O Apollo usa a loja do login;
- a data de análise é parâmetro (padrão hoje, como o `FDataAnalise := DateOf(Now())`);
- no "Habilita Período", o estoque sai da ESTOQUE (o legado multiplicava `PRODUTOS.QTDE` pelo nº de linhas de movimento) e o filtro de
  situação funciona (no legado é morto nesse caminho).

## 3. ✅ Corte 06/10/2026 — o Imprimir dos modos de slots e o modo Pedidos

- **Pedidos** (`tvPedidos`, não existia): a mesma célula sobre a PEDIDOS — `V.CANCELADO = 'N'`, `TRUNC(V.DTVENDA)`, SUM(QTDE),
  AVG(VRCUSTO), AVG(VRVENDA), sem a NF e sem o custo de reposição.
- **Imprimir** (`btnImprimirClick` → `GeraConsulta` + `Filtro(True)` + `GetNomeArqFR3`): o `cdsListagem` (`dbdListagem`) refeito linha a
  linha sobre a consulta da tela:
  - SMDn = a quantidade da linha de saída do período, **nula** quando não houve (o `Locate` falhou); QTDE_ENTRADAn idem para a entrada;
  - VRCUSTO / VRVENDA / VRCUSTO_ENTRADA = a média das médias dos períodos em que o valor foi > 0 (sobre as médias cruas — a tela
    arredonda a 4 casas, a impressão não);
  - nos modos de 5 períodos (`AtualizaListagem`): TOTALPERIODO = SMD1..5 e o **VRCUSTOREP dividido pelo nº de períodos com custo**
    (quirk do legado: o custo de reposição atual ÷ períodos); no 15 dias e no anual: TOTAL_MESES = Σ SMD e o VRCUSTOREP inteiro;
  - EMBALAGEM = UNIDADE + '/' + FATORCX; DTULTENT nula sai **30/12/1899** (o `AsDateTime` de nulo é 0); PMZ = 0;
  - TITULOn: D1..D15 · o dia (5 dias) · "dd a dd" (30 dias) · "d a d" (5 semanas) · o ano · o nome do mês (5 meses) · 3 letras (anual);
  - só as linhas com algum SMD ou QTDE_ENTRADA > 0, em ordem de DESCRIÇÃO; vazio → "Não há movimento no filtro informado. Verifique!".
  - Layout: 15 dias → `ListaPrecFornecedorVendas_Quinzenal`; anual → `_Anual`; senão `Vendas` (com custo) / `Vendas2` (sem custo),
    `Pedidos`, `EntSai`. Os memos `mmCodproduto`/`mmCodbarra` seguem o "Visualizar" do código (produto × barras) e
    `mmTotalPeriodo`/`mmUltQtdeCompra`/`mmUltDtCompra`/`mmSomaTotalPeriodo` só aparecem com custo em 30 dias (o `Visible` ajustado no XML
    do layout, como o legado faz no relatório carregado — `comVisibilidade`). Variáveis Empresa, FORNECEDOR ('código - razão') e
    MOSTRAR_CUSTO ('1'/'0'). Sem opção de impressão na PERMISSOES: o acesso à tela.
- ⚠️ **`MesExtenso` × `MesExtensoT`**: o `FuncoesApollo` não veio no fonte. `MesExtenso` = 3 letras é provado pelos campos JAN_VALOR … DEZ_VALOR
  do Rel_CaixaAnual (montados com `UpperCase(MesExtenso(i))` — o `UpperCase` por fora indica que a função não devolve em maiúsculas: "Jan").
  `MesExtensoT` = o nome inteiro ("Janeiro") é inferência: é a outra função e é o texto dos nós de mês da árvore dos lançamentos contábeis.

## 4. Falta

- a impressão do "Habilita Período" (`AnaliseGiroMercPeriodo[Analitico].fr3`, com `cdsPorPeriodo`/`cdsMesesAnalitico` e as variáveis
  MODELO/MESANO/QUANT/VIZUALIZARPROD/CRITERIO/TIPOQUERY) e as variantes Pedidos/Entradas-e-Saídas desse modo (`qryPeriodoDiasPedidos`,
  `qryPeriodoDiasES`);
- o "Exibe Grade" (a prévia em grade antes de imprimir) — a tela do Apollo já mostra a grade.
