# DIAS DE ESTOQUE / COBERTURA (`FRMRELDDE`)

`URelDDE.pas` (373) + `.dfm` (1.181) + **`uDDE.pas` (318)**, onde vive a conta, + a grade **`URelDDEGrid.pas` (640)** /
`udmRelDDEGrid`. Herda o `TFrmRelMaster` (URelMaster.pas). **133 acessos, 5 operadores.**

## 1. A pergunta que a tela responde

**Com o que tenho na prateleira, quantos dias eu aguento?**

```
cobertura = estoque ÷ (vendido na janela ÷ dias da janela)      CAST(... AS NUMBER(20)) — arredonda
```

## 2. A tabela de 4 milhões de linhas que faltava na carga

A venda vem de **`MOVIMENTACAO_DIARIA`** (`IDEMPRESA · CODPRODUTO · DATA · QTDE`) — 4.034.759 linhas na produção (15/09/2026),
2019 → ontem. Não estava no destino nem no plano de carga (mig 220). Existe para o relatório não somar as 18,9 milhões de `vendas`.

## 3. Os dois tipos do `cbbTipoRel`

| tipo | classe | SQL | layout |
|---|---|---|---|
| **Dias de estoque** | `TDiasDeEstoquePadrao` | `GetSQLBaseDiasEstoque` | `Dias_de_estoque_1_empresa.fr3`; `Dias_de_estoque_varias_empresas.fr3` quando o `Empresas` tem vírgula (`SetaRelatorioVariasEmpresas`) |
| **Dias de estoque (ruptura)** | `TDiasDeEstoqueRuptura` | a base × `GET_PRODUTOS` × `GET_PARCEIROS` ⟕ `CODREFERENCIA_FOR` | `Dias_de_estoque_ruptura.fr3` (2 níveis: fornecedor ≥ 1, produto = 2) |

O `HabilitaFiltrosRelatorio` mostra a condição de ruptura e os níveis expandidos só na ruptura, e o "Exibir somente produtos
vendidos no período" (`CkbFiltrarProdutosVendidos`, desmarcado por padrão) só no padrão.

## 4. `GetSQLBaseDiasEstoque`, linha a linha

- **`PROD_VENDIDOS`**: produto × loja com venda desde `TRUNC(CURRENT_DATE − dias)`; estoque = `ESTOQUE + ESTOQUE_DEP`;
  `COBERTURA = CAST(CASE WHEN estoque < 0 THEN 0 WHEN vendido > 0 THEN estoque ÷ (vendido ÷ dias) ELSE −999999 END AS NUMBER(20))`.
- ⚠️ **o `CAST(... AS NUMBER(20))` arredonda** — provado no Oracle da produção (05/10/2026): `CAST(2.7 AS NUMBER(20)) = 3`,
  `CAST(2.5 …) = 3`, `CAST(−0.5 …) = −1`. O Apollo **truncava** (8 vendendo 3/dia dava 2; o legado dá 3). O `numeric(20)` do PG
  arredonda igual. Smoke §112.1.
- sem o "só vendidos": `UNION ALL` com os produtos **sem venda** na janela — estoque descontado do que está em troca
  (`GET_TROCAS_PRODUTO`, mig 376 — **só neste ramo**), venda 0, cobertura **−999999**.
- os filtros do `MontaFiltroSQL` — `FiltroNomeEdit` = coluna do nome do edit sem o "Edt", prefixo do `Hint` (só o produto tem,
  `P`): **produto, departamento, grupo, subgrupo, seção, fornecedor**, todos colunas de PRODUTOS (conferido na produção: nenhuma
  das outras tabelas do FROM tem essas colunas, sem ambiguidade); e `IDEMPRESA IN (lojas)`, trocado por `M.`/`E.IDEMPRESA`.
- `ORDER BY DESCRICAO, IDPRODUTO, IDEMPRESA`.

### O −999999

É o "não dá para calcular" do Delphi num campo numérico, e **é o que o legado entrega**: o layout (`DBDRelatorioCOBERTURAOnBeforePrint`)
e a grade (`GrdProdutosDBTableView1COBERTURAGetDisplayText`) escrevem **"Sem vendas"**. A versão anterior do Apollo trocava por
nulo + `sem_venda`; voltou ao valor do legado, porque o layout do cliente compara com −999999 — e a tela escreve "Sem vendas" como
a grade.

## 5. A ruptura (`TDiasDeEstoqueRuptura`)

```
WHERE DDE.COBERTURA <sinal> <dias da ruptura>  AND DDE.IDEMPRESA IN (...)  AND COBERTURA > 0
```

- `GetSinalOperador`: "Maior ou igual" → `>=`, "Igual a" → `=`, o resto → `<=`. O `EdtDiasRuptura.Text` vai cru para o SQL — um
  decimal ("10,5") quebraria o SQL do legado; aqui é inteiro.
- `COBERTURA > 0` tira o negativo (0) e o parado (−999999).
- `GET_PRODUTOS` = `MULTI_PRECO ⟕ PRODUTOS` (o preço **da loja**); `GET_PARCEIROS` = `PARCEIROS ⟕ PARCEIROS_END` (uma linha por
  endereço, que o GROUP BY colapsa) — o serviço usa as tabelas direto, com a mesma semântica.
