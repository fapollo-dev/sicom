-- NOTA FISCAL — Fase 2b: refino fiscal (ARREDONDA por item + ST profundo do TIndexadorTributario).
-- ARREDONDA: arredonda('S')/trunca('N') por item (golden: 77,7% S / 22,3% N — diferença de centavo).
-- ST profundo: MVA ajustado interestadual + redução de BC-ST (REDCOM) + FEM, caminho Lucro Real.
-- Todas as colunas novas têm DEFAULT no-op (ARREDONDA='S', REDCOM=100, FEM=0, TP_FIGURA='N') →
-- backward-compatible (o cálculo clássico não muda; ST só refina quando a config opta).
-- Doc: dossiê uNF.md §7 + "### F2b". SEM trigger.

-- nf_prod: flag de arredondamento por item + despesas acessórias (coluna correta p/ base ICMS).
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS arredonda char(1) DEFAULT 'S'; -- S=arredonda / N=trunca
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS depsacess numeric(13,2) DEFAULT 0; -- despesas acessórias (× BCR na base)

-- indexador_tributario: parâmetros do ST profundo (REDCOM/FEM/figura do fornecedor). reducao/st_externo já existem.
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS redcom numeric(7,2) DEFAULT 100; -- % da BC-ST (100=sem redução)
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS aliquota_fem numeric(7,2) DEFAULT 0; -- FEM (denominador do MVA ajustado)
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS tp_figura char(1) DEFAULT 'N'; -- 'S'=fornecedor Simples (pula MVA ajustado)

-- NOTA: NÃO "corrigir" det_aliquota GO/MG para icm_efetivo = icm×base/100. O ICM_EFETIVO do legado é
-- a alíquota efetiva REAL por regra legal (T56/MG = 8,40%, NÃO 18×53,33/100=9,6) — base e efetiva são
-- INDEPENDENTES. O precificacao usa ICM_EFETIVO direto; para as alíquotas usadas na NF (MA: T01/T20/STB)
-- base×icm = efetiva coincide; a divergência GO/MG é o resíduo documentado de representação (F2b §10).

-- NCM de teste do ST profundo: exercita MVA ajustado (FEM>0, icmFonte≠aliqDest) + redução de BC-ST (redcom<100).
INSERT INTO indexador_tributario (ncm, aliquota_dest, icm_fonte, mva, reducao, st_externo, redcom, aliquota_fem, tp_figura) VALUES
 ('99999999', 18.0, 12.0, 40.0, 100.0, 'N', 70.0, 2.0, 'N')
ON CONFLICT (ncm) DO NOTHING;
