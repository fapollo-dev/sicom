# RELATÓRIOS DE COMPRAS (`FRMRELCOMPRAS`) — completa

`URelCompras.pas` (381) + `URelCompras.dfm` (1.285) + **`UCompras.pas` (510)**, onde vive o SQL.
**204 acessos, 19 operadores**, último em 17/08/2026.

## 1. O que a tela é

Um combo com três relatórios sobre a mesma base — **o que a loja comprou**, pela árvore de categorias:

| # | relatório | agrupa por |
|---|---|---|
| 1 | Compras por categoria | seção → departamento → grupo → subgrupo |
| 2 | Compras por categoria **analítico** | o mesmo, descendo até o **produto**, com rateio de decomposição |
| 3 | Compras/Vendas **departamento** | departamento, com as duas pontas lado a lado |

Filtros: a árvore inteira (seção, departamento, grupo, subgrupo, produto), fornecedor, **lista** de CFOPs (do
item, não da nota), período por **uma de três datas** e multi-empresa.

## 2. A conta que dá o total (`UCompras.pas:110`)

```
base  = (VRCUSTO − VRCUSTO × DESCONTO/100) × QUANTIDADE
total = base + ICMS-ST + acessórias                    (em VALOR)
             + IPI% + FRETE% + SEGURO% sobre a base ARREDONDADA a 2 casas
```

⚠️ **o `CAST(… AS NUMERIC(13,2))` está dentro da conta**: o legado arredonda a base antes de aplicar cada
percentual. Tirar o arredondamento muda centavos em toda linha com frete ou IPI — e o cliente confere o total.

Só entram notas de **entrada, processadas e não canceladas** (`TIPO='E' AND PROC='S' AND CANCELADA<>'S'`).

Categoria ausente vira código negativo distinto — `-1` seção, `-2` departamento, `-3` grupo, `-4` subgrupo —
para o relatório conseguir agrupar "SEM SEÇÃO", "SEM GRUPO" etc. em linhas próprias.

## 3. ⚠️ A data que filtra não é a data que aparece

O combo escolhe entre **contábil**, **emissão** e **chegada** — mas o SELECT externo escreve
`DTCONTABIL AS DATA` **fixo** (`TComprasPorCategoria.GetSQL:166`), e o agrupamento é por ela. Ou seja: você
filtra por emissão e lê datas contábeis. Mantido: é o que o cliente lê há anos.

(No `MontaFiltroSQL:335` há um quarto caso, `DTPROCESSAMENTO`, que o combo não oferece — código inalcançável.)

## 4. A decomposição, no analítico

Quando o produto comprado é **decomposto** — compra a peça, vende os cortes — o analítico atribui o custo ao
produto **resultante** (`DECOMPOSICAO.IDPRODUTO_01`), na proporção de `PERCENTUAL`. Em produção (14/09/2026):
**135 vínculos, 13 produtos de origem, 30 de destino**, percentual de 0,7 a 50. Está vivo.

⚠️ No fonte, os joins de categoria do produto decomposto (`D2`, `G2`, `SG2`, `SC2`) casam com **`P.`** (o
produto original) e repetem a condição do alias errado (`AND D.TIPO = 'D'` no join de `D2`). Como o resultado
prático é a categoria do produto original, e é isso que o relatório sempre mostrou, a categoria segue vindo
da mesma origem — o que muda é só o **produto** e o **valor rateado**.

## 5. Os dois defeitos do legado — corrigidos, com a medida do impacto

### 5.1 O desconto nulo que faz o item sumir

Nas cinco parcelas do total, três protegem o nulo com `COALESCE(NP.DESCONTO,0)` e **duas não**: o frete e o
seguro (`:115-116`) usam `NP.DESCONTO` cru. Com desconto nulo a expressão inteira vira `NULL`, o `SUM`
descarta, e **o item desaparece do relatório**.

Medido na produção: **23 itens** com desconto nulo em 496.455, **1** deles com frete ou seguro. Corrigido com
`coalesce` — perder linha em relatório de compra é pior que divergir num item que ninguém conferiu.

### 5.2 O `WHERE` que não existe — 18,9 milhões de linhas

No relatório 3, modo "compras e vendas", a perna de vendas é escrita assim (`VendasCompras:495`):

```sql
FROM VENDAS NP
LEFT JOIN PRODUTOS P ...
LEFT JOIN FAMILIAS_PROD D ON D.CODFAMILIA = P.CODDPTO AND D.TIPO = 'D'
AND TRUNC(NP.DTVENDA) BETWEEN :ini AND :fim      -- ← ainda é o ON do LEFT JOIN
AND NP.IDEMPRESA IN (...)                        -- ← idem
GROUP BY ...
```

**Não há `WHERE`.** Data e empresa viram condição do `LEFT JOIN`, que por definição não elimina linha: entra
a **base inteira de vendas**, e o que não bate o período cai em "SEM DEPARTAMENTO". Na produção isso é
**18.965.108** linhas em vez das **115.078** de um mês numa loja.

Corrigido: aqui o filtro é `WHERE`. **A tela avisa em voz alta** que neste modo o número vai diferir do
sistema antigo, e por quê — quem confere os dois lado a lado precisa saber antes de abrir chamado.

## 6. A venda líquida do departamento

```
venda = (IAT='A' ? arredonda : trunca)(QTDE × VRVENDA)
        + acréscimos (DESC_ACRE_MEDIO e DESC_ACRE_ITEM, quando positivos)
        − descontos  (DESC_PROMOCAO + DESC_DEPARTAMENTO + os dois acima quando negativos)
```

O mesmo truncamento por `IAT` das outras telas de venda: item pesado ('A') arredonda, o resto trunca.

## 7. Cobertura (§105 do smoke, 7 checks)