- **a grade** (`GetSQLGrid`): + `FATOREMBAL` (`FATORKG` no KG, senão `FATORCX`), `VRCUSTO`, `VRVENDA`, agrupada por fornecedor, com os
  fornecedores secundários (`GetSQLAuxiliarGrid`, `CODREFERENCIA_FOR ⟕ PARCEIROS FRN='S'`) como detalhe por produto;
- **a impressão** (`GetSQL`): um registro por fornecedor secundário, `ORDER BY IDEMPRESA, RAZAO, CODFOR_SEC`.

## 6. As validações (`Validacoes`, com as mensagens do legado)

- dias da cobertura ≤ 0 → "Informe a quantidade de dias para o cálculo da cobertura."
- ruptura sem dias → "Informe a quantidade de dias para a ruptura"
- ruptura sem sinal → "Informe o sinal de operação para a condição de ruptura"
- impressão sem registro → "Não foram encontrados registros para imprimir o relatório." (`TFrmRelMaster`)

## 7. As lojas

`dmPrincipal.GetMultiEmpresa` = as lojas marcadas, recortadas às do operador (`empresasDoOperador`); nada marcado = a do login.
Várias lojas: o produto vem por loja, e a impressão do padrão troca de layout.

## 8. A impressão

`TFrmRelMaster.GeraRelatorio` → `relatorioMestre` (DBDRelatorio / DbdAuxiliar / DBDVariaveisAdicionais com `IDEmpresas` "1,2" e
`NiveisExpandidos`). Os layouts PERSONALIZADOS da produção (720/722/724) — o cabeçalho deles é fixo ("Apollo Sistemas de Gestão",
o padrão 104/106/108 tinha `relNomeEmpresa`). Teste de renderização em `apps/web/test/relatorio-fr3.spec.ts` (os três).

## 9. A grade e o "Gerar cotação"

O `CkbExibeGrade` vem **marcado** (dfm: `Checked = True`): o `AntesImprimir` abre o `TFrmRelDDEGrid` antes do relatório — a grade
é a consulta da tela no Apollo. A exportação para Excel (`Dias de estoque.xlsx` / `Dias para ruptura de estoque.xlsx`) é o CSV.

### O "Gerar cotação" (corte B — `TFrmRelDDEGrid.GerarCotacao`, só na ruptura)

**Vivo**: 4 cotações na produção (07/10/2020 → 16/03/2026; a última, 781 itens, virou o pedido 31837), todas "Convencional" e de
uma loja. O que grava (opção "Convencional", `GerarCotacaoConvencional('C')`):

| tabela | campos |
|---|---|
| COTACAO | DESCRICAO `Cotacao gerada pela relatório de dias para ruptura de estoque : dd/mm/aaaa hh:mm:ss` (conferida nas 4 da produção), DATA/DTCADASTRO/DTINICIOPREENCHIMENTO = agora, DTFIMPREENCHIMENTO = agora + 3, LIBERADA `S`, SITUACAO `A`, PEDIDOS `''`, EMPRESAS `;1;2;`, FLG_ORIGEM `C`, CODOPERADOR = USULTALTERACAO = o operador |
| COTACAO_PROD | um por item da grade: IDPRODUTO, DESCRICAO, VALORCUSTO = VRCUSTO, VALORVENDA = VRVENDA, FATOREMBALAGEM = FATOREMBAL; QUANTIDADE, VLRUNITARIO, VLREMBALAGEM, QTDEATUAL, VALORCOTACAO, QTDTOTAL = 0; CODOPERADOR |
| COTACAO_PRODQTDE | um por loja do `Empresas`, QTDE 0 (o `ExisteProdutoParaEmpresaCotacao` impede a repetição) |

- grade vazia → "Não existem produtos na grade."; a resposta → "Cotação gerada: N".
- ⚠️ **várias lojas**: a grade traz o produto uma vez por loja e o legado gravaria um COTACAO_PROD por linha (o mesmo produto
  repetido, cada um já com a quantidade de todas as lojas). O destino tem `ux_cotacao_prod (codctc, idproduto)`: fica **um por
  produto**, com os valores da primeira linha (a menor loja, pela ordem da grade). Na produção as 4 foram de uma loja só.
- **"Interna (lista de fornecedores)"** (`GerarCotacaoListaFornecedores`, grava em COTACAO_LISTAF / COTACAO_LISTAF_ITENS): marginal,
  com prova — COTACAO_LISTAF tem 1 linha ("TESTE COTACAO", 02/01/2023) e a única cotação 'L' é de 00:00:00 (o DDE grava a hora),
  não veio daqui (ver FILA-CONVERSAO #114). Não oferecida.
- RBAC: o botão não tem permissão própria na PERMISSOES; o gate é o da tela (`FRMRELDDE`).

## 10. Cobertura (smoke §112, 8 checks)

1. a conta e o **arredondamento** (100/10 → 10; 6/3 → 2; 8/3 = 2,67 → **3**);
2. negativo cobre 0; o parado é −999999; a ordem do legado;
3. "só vendidos" e os filtros por código;
4. `GET_TROCAS_PRODUTO` só no ramo dos não vendidos;
5. a ruptura com os três sinais, o `COBERTURA > 0`, fornecedor, fator, custo/venda e o secundário;
6. as três validações com as mensagens;
7. as lojas (o produto por loja) e a impressão nos três layouts + a mensagem sem registro.
8. o "Gerar cotação": cabeçalho, um produto por item, a quantidade zerada por loja, só na ruptura, grade vazia.
