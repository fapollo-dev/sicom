-- 252 — RELATÓRIO DE ANÁLISE PEDIDO × NF (`FRMRELANALISEPEDIDONF`, `UFrmRelAnalisePedidoNF.pas` 222 linhas +
-- `URelAnalisePedidoNF.pas` 192). **22 acessos, 4 operadores.**
--
-- É o RELATÓRIO da análise pedido de compra × NF-e recebida — a análise em si (cabeçalho, pedidos, notas da fila
-- do manifesto, divergências, itens fora do pedido e fora da NF) já vive no destino desde a migration 152, e o
-- motor que a cria/abre está em `compras/pendencias` (`AnaliseMotorService`). A análise é VIVA no cliente:
-- **9.796** análises, a última **ontem (17/09/2026 08:55)**; 214 em 2026 (203 na loja 1, 11 na 2).
--
-- O relatório lista as análises do período (por data da análise) com as notas e os pedidos agregados numa
-- linha, o fornecedor e o comprador dos pedidos, o status ("Em andamento"/"Finalizado") e total/parcial —
-- filtrando por fornecedor e por comprador; e, "Expandido", imprime embaixo de cada análise as três grades que
-- o dossiê já devolve (divergentes, só na NF, só no pedido).
--
-- ── ⚠️ O SQL do legado faz o produto cartesiano NF × PEDIDO e o LISTAGG duplica ─────────────────────────
-- `FROM ANALISE_PEDIDO_NF A JOIN ANALISE_PEDIDO_NF_NF APNN … JOIN ANALISE_PEDIDO_NF_PEDIDO APNP …` — uma análise
-- com 3 notas e 3 pedidos vira **9 linhas**, e `LISTAGG(NNC.NRONF)` lista cada nota **3 vezes** (e cada pedido 3
-- vezes). Medido: **31 análises** têm mais de uma nota E mais de um pedido (ex.: APN 13106, 13107, 13108 — 3×3).
-- Aqui as duas listas são subconsultas com DISTINCT.
--
-- ── ⚠️ `JOIN OPERADORES CP ON CP.CODOPERADOR = SUB1.CODCOMPRADOR` é INNER — e derruba análises ──────────
-- O comprador vem de `MAX(PC.USUCADASTRO)`; quando é nulo ou órfão, a análise inteira sai do relatório.
-- Medido: **24 análises ativas** somem por isso. Aqui o comprador é LEFT JOIN e a linha fica, com o nome vazio.
--
-- ── ⚠️ `MAX(PC.CODPARCEIRO)` / `MAX(PC.USUCADASTRO)` escolhem UM quando há vários ───────────────────────
-- **5 análises** têm pedidos de mais de um comprador — o relatório mostra só o de código maior. (Fornecedor:
-- 0 casos no cliente hoje.) Aqui fornecedores e compradores são listas distintas, como as notas e os pedidos.
--
-- ── Folds ───────────────────────────────────────────────────────────────────────────────────────────────
--  • O comprador do pedido no destino é `pedidocompra.codoperador` (a migration 060 não trouxe USUCADASTRO;
--    o codoperador é carimbado no create). O filtro "Comprador" do legado é `PC.USUCADASTRO`.
--  • A referência da nota honra `apnn_tabela` (o legado só junta `NFE_NAO_CADASTRADAS`, que é 100% do golden).
--  • Tenant-scoped (o legado monta `A.CODEMPRESA IN (lista)`).
--  • A impressão `.fr3` e o "Expandido" do papel: o retorno traz o material; expandido = dossiê embutido.

CREATE INDEX IF NOT EXISTS ix_apn_emp_data ON analise_pedido_nf (codempresa, apn_data_analise);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELANALISEPEDIDONF', 'FRMRELANALISEPEDIDONF', 7, 1)
ON CONFLICT DO NOTHING;
