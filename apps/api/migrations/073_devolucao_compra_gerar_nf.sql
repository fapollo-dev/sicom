-- 073 — DEVOLUÇÃO DE COMPRA corte-2: Gerar NF de Devolução (RBAC + vínculo IN-ROW anti-duplo).
-- Vínculo IN-ROW na NF (padrão do RECEBIMENTO nf.codpedcomp): `nf.cod_ped_dev_compra` + UNIQUE parcial →
-- a 2ª geração para a mesma devolução VIOLA a UNIQUE e rola back (0 duplicata), mesmo sob crash/erro no
-- caminho de vínculo (fold ALTA/MÉDIA da auditoria). Atômico com a criação da NF (não é um UPDATE separado).
ALTER TABLE nf ADD COLUMN IF NOT EXISTS cod_ped_dev_compra integer; -- devolução de compra que gerou esta NF de saída
CREATE UNIQUE INDEX IF NOT EXISTS ux_nf_cod_ped_dev_compra ON nf (cod_ped_dev_compra) WHERE cod_ped_dev_compra IS NOT NULL;

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMDEVOLUCAOCOMPRA', 'BTNGERARNF', 7, 1), ('FRMDEVOLUCAOCOMPRA', 'BTNGERARNF', 7, 2)
ON CONFLICT DO NOTHING;
