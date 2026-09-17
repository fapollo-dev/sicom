-- 244 — RELATÓRIO DE PREÇOS ALTERADOS (`FRMRELPRECOSALTERADOS`). **35 acessos, 4 operadores.**
-- Que preços mudaram no período, **de quanto para quanto** e por quem. Duas origens, como no legado: o preço
-- em vigor (`multi_preco` por `DTULTPRECOALTERADO`) e o lote de alteração (`lote_preco` por `DATALOTE` —
-- 96.863 lotes no cliente, o último de hoje).
--
-- ── ⚠️ O relatório escondia MAIS DA METADE das alterações ─────────────────────────────────────────────
-- O legado usa **`JOIN HISTORICO_DINAMICO H ON H.CODHISTORICO = M.CODHISTORICO`** — INNER. E
-- `MULTI_PRECO.CODHISTORICO` está preenchido em apenas **87.708 de 203.615** linhas (43%). Medido em
-- agosto/2026 na empresa 1: **594 preços alterados, e o relatório mostrava 266** — **328 alterações (55,2%)**
-- não apareciam, por falta do vínculo com o histórico.
-- Aqui o join é LEFT: sem histórico o preço ANTERIOR fica vazio, mas a alteração aparece. Um relatório de
-- preços alterados que esconde metade das alterações não cumpre o que promete.
--
-- ── ⚠️ `ROWNUM = 1 ... ORDER BY` devolve linha arbitrária no Oracle ───────────────────────────────────
-- O outro dataset do data module busca o valor anterior com `AND ROWNUM = 1 ORDER BY CODHISTORICO DESC`. O
-- `ROWNUM` é aplicado **antes** do `ORDER BY`, então a linha é a que o plano entregar primeiro. Verificado no
-- produto **8242**, que tem 9 registros: o legado devolve **17,90** onde o correto é **12,99** — e
-- **11.999 de 15.300** produtos com histórico de preço têm mais de um registro.
--
-- A coluna que liga o preço ao histórico não existia no destino.
ALTER TABLE multi_preco ADD COLUMN IF NOT EXISTS codhistorico integer;
CREATE INDEX IF NOT EXISTS ix_multi_preco_hist ON multi_preco (codhistorico);
CREATE INDEX IF NOT EXISTS ix_multi_preco_dtalt ON multi_preco (idempresa, dtultprecoalterado);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELPRECOSALTERADOS', 'FRMRELPRECOSALTERADOS', 7, 1)
ON CONFLICT DO NOTHING;
