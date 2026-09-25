-- 348 — o cadastro de categorias e departamentos (FAMILIAS_PROD) ganha a tela: a lista traz o ATIVO (a coloração "Categoria Inativa" do
-- legado), a hierarquia do subgrupo e o EXCLUIDO (a exclusão é lógica, UCadFamiliaProd.pas:293-298).
CREATE OR REPLACE VIEW get_familias_prod AS
  SELECT codfamilia, codfamilia AS codigo, tipo, descricao, ativo, coddpto, codgrupo, codsecao, codsetor, excluido FROM familias_prod;
