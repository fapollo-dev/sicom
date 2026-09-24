-- 331 — AGRUPAMENTO DE CONTAS A RECEBER/PAGAR no modelo do legado (dossiê uAgrupaContas.md). Sem mudança de estrutura: o
-- consolidado volta a ser AGRUPAMENTO='S' (ORIGEM nula) e o vínculo dos membros é o CODGRUPO do consolidado — as colunas já
-- existem e vêm na carga como estão. Aqui só o RBAC com os nomes do legado (a tela de agrupar; reverter/adicionar/remover do
-- A Receber são do menu do contas a receber, sem componente; o reverter do A Pagar é FRMAPAGAR.BTNREVERTERAGRUPAMENTO) para o
-- operador de desenvolvimento/smoke; as concessões do cliente vêm na carga.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT v.form, v.opcao, 7, e.e
  FROM (VALUES ('FRMAGRUPACONTASARECEBER', 'FRMAGRUPACONTASARECEBER'), ('FRMAGRUPACONTASAPAGAR', 'FRMAGRUPACONTASAPAGAR'),
               ('FRMAPAGAR', 'BTNREVERTERAGRUPAMENTO'), ('FRMCADARECEBER', 'FRMCADARECEBER')) AS v(form, opcao),
       (VALUES (1), (2)) AS e(e)
 WHERE NOT EXISTS (SELECT 1 FROM permissoes p WHERE p.form = v.form AND p.opcao = v.opcao AND p.codoperador = 7 AND p.codempresa = e.e);
