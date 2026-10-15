-- 431 — OPERADORAS DE CARTÃO (FRMCADOPERADORAS, UcadOperadoras.pas): a Pesquisa da rede do grupo TEF (`BtnBuscaRedeClick` →
-- GET_REDE: CODIGO = IDREDE, DESCRICAO = REDE; 17 redes na produção). Não está no catálogo do construtor: sem COMMENT.
CREATE OR REPLACE VIEW get_rede (codigo, descricao) AS
  SELECT idrede, rede FROM rede;
