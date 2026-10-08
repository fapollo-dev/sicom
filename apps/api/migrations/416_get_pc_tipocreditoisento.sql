-- GET_PC_TIPOCREDITOISENTO — a Pesquisa da NATUREZA do produto (edtNatureza, UCadProduto.pas:4241-4251: IDPISCOFINS = o do produto; o
-- IDTABELA escolhido vai para o produto). As colunas da produção (ALL_TAB_COLUMNS, só leitura, 08/10/2026): IDTABELA, IDPISCOFINS,
-- IDBASECREDITOISENTO e DESCRICAO = 'código - descrição'.
CREATE OR REPLACE VIEW get_pc_tipocreditoisento AS
SELECT idtabela,
       idpiscofins,
       idbasecreditoisento,
       CAST(idbasecreditoisento AS varchar(20)) || ' - ' || descricao AS descricao
  FROM pc_tipocreditoisento;
