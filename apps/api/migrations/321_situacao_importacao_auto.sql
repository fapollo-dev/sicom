-- 321 — a lista de situações passa a trazer a IMPORTAÇÃO AUTOMÁTICA (IMPORTACAO_AUTO_NF): escolher na NF de saída uma
-- situação com 'SC' abre a importação do SCRAP (uNF.pas:14396; UCadSituacaoNF.md C6). Coluna nova no FIM da view.
CREATE OR REPLACE VIEW get_situacao_nf AS
SELECT s.idsituacao_nf, s.idsituacao_nf AS codigo, s.descricao, s.tipo, s.tipo_operacao,
       coalesce(s.ativo, 'S') AS ativo, s.nao_realiza_integracao,
       (SELECT count(*) FROM isituacao_nf i WHERE i.idsituacao_nf = s.idsituacao_nf) AS qtde_cfop,
       s.importacao_auto_nf
  FROM situacao_nf s;
