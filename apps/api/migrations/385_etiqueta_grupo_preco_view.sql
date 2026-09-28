-- 385 — a view da fila de etiquetas juntava o grupo de preço com `familias_prod.tipo = 'R'`; na produção o grupo de preço é
-- TIPO 'P' (1.532 famílias, 9.396 produtos; 'R' tem 1) e a view do legado (GET_ETIQUETA_CONS_PROD) junta SEM filtro de tipo
-- (`LEFT JOIN FAMILIAS_PROD GP ON (GP.CODFAMILIA = PRO.CODGRUPOPRECO)`). Fiel: sem filtro.
CREATE OR REPLACE VIEW get_etiqueta_fila AS
  SELECT e.idetiqueta, e.idproduto, e.idempresa, e.impressa, e.data_consulta, e.operador,
         p.codbarra, p.unidade, p.descricao AS descricao_produto,
         gp.descricao AS descricao_grupo,
         COALESCE(NULLIF(p.fator_filho, 0), 1) AS fator,
         COALESCE(NULLIF(p.prod_qtde_etiquetas, 0), 1) AS qtde_etiquetas,
         mp.vrvenda, mp.vrpromo, COALESCE(mp.promocao, 'N') AS promocao, mp.etq_impressa
  FROM etiqueta_cons_prod e
  JOIN produtos p ON p.idproduto = e.idproduto
  LEFT JOIN multi_preco mp ON mp.idproduto = e.idproduto AND mp.idempresa = e.idempresa
  LEFT JOIN familias_prod gp ON gp.codfamilia = p.codgrupopreco;

-- fixture do seed (operador 7, lojas 1 e 2): as telas que abrem a de etiquetas por Create (agenda, ajuste de preços)
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT x.form, x.form, 7, e.emp
  FROM (VALUES ('FRMCADAGENDAPROMOCAO'), ('FRMAJUSTEPRECOS')) AS x(form)
 CROSS JOIN (VALUES (1), (2)) AS e(emp)
ON CONFLICT DO NOTHING;
