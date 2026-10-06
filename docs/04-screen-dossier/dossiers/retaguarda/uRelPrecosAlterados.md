# RELATÓRIO DE PREÇOS ALTERADOS (`FRMRELPRECOSALTERADOS`)

`uRelPrecosAlterados.pas` (572). **36 acessos.** API `relatorios/precos-alterados`. Migration 244. A regra do corte 1 está no cabeçalho do serviço (`rel-precos-alterados.service.ts`): o histórico LEFT (o INNER do legado escondia 55% das alterações) e o ROWNUM antes do ORDER BY.

## ✅ O Imprimir (06/10/2026)

Origens **Produtos** e **Lote de preço**, os três agrupamentos do `rbAgrupamento`:
- por empresa → `Rel_PrecosAlterados.fr3` (1002; FANTASIA, DPTO, DESCRIÇÃO); por departamento → `Rel_PrecosAlteradosPorProduto.fr3`
  (1006; DPTO, DESCRIÇÃO, FANTASIA); **loja em colunas** (só Produtos — o `ConfiguraAgrupamento` só a mostra lá) →
  `Rel_PrecosAlteradosPorEmpresa.fr3` (1005) com o `cdsEmpresasEmColunas` do `TRelatorioEmpresasEmColuna`: uma linha por código de barras,
  VALOR_EMPRESA1..10 formatado ('##,###,#0.00') ou "-", EMPRESA1..N "Empresa X" só na 1ª linha;
- `frxDBDatasetPrecosAlterados` = o `cdsConsulta`; `frxDBDataset1` = a empresa; OPERADOR_RELATORIO (o operador logado) e PERIODO;
- **Lote de preço**: só o lote que ainda é o corrente da MULTI_PRECO (`JOIN MULTI_PRECO … CODLOTEPRECO`), e o legado zera o filtro
  (`Filtro := ''`): sem promoção e sem departamento. O agrupamento "por departamento" no lote não define relatório (o `LoadFromFile`
  da pasta falha) → 422;
- o histórico é LEFT (a decisão do §1 desta tela); as lojas são as marcadas.

⛔ A origem **"Lote de preço detalhado"** chama a procedure `POE_REL_PRECOS_ALTERADOS` (338 linhas, lida da produção em 06/10/2026:
`docs/05-migration-engineering/capturas-vsql/poe_rel_precos_alterados.sql`), que grava `REL_PRECOS_ALTERADOS_01` (162 linhas, de 07/08/2025) e imprime `Rel_PrecosAlteradosDet[1]`.
O SELECT dela tem `LEFT JOIN NF … AND ROWNUM = 1` no ON — só a 1ª linha processada casa com a nota —, e o resultado depende da ordem do
Oracle. Fica de fora até a saída dela ser medida na produção (rodar o SELECT, só leitura, e comparar).

Smoke §121.4; teste de renderização do 1002.
