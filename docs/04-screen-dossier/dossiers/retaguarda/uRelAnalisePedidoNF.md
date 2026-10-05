# FRMRELANALISEPEDIDONF — Relatório de análise pedido × NF

**22 acessos · 4 operadores.** `UFrmRelAnalisePedidoNF.pas` (222) + `URelAnalisePedidoNF.pas` (192). Migration **252**.
API `GET compras/rel-analise-pedido-nf`. Tela `/compras/rel-analise-pedido-nf`. Smoke §129 (4 checks).

## 1. O que é

O **relatório** da análise pedido de compra × NF-e recebida. A análise em si — cabeçalho, pedidos, notas da
fila do manifesto, divergências, itens fora do pedido e fora da NF — já vive no destino desde a migration 152,
e o motor que a cria e a abre está em `compras/pendencias` (`AnaliseMotorService`). A análise é **viva** no
cliente: **9.796** análises, a última **17/09/2026 08:55**; 214 em 2026 (203 na loja 1, 11 na 2).

O relatório lista as análises do período (pela `APN_DATA_ANALISE`) com notas e pedidos agregados numa linha,
fornecedor e comprador dos pedidos, status ("Em andamento" / "Finalizado") e total/parcial, filtrando por
fornecedor e comprador. "Expandido" imprime embaixo de cada análise as três grades — divergentes, só na NF,
só no pedido — que são exatamente o que `dossie(apn_id)` já devolve. Aqui o expandido **é** o dossiê embutido.

## 2. ⚠️ O SQL faz o produto cartesiano e o LISTAGG duplica

```sql
FROM ANALISE_PEDIDO_NF A
JOIN ANALISE_PEDIDO_NF_NF     APNN ON APNN.APN_ID = A.APN_ID
JOIN ANALISE_PEDIDO_NF_PEDIDO APNP ON APNP.APN_ID = A.APN_ID
...
LISTAGG(NNC.NRONF, ', ') ..., LISTAGG(APNP.CODPEDCOMP, ', ') ...
```

Uma análise com 3 notas e 3 pedidos vira **9 linhas**, e cada nota sai **3 vezes** na coluna (cada pedido
também). Medido: **31 análises** têm mais de uma nota E mais de um pedido (APN 13106, 13107, 13108 — 3×3).
Aqui as listas são subconsultas com `DISTINCT`.

## 3. ⚠️ O INNER JOIN em OPERADORES derruba análises

`JOIN OPERADORES CP ON CP.CODOPERADOR = SUB1.CODCOMPRADOR`, com `CODCOMPRADOR = MAX(PC.USUCADASTRO)`. Quando o
comprador é nulo ou órfão, a análise inteira some do relatório. Medido: **24 análises ativas**. Aqui é LEFT e
a linha aparece com o comprador vazio.

## 4. ⚠️ `MAX()` escolhe um

`MAX(PC.CODPARCEIRO)` e `MAX(PC.USUCADASTRO)`: quando os pedidos da análise são de compradores diferentes, o
relatório mostra só o de código maior. Medido: **5 análises** (fornecedor: 0 casos hoje). Aqui fornecedores e
compradores são listas distintas, como as notas e os pedidos.

## 5. Folds declarados

- **Comprador** = `pedidocompra.usucadastro` (o `PC.USUCADASTRO` do legado — quem cadastrou o pedido). ⚠️ Até 05/10/2026 o
  Apollo usava o `codoperador` (a nota antiga dizia que a mig 060 não trouxe `USUCADASTRO`; a mig 162 trouxe, e o pedido novo o
  carimba): na produção os dois divergem em **214 dos 8.236** pedidos analisados.
- A nota honra `apnn_tabela` (o legado junta só `NFE_NAO_CADASTRADAS`, que é 100% do golden).
- Tenant-scoped (o legado monta `A.CODEMPRESA IN (lista)`).
- O filtro por fornecedor/comprador entra se **algum** pedido da análise bate — no legado o WHERE age nas linhas
  do cartesiano antes do GROUP BY, o que dá a mesma semântica.
- `.fr3`: acessório; o retorno traz o material inteiro (com `truncado` quando passa do limite).


## O binário novo, a impressão e as lojas (05/10/2026)

O V$SQL da produção (sql_id `2nfs8zjd9kv39`, 5 execuções no dia) mostra o `GetSQL` do binário novo: além do de 2020, traz
`A.APN_DIFERENCA_VALOR`, `A.APN_STATUS_FINALIZACAO`, `A.CODOPERADOR_FINALIZADO` e `OP.NOME AS USUARIO_LIBERACAO` (`LEFT JOIN
OPERADORES OP ON OP.CODOPERADOR = A.CODOPERADOR_FINALIZADO`), um **filtro por pedido** (`AND PC.CODPEDCOMP = 36257`) e, com ele,
**nenhum filtro de data**; as lojas no formato do `GetMultiEmpresa(True, '', True)` — `IN (1, 2)`.

- **o pedido**: `codpedcomp` — a análise entra se algum pedido dela é o informado, e aí sem o período;
- **as lojas**: `empresas`, recortadas às do operador (antes, só a do login);
- **a impressão** (`AnalisesPedidoNF.fr3`, PERSONALIZADO 644 — o DEFAULT 23 também já pede os campos do binário novo): grupos por
  loja › comprador › fornecedor › pedidos › análise com `CODCOMPRADOR = MAX(PC.USUCADASTRO)` e `CODPARCEIRO = MAX(PC.CODPARCEIRO)`
  (as chaves de grupo do legado), as listas de notas/pedidos distintas e a análise de comprador órfão presente (as correções da
  consulta, acima); o script troca o rótulo do usuário pelo `APN_STATUS_FINALIZACAO` ('FEP' = "Usuário que editou os pedidos:");
  os três detalhes do `AntesImprimir` (`QryProdutosDiv` / `QryProdutosIneNF` / `QryProdutosInePedido`, mestre-detalhe por
  `APN_DATA_ANALISE;APN_ID`) no sub-relatório, abertos pelo "Expandido" (`GphAnalise.ExpandDrillDown`).
- smoke §129.5; teste de renderização (expandido e recolhido).