1. a conta do total, com o arredondamento no meio (211,40);
2. o desconto nulo que sumia com o item, e os códigos negativos de categoria ausente;
3. só entra o que virou compra: cancelada e não processada ficam fora;
4. as três datas filtram, e a coluna exibida continua sendo a contábil;
5. o rateio da decomposição (40% de 211,40 = 84,56, no nome do produto decomposto);
6. o `WHERE` que faltava: a venda de 2040 fica fora e o departamento mostra os 200,00 do período;
7. "apenas compras" sem coluna de venda, e data invertida recusada com mensagem.

## 8. O que ficou de fora

- os três **relatórios impressos** `.fr3` (`Compras1 - Compras por categoria.fr3`,
  `Compras2 - …analitico.fr3`, `ComprasVendasPorDepartamento.fr3` / `VendaEComprasDepartamento.fr3`): aqui a
  grade **é** o relatório, e imprime em paisagem;
- **níveis expandidos** (`CmbNiveisExpandidos`): o legado escolhe quantos níveis da árvore abrir na impressão;
  a grade mostra todos;
- o **grid intermediário** (`TFrmRelComprasPorCategoriaGrid`), que no legado é uma prévia antes de imprimir.

## A impressão no layout do cliente (05/10/2026)

`GET relatorios/compras/impressao` — o "Imprimir" do `TFrmRelMaster` com a classe de UCompras.pas (helper `relatorio-mestre`):
`Compras1 - Compras por categoria.fr3`, `Compras2 - Compras por categoria analitico.fr3` e, no compras × vendas, `ComprasVendasPorDepartamento.fr3`
(só compras, ou só vendas — a venda vem no TOTAL_COMPRA, o alias do `ApenasVendas`, e o script troca os títulos pelo `Tabela`) ou
`VendaEComprasDepartamento.fr3` (ambos, Tabela 2). O `DBDRelatorio` na ordem do `GetSQL` da classe (loja, data, seção, departamento, grupo,
subgrupo — e produto no analítico), com TOTAL_PORC zerado como a consulta; os níveis expandidos do combo (0 a 5/6) vão no
`DBDVariaveisAdicionais`.
- **Lojas:** o serviço aceitava qualquer lista de `empresas`; agora passa pelo `empresasDoOperador` (as do operador; fora delas → 422).
- **A 4ª data do `CmbData`:** "Processamento" (`NF.DTPROCESSAMENTO`) faltava e entrou.
Smoke §105.8.

## Auditoria controle a controle (15/10/2026) — `URelCompras.dfm` × Apollo

O §8 deixava de fora "o grid intermediário" e dizia que "a grade é o relatório". No legado não é: a ação da tela é o **Imprimir** do
`TFrmRelMaster`, e a grade é a **prévia** dele.

- **Imprimir + "Exibe grade"** (`CkbExibeGrade`, `AntesImprimir`): nos tipos 1 e 2, com a marcação, a grade (`TFrmRelComprasPorCategoriaGrid`)
  aparece antes e o layout só sai pelo Imprimir dela (mrOk); sem a marcação, ou no tipo 3 (`TComprasVendas.ExibeGrid` = False), vai direto
  ao layout. O Apollo tinha "Gerar" (grade sempre, inclusive no tipo 3) e "Imprimir" separados. ❌→✅
- **A grade** (herda o `TfrmRelVendasGrid41`): loja → data → seção → departamento → grupo → subgrupo (→ produto no analítico), com os
  totais por nível, "TOTAL DE COMPRAS (R$)" e "TOTAL DE COMPRAS (%)". O **%** é o do legado: no sintético a participação do **subgrupo
  dentro do seu grupo** (`CalculaPorcentagemUltimoNivel`), no analítico a do **produto dentro do subgrupo** (`CalculaPorcentagemProduto`),
  e na loja a participação dela no total (`GetSQLEmpresa`). O Apollo mostrava uma grade plana com a fatia do total geral. ❌→✅ (API:
  `total_porc` com a semântica da grade + `lojas`; tela em árvore.) Botões da grade: Exportar ("1 - Compras por categoria"), Imprimir, Sair.
- **`CmbTipoRelatorioChange`**: nos tipos 1 e 2 o Considerar desliga (sem escolha) e o "Exibe grade" volta marcado; no 3, Considerar
  ligado em "Compras" e "Exibe grade" desmarcado e travado. O combo **abre vazio** (sem ItemIndex) e o `FormShow` cai no ramo do tipo 3.
  ❌→✅
- **Considerar** (`rgConsiderar`): rádio "Compras" / "Vendas" / "Compras e Vendas" (era um seletor que só aparecia no tipo 3). ❌→✅
- **Os códigos com Pesquisa** (`BtnBuscaFornecedorClick`, [F3]): departamento, grupo, subgrupo e seção na GET_FAMILIAS_PROD pelo TIPO,
  produto (PRODUTOS) e fornecedor (PARCEIROS, FRN = 'S'), com a descrição ao lado; o código que não existe limpa (`EdtCodFornecedorExit`).
  Eram campos de número soltos. ❌→✅
- **Limpar** (`BtnLimparClick`): campos em branco, datas em hoje, combos vazios (inclusive o tipo e a data). ❌→✅
- **Validacoes**: "A data inicial não pode ser maior que a final." (API e tela — o serviço lançava o código sem mensagem), "Selecione um
  tipo de relatório.", e o "Favor informar a data." do `OnExitData`. ❌→✅
- Níveis expandidos: o combo do `PreencheCmbNiveisExpandidos` (vazio, "1 nível", "N níveis"; 5 no sintético, 6 no analítico, travado no 3). ✅

Prova: smoke §105.9 + `apps/web/test/relComprasPage.spec.tsx` (2).
