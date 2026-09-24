-- 336 — CONTROLE DE CONTAS: as opções REAIS do legado (`PERMISSOES`, FORM='FRMCONTROLECONTASBANCARIAS'): a tela,
-- BTNFECHA (transferência/remover), BTNLIBERAR, BTNLANCSALDO, BITBTN2 (chavear) e BTNTROCAVALORES. A 125 semeou
-- BTNGRAVAR/BTNEXCLUIR, que não existem para esse form; a carga traz as reais. Semente de desenvolvimento para o op 7,
-- como a 125 fazia (uControleContasBancarias-spec.md §6).
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT 'FRMCONTROLECONTASBANCARIAS', o, 7, e
  FROM (VALUES ('FRMCONTROLECONTASBANCARIAS'), ('BTNFECHA'), ('BTNLIBERAR'), ('BTNLANCSALDO'), ('BITBTN2')) v(o)
 CROSS JOIN (VALUES (1), (2)) emp(e)
 WHERE EXISTS (SELECT 1 FROM operadores WHERE codoperador = 7)
   AND NOT EXISTS (SELECT 1 FROM permissoes p WHERE p.form = 'FRMCONTROLECONTASBANCARIAS' AND p.opcao = v.o AND p.codoperador = 7 AND p.codempresa = emp.e);
