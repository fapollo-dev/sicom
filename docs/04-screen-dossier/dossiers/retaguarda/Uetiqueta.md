# Etiquetas de preço (FRMETIQUETA, `Uetiqueta.pas`) — 2.426.760 acessos

A tela mais usada do legado. Código no Apollo: `cadastro/etiqueta.service.ts` + `apps/web/src/features/etiqueta`. Mig 124.

## Corte "a pesquisa por ETQ_IMPRESSA e o log da produção" (25/09/2026) — auditoria de esqueletos §4.10

- **A pesquisa por situação da etiqueta** (`GET cadastro/etiqueta/pesquisa?situacao=N|S|T`; o rádio de Uetiqueta.pas:700-735):
  'N' = gôndola com preço alterado e etiqueta velha (o trigger do MULTI_PRECO zera o flag a cada troca de preço). A fila do
  coletor (ETIQUETA_CONS_PROD) tem 309 linhas em 2025-26 contra 116 mil impressões — o grosso vem da pesquisa (4.965 produtos
  pendentes na loja 1, 7.159 na 2, 7.586 na 52).
- **"Adicionar" põe o produto na lista de impressão** — não enfileira mais no ETIQUETA_CONS_PROD, que é a fila do coletor.
- **LOG_IMPRESSAO_ETIQUETA como a produção**: uma linha por cópia com VALOR_IMPRESSAO e o modelo (6.279 de 6.279 linhas de
  set/2026; amostra: operador 63, 24/09 18:49:58, 7896098905999 a 4,99, "GONDULA PINHEIRAO").
  ⚠️ **Correção**: a mig 124 afirma que a tabela "não tem escritor (artefato morto)" — falso; 77.404 linhas em 2026.
- Imprimir marca **todas** as pendentes do produto na fila do coletor (`MarcarImpressaEtqConsProd`, :430-443) e o
  MULTI_PRECO.ETQ_IMPRESSA da loja (`MarcarImpressaEtqProduto`, :474-489).
- Smoke 47g + a pesquisa por situação.

## Corte "os modelos do legado e o registro de impressão" (29/09/2026)

**Recon:** a produção guarda os `.fr3` na tabela **RELATORIOS** (1.227 arquivos, CLOB em base64; 41 modelos `eti$`). Em 2026 o
log tem 78.262 impressões do **GONDULA PINHEIRAO** (99,8%) — papel 105×30 mm, descrição (Franklin Gothic 16), preço
`IIF(VRPROMO > 0, VRPROMO, VRVENDA1)` em Arial 61 com `%2.2n`, "R$", EAN-13 e `[Date] - [Time]`. A folha genérica do corte 1
(cartão 220×132 px com "de/por") não era nada disso.

- **Motor .fr3 no navegador** (`features/etiqueta/fr3`): páginas no tamanho do papel (`@page` nomeada), bandas ReportTitle/
  PageHeader/MasterData (colunas)/PageFooter/ReportSummary, memo (fonte, cor TColor, borda, alinhamento, rotação,
  DisplayFormat), EAN-13/EAN-8/2de5/Code-39/Code-128, linha, forma, figura (Picture.PropData) e o PascalScript dos eventos
  (`OnBeforePrint`, `OnStartReport`, variáveis do relatório). Paginação do FastReport: a banda que não cabe abre página. Os
  46 arquivos da produção desenham sem erro; testes com GONDULA PINHEIRAO, Gondula Promocao 2 (script DE/POR), etiqueta
  atacarejo (páginas por variável) e 3 colunas A4.
- **O combo de modelos** = `CarregaRelatorio` (udmPrincipal): arquivos `eti$*.fr3`, nome entre o 1º '-' e o 1º '.';
  PERSONALIZADO antes do DEFAULT. Modelo geral obrigatório ("Necessário informar o modelo da etiqueta.") e volta a vazio quando
  entra produto novo; modelo por linha na grade.
- **O registro de impressão** (cdsPrint2): uma linha por cópia, por modelo, ordenado CODDPTO;DESCRICAO; VRPROMO = VRPROMO > 0 ?
  VRPROMO : VRVENDA1; DTPRODUCAO; nutricional + DTVALIDADE (GetInformacoesAdicionais); promoção acumulativa; observações
  (a da grade vence a geral); descrição: editada → como está; "Grupo de preço" → o grupo; senão descrição + unidade quando
  ainda não termina com ela (**1.321 de 1.321** descrições do log seguem a regra). Modelo "zebra" pelo cdsPrint (QTDE = ⌈qtde/DIV⌉).
- **Por origem, como o legado**: código de barras (só a descrição, qtde PROD_QTDE_ETIQUETAS), pesquisa (descrição + unidade),
  coletor (qtde 1, sem grupo, linha desmarcada, um código uma vez), **Ajuste de Preços com o preço do LOTE** (antes saía o do
  MULTI_PRECO — lote não processado imprimia o preço velho), **agenda com o preço da agenda** (antes o do MULTI_PRECO), importar
  arquivo .txt `CODBARRA/QTDE/VALOR` (qtde e valor lidos e ignorados, como no legado).
- **Bugs corrigidos:** (1) o código de CAIXA procurava em `CODAUXILIAR.CODBARRA`, que na produção é o código do próprio produto
  (1.147/1.147) — o da caixa é `CODAUXILIAR.CODAUXILIAR`; bipar a caixa dava "produto não encontrado". (2) FATOR_FILHO sem produto
  pai multiplicava o preço (3 produtos na produção) — o legado só usa o fator com IDPRODUTO_PAI > 0.
- **Log** como o binário novo: DESCRICAO_ETIQUETA, QTDE_IMPRESSA 1, VALOR_VENDA/PROMOCAO/VENDA_PROMOCAO, UNIDADE,
  VALOR_APRESENTACAO (preço por KG/LT de GET_ETIQUETA_CONS_PROD) e DADOS_ETIQUETA ("CAMPO=valor; …").
- **Marcas**: a fila do coletor só quando a lista veio do "Consulta Preço" (FObbetqcoletor); ETQ_IMPRESSA de **todos** os
  produtos da grade, marcados ou não (MarcarImpressaEtqProduto varre o cdsImpressao sem filtro).
- Rádios "Buscar somente produtos ativos" (ATIVO_PELA_MULTIPRECO) e "Descrição etiqueta na impressão"; "Etiqueta única";
  "Verificar backup" (a última lista impressa, no navegador).

**Fora, com prova:** LOTEPRECO.ETIQUETA_IMPRESSA (0 de 97.078 lotes marcados — o binário novo não grava); atacarejo
(MULTI_PRECO_ATACAREJO MORTA); CODAUXILIAR_VALOR do DADOS_ETIQUETA (formato não comprovável e nenhum modelo usa); modelo
matricial desenha como memo em Courier (0 usos); a etiqueta de parceiros (FlagEtiqueta=1, `etip`) e a UetiquetaNF são outras
entradas — próximo corte.
