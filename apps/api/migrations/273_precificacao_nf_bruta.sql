-- 273 — PRECIFICAÇÃO PELA NF "BRUTA" (`FRMPRECIFICACAONFBRUTA`, `uPrecificacaoNFBruta.pas` +
-- `uDMPrecificacaoNFBruta`). **11 acessos, 4 operadores, último em 17/06/2026.**
-- Dossiê: `uPrecificacaoNFBruta.md`. Fecha o item 89 da fila.
--
-- A irmã enxuta da precificação por NF (mig 211-212): lista os itens de NF de **entrada** com o preço
-- atual, o custo de reposição, o PMZ, o preço sugerido e o **markup fixo** do produto, e o botão Aplicar
-- faz duas coisas por item marcado cujo preço sugerido difere do atual:
--   1. enfileira um `LOTEPRECO` com o **preço sugerido** (`PROCESSADO='N'`, obs
--      `'REFERENTE A PRECIFICAÇÃO NOTA FISCAL DE NRO. <nro>'`) — não altera preço na hora, como toda a
--      família de precificação do Apollo;
--   2. grava `MULTI_PRECO.MARKUPFIXO` com o markup digitado.
--
-- ── ⚠️ Dois defeitos do legado, os dois com consequência ──────────────────────────────────────────────
-- **1. `StartTransaction`/`Commit` DENTRO do laço** (`InsereAjustePreco`, uPrecificacaoNFBruta.pas:761-780):
--    cada item é uma transação própria. Se o quinto item falhar, os quatro primeiros já estão gravados e o
--    lote fica pela metade, sem aviso. Aqui é **uma transação para o lote inteiro**.
-- **2. A empresa do lote e a empresa do markup são DIFERENTES.** O `INSERT INTO LOTEPRECO` usa
--    `IDEMPRESA` **da nota**; o `UPDATE MULTI_PRECO` logo abaixo usa `EmpresaCODEMPRESA`, a **empresa
--    logada**. Precificando uma nota de outra loja, o preço vai para a loja da nota e o markup fixo para a
--    loja de quem está na tela. Aqui as duas seguem a empresa do tenant, e nota de outra empresa é recusada.
--
-- ── O que o dado diz (produção, 18/09/2026) ─────────────────────────────────────────────────────────────
--  · `LOTEPRECO`: **96.863 linhas**, a última de 17/09/2026 — a fila de preço é o coração vivo do processo;
--  · por origem: **'P' 29.008** (5.952 só em 2026) e **nula 67.855** — e a nula é justamente a desta tela,
--    que **não preenche `ORIGEM`** (o INSERT lista 8 colunas e ORIGEM não está entre elas). Aqui o lote
--    nasce com `origem = 'PRECIFICACAO_NF_BRUTA'`, e passa a ser rastreável;
--  · `MULTI_PRECO`: 203.640 linhas, **146.387 com MARKUPFIXO** preenchido (140.135 com valor > 0);
--  · `CODPEDCOMP` do LOTEPRECO: **0 de 96.863** — coluna morta, não replicada.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMPRECIFICACAONFBRUTA', 'FRMPRECIFICACAONFBRUTA', 7, 1),
  ('FRMPRECIFICACAONFBRUTA', 'BTNAPLICAR',             7, 1)
ON CONFLICT DO NOTHING;
