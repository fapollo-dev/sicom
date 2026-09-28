-- 384 — "Excluir movimentação OFX" da conciliação bancária (binário novo, `FRMCONCILIACAOBANCARIA.BTNPERMISSAOEXCLUIROFX`,
-- 27 operadores na produção). Fixture do seed (operador 7, lojas 1 e 2); a carga traz as PERMISSOES reais.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT 'FRMCONCILIACAOBANCARIA', x.opcao, 7, e.emp
  FROM (VALUES ('FRMCONCILIACAOBANCARIA'), ('BTNPERMISSAOEXCLUIROFX')) AS x(opcao)
 CROSS JOIN (VALUES (1), (2)) AS e(emp)
ON CONFLICT DO NOTHING;
