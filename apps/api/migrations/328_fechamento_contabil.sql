-- 328 — FECHAMENTO DE CAIXA, corte 3: a contabilização (TIntegracaoFechamentoCaixa) e a reabertura.
-- As situações e as contas são as da produção (CONFIG_INTEGRACAO_CONTABIL e ITENS_INTEGRACAO_CONTABIL, 24/09/2026):
--   2010 fechamento por forma  D automática (a conta da forma) / C 200 — hist 83 (já na mig 106)
--   2019 sobra                 D 183 / C 541                    — hist 84
--   2002 quebra sem título     D 148 / C 183                    — hist 103
--    785 quebra com título     D 211 / C 200                    — hist 85 (o contas a receber do título 'Q')
--   3260 troco solidário       D 183 / C 11141                  — hist 181 (o contas a pagar do título 'T')
-- A carga traz as linhas do cliente; aqui só o que falta numa instalação nova (nada é sobrescrito).

INSERT INTO plano_contas (codplanocontas, descricao, tipo, status) VALUES
  (211, 'CLIENTES',                  'E', 'A'),
  (11141, 'FORNECEDORES DIVERSOS',   'E', 'A')
ON CONFLICT (codplanocontas) DO NOTHING;

INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil, codhistorico)
SELECT * FROM (VALUES
  (785,  'D', 'F', 211,   85),
  (785,  'C', 'F', 200,   85),
  (3260, 'D', 'F', 183,   181),
  (3260, 'C', 'F', 11141, 181)
) AS v(codoperacao, natureza, tipo, codconta_contabil, codhistorico)
WHERE NOT EXISTS (SELECT 1 FROM itens_integracao_contabil i WHERE i.codoperacao = v.codoperacao AND i.natureza = v.natureza);

-- a mig 053 semeou a sobra e a quebra sem o histórico
UPDATE itens_integracao_contabil SET codhistorico = 84  WHERE codoperacao = 2019 AND codhistorico IS NULL;
UPDATE itens_integracao_contabil SET codhistorico = 103 WHERE codoperacao = 2002 AND codhistorico IS NULL;

UPDATE config_integracao_contabil SET
  config_fechamentocaixa = coalesce(config_fechamentocaixa, 2010),
  config_sobracaixa      = coalesce(config_sobracaixa,      2019),
  config_faltacaixa      = coalesce(config_faltacaixa,      2002),
  config_quebracaixarcb  = coalesce(config_quebracaixarcb,  785),
  config_troco_solidario = coalesce(config_troco_solidario, 3260);

-- o estorno por grupo procura a linha da forma pelo COMPLEMENTO (o grupo) e a quebra/sobra pelo TIPODOC
CREATE INDEX IF NOT EXISTS ix_diario_origem_complemento ON diario (codorigem, complemento);
CREATE INDEX IF NOT EXISTS ix_saldo_operador_codrcb ON saldo_operador (codrcb);
CREATE INDEX IF NOT EXISTS ix_apagar_codgrupo_fcx ON apagar (codgrupo_fcx);
