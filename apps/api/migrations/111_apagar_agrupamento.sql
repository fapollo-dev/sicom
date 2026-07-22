-- 111 — AGRUPAMENTO de CONTAS A PAGAR in-place (uAgrupaContasAPagar) — GÊMEO do AR (mig 110). Consolida N
-- títulos ABERTOS de um mesmo FORNECEDOR num título CONSOLIDADO (ORIGEM='A', valor = Σ dos membros): os
-- originais ficam AGRUPADO='S' + CODGRUPO_AGRUPAMENTO_APG = codapg do consolidado (ocultos dos "abertos"). Mesma
-- semântica/travas do AR (reverter/remover-título; TOTAL derivado na view get_apagar → sem o bug do legado).
-- A mig 045 já trouxe `agrupado`; faltam o vínculo do grupo e a data.
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS codgrupo_agrupamento_apg integer;      -- → codapg do CONSOLIDADO
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS data_agrupamento         timestamptz;  -- quando foi agrupado

CREATE INDEX IF NOT EXISTS ix_apagar_agrupamento ON apagar (codgrupo_agrupamento_apg) WHERE codgrupo_agrupamento_apg IS NOT NULL;

-- RBAC da tela de agrupamento (uAgrupaContasAPagar = FRMAGRUPAPAGAR).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMAGRUPAPAGAR', 'BTNAGRUPAR',  7, 1),
  ('FRMAGRUPAPAGAR', 'BTNAGRUPAR',  7, 2),
  ('FRMAGRUPAPAGAR', 'BTNREVERTER', 7, 1),
  ('FRMAGRUPAPAGAR', 'BTNREVERTER', 7, 2);
