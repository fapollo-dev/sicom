-- 110 — AGRUPAMENTO de CONTAS A RECEBER in-place (uAgrupaContasAReceber). Agrupar N títulos ABERTOS de um
-- mesmo cliente num TÍTULO CONSOLIDADO (valor = Σ dos membros): os originais ficam AGRUPADO='S' +
-- CODGRUPO_AGRUPAMENTO_RCB = codrcb do consolidado (ocultos dos "abertos", não some do sistema); o consolidado
-- (ORIGEM='A') é o título ativo/cobrável. Reverter (se o consolidado não foi quitado/baixado) limpa os flags e
-- apaga o consolidado; remover-título tira 1 membro e abate o valor do consolidado (AtualizaValoresAgrupamento —
-- SEM o bug do legado de derivar TOTAL de VALOR: aqui TOTAL é sempre calculado na view get_areceber).
-- A mig 043 já trouxe `agrupado`; faltam o vínculo do grupo e a data do agrupamento.
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS codgrupo_agrupamento_rcb integer;      -- → codrcb do CONSOLIDADO
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS data_agrupamento         timestamptz;  -- quando foi agrupado

CREATE INDEX IF NOT EXISTS ix_areceber_agrupamento ON areceber (codgrupo_agrupamento_rcb) WHERE codgrupo_agrupamento_rcb IS NOT NULL;

-- RBAC da tela de agrupamento (uAgrupaContasAReceber = FRMAGRUPARECEBER).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMAGRUPARECEBER', 'BTNAGRUPAR',  7, 1),
  ('FRMAGRUPARECEBER', 'BTNAGRUPAR',  7, 2),
  ('FRMAGRUPARECEBER', 'BTNREVERTER', 7, 1),
  ('FRMAGRUPARECEBER', 'BTNREVERTER', 7, 2);
