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

Pendente: a entrada pelo Ajuste de Preços (botão "Etiquetas", §4.12); modelos .fr3, promo acumulativa/atacarejo, nutricional.
