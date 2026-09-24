-- 337 — CODREFERENCIA_FOR: a unicidade é por PRODUTO, como o legado (UCadProduto.pas:5352-5362 checa IDPRODUTO;CODREF;CODFOR, e
-- só avisa). O índice único (codfor, codref) da 063 obrigava a carga a DESCARTAR 230 linhas de produção (76 chaves — hoje 135 — com
-- produtos diferentes; 103 inserções de 2025-26 pelo Retaguarda.exe e 34 pelo ImportaXMLMassa repetiram a referência de outro
-- produto). Em produção (idproduto, codfor, codref) não repete (0). A busca do recebimento segue pelo índice (codfor, codref).
DROP INDEX IF EXISTS ux_codref_for;
CREATE UNIQUE INDEX IF NOT EXISTS ux_codref_for_produto ON codreferencia_for (idproduto, codfor, codref);
CREATE INDEX IF NOT EXISTS ix_codref_for ON codreferencia_for (codfor, codref);
