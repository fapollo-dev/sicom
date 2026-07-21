-- 108 — CONTAS DEFAULT do plano de contas (CONFIG_PLANO_CONTAS For/Cli/Cxa/Bco), T1.4.
-- Fiel ao Oracle: CONFIG_PLANO_CONTAS tem, além da máscara (NDIG → mig 103), os apontadores das contas
-- contábeis PADRÃO por natureza de parceiro/recurso: FORNECEDOR / CLIENTE / CAIXA / BANCO, cada uma com
-- SINTÉTICA (conta-pai) e ANALÍTICA (a que recebe lançamento). Uso (uTron.pas): parceiro SEM conta própria
-- (PARCEIROS.CODCONTABIL/_FOR nula) herda a ANALÍTICA default (as "DIVERSOS"); o monorepo aplica isso como
-- FALLBACK no momento do lançamento contábil (baixa AR/AP + NF), sem mutar o parceiro (mesmo resultado contábil).
-- GOLDEN (CODCONFIG 1, TIPO='E', Oracle real): CODCONTAANALITICA_FOR=11141 ('2.1.01.01.14822' FORNECEDORES),
-- CODCONTAANALITICA_CLI=211 ('1.1.02.01.0001' CLIENTES DIVERSOS); sintéticas + CXA + BCO NULAS.
ALTER TABLE config_plano_contas ADD COLUMN IF NOT EXISTS codcontasintetica_for integer;
ALTER TABLE config_plano_contas ADD COLUMN IF NOT EXISTS codcontaanalitica_for integer;
ALTER TABLE config_plano_contas ADD COLUMN IF NOT EXISTS codcontasintetica_cli integer;
ALTER TABLE config_plano_contas ADD COLUMN IF NOT EXISTS codcontaanalitica_cli integer;
ALTER TABLE config_plano_contas ADD COLUMN IF NOT EXISTS codcontasintetica_cxa integer;
ALTER TABLE config_plano_contas ADD COLUMN IF NOT EXISTS codcontaanalitica_cxa integer;
ALTER TABLE config_plano_contas ADD COLUMN IF NOT EXISTS codcontasintetica_bco integer;
ALTER TABLE config_plano_contas ADD COLUMN IF NOT EXISTS codcontaanalitica_bco integer;

-- seed golden das analíticas (11141/211 já existem no plano_contas via 035/036/046, classe 'A').
UPDATE config_plano_contas
   SET codcontaanalitica_for = 11141,
       codcontaanalitica_cli = 211
 WHERE tipo = 'E';
