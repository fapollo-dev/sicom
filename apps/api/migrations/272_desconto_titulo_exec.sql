-- 272 — ENCONTRO DE CONTAS (`FRMDESCONTOTITULO`), **corte-2: executar e reverter**.
-- Corte-1 (a consulta) na mig 226. Dossiê: `uDescontoTitulo.md`. 68 acessos, 11 operadores.
--
-- ── A regra, reconstruída do DADO (a operação 221, de 12/09/2026, ponta a ponta) ─────────────────────
--   AR 132551  R$ 8.559,27  → baixado em R$ 5.475,93, `QUITADA='S'`, `COD_DESCONTO_TITULO=221`
--   AP  74643  R$ 5.475,93  → baixado em R$ 5.475,93, `QUITADA='S'`, `COD_DESCONTO_TITULO=221`
--   AR 132552  R$ 3.083,34  → **gerado** (= 8.559,27 − 5.475,93), `CODGRUPO_DESCONTO_TITULO=221`
--   baixas: as duas com o MESMO valor e a obs `'DOCUMENTO BAIXADO VIA DESCONTO TITULO Nº: <o outro> |LOTE:<n>'`
--
-- Daí a regra única que reproduz os dois casos que o autor descreveu no comentário do `Gravar`
-- (uDescontoTitulo.pas:886) — a diferença entre os valores reais E a baixa parcial:
--
--   **abate-se o MENOR dos dois valores reais nos dois títulos; o que sobrar de cada um vira título novo.**
--
-- No exemplo do próprio autor (RCB 30 com real 10 × APG 12 integral): menor real = 10, abate 10 nos dois,
-- sobra 20 no RCB (título novo AR) e 2 no APG (título novo AP) — exatamente o que ele descreve.
--
-- ── O que o dado confirma, e uma coisa que ele CONTRADIZ ──────────────────────────────────────────────
--  · 18 operações, **sempre 1 RCB × 1 APG**, R$ 254.390,96 a receber e R$ 263.518,12 a pagar;
--  · as baixas batem casa a casa: **19 baixas de AR e 19 de AP, R$ 249.913,98 nas duas pontas** — porque
--    o valor abatido é sempre o menor, igual nos dois lados;
--  · 17 títulos gerados (9 AR de R$ 4.566,14 e 8 AP de R$ 15.370,32);
--  · o movimento de conta corrente existe (46 lançamentos com 'desconto de titulo' no histórico) e
--    **soma exatamente ZERO**: crédito de um lado, débito do outro, mesmo valor;
--  · ⚠️ **o comentário do autor diz que `COD_DESCONTO_TITULO` marca "todos" os títulos — o dado diz que
--    não.** O título GERADO fica com `COD_DESCONTO_TITULO` nulo e só `CODGRUPO_DESCONTO_TITULO`
--    preenchido. Seguimos o dado: é ele que sustenta a reversão sem apagar título alheio.
--
-- ── Reversão (uReverterDescontoTitulo.pas:247+) ───────────────────────────────────────────────────────
-- Apaga as baixas (`DELETE FROM ARECEBER_BX/APAGAR_BX`), volta `QUITADA='N'` e limpa
-- `COD_DESCONTO_TITULO` nos títulos originais, e **apaga os títulos gerados** — os que têm
-- `CODGRUPO_DESCONTO_TITULO` da operação. Aqui, a mais: a reversão é recusada se o título gerado já
-- tiver baixa própria (o legado apagaria o título e deixaria a baixa órfã).
CREATE SEQUENCE IF NOT EXISTS seq_desconto_titulo;
SELECT setval('seq_desconto_titulo', GREATEST(
  (SELECT coalesce(max(cod_desconto_titulo), 0) FROM areceber),
  (SELECT coalesce(max(cod_desconto_titulo), 0) FROM apagar),
  (SELECT coalesce(max(codgrupo_desconto_titulo), 0) FROM areceber),
  (SELECT coalesce(max(codgrupo_desconto_titulo), 0) FROM apagar), 1));

-- o lote das duas baixas (o legado usa `GetID('IDLOTE')`, o contador global de lotes de baixa)
CREATE SEQUENCE IF NOT EXISTS seq_idlote_desconto_titulo START 800000000;

CREATE INDEX IF NOT EXISTS ix_areceber_grupo_desc_titulo ON areceber (codgrupo_desconto_titulo)
  WHERE codgrupo_desconto_titulo IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_apagar_grupo_desc_titulo ON apagar (codgrupo_desconto_titulo)
  WHERE codgrupo_desconto_titulo IS NOT NULL;

-- executar e reverter são atos de dinheiro: grant próprio para cada um
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMDESCONTOTITULO', 'BTNGRAVAR',  7, 1),
  ('FRMDESCONTOTITULO', 'BTNREVERTER', 7, 1)
ON CONFLICT DO NOTHING;
