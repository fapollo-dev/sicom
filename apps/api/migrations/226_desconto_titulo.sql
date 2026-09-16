-- 226 — DESCONTO DE TÍTULOS (`FRMDESCONTOTITULO`), corte-1. 68 acessos, **11 operadores**.
--
-- ⚠️ **Não é desconto bancário de duplicata — é ENCONTRO DE CONTAS.** O próprio autor do legado documentou a
-- mecânica num comentário dentro do `Gravar` (`uDescontoTitulo.pas:886`), e vale transcrever a regra:
--
--   · o operador escolhe um título **a receber** e um **a pagar** e informa o **VALOR REAL** de cada — quanto
--     quer usar de cada título;
--   · **o menor valor é abatido no de maior valor**, e a diferença **gera um novo título** (a receber ou a
--     pagar, conforme o lado que sobrou);
--   · o título cujo valor é maior que o "valor real" é **baixado parcialmente**, e o restante vira outro
--     título novo;
--   · `COD_DESCONTO_TITULO` marca **todos** os títulos da operação; `CODGRUPO_DESCONTO_TITULO` marca só o
--     **novo título gerado da diferença**. É esse par que permite **reverter** a operação inteira depois.
--
-- Exemplo do próprio autor: RCB de 30,00 com valor real 10,00 contra APG de 12,00 integral. 12 − 10 = 2,00 de
-- título novo; e o RCB de 30,00 é baixado parcialmente para ficar em 10,00, gerando outro título de 20,00.
--
-- ── Uso real (produção, 16/09/2026) ─────────────────────────────────────────────────────────────────────
-- **18 operações** — mas **R$ 254.390,96** em títulos a receber e **R$ 263.518,12** em títulos a pagar, e a
-- última em **12/09/2026**. Não é volume, é valor: média de 14 mil por operação, e o mecanismo está ativo.
--
-- ── A coluna que faltava ────────────────────────────────────────────────────────────────────────────────
-- `COD_DESCONTO_TITULO` já vinha nas duas tabelas. `CODGRUPO_DESCONTO_TITULO` não — e é justamente a que
-- identifica o título gerado pela diferença. Sem ela não há como saber o que foi criado pela operação, e a
-- reversão fica cega.
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS codgrupo_desconto_titulo integer;
ALTER TABLE apagar   ADD COLUMN IF NOT EXISTS codgrupo_desconto_titulo integer;

CREATE INDEX IF NOT EXISTS ix_areceber_desc_titulo ON areceber (cod_desconto_titulo)
  WHERE cod_desconto_titulo IS NOT NULL AND cod_desconto_titulo > 0;
CREATE INDEX IF NOT EXISTS ix_apagar_desc_titulo   ON apagar (cod_desconto_titulo)
  WHERE cod_desconto_titulo IS NOT NULL AND cod_desconto_titulo > 0;

INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMDESCONTOTITULO', 'FRMDESCONTOTITULO', 7, 1)
ON CONFLICT DO NOTHING;
