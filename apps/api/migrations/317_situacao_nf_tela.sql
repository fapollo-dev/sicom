-- 317 — SITUAÇÃO DO DOCUMENTO: a tela (`FRMCADSITUACAONF`, `UCadSituacaoNF`; dossiê UCadSituacaoNF.md, C1).
--
-- A tela não estava na fila nem no placar: o Apollo tinha só uma API de consulta com descrição e tipo. O legado tem ~27
-- campos e 4 detalhes — CFOPs permitidos (ISITUACAO_NF), centros de custo (SITUACAO_NF_PLC), parceiros
-- (SITUACAO_NF_PARCEIROS) e a integração contábil (ITENS_INTEGRACAO_CONTABIL, `codoperacao` = a situação).
-- Os ids são sequências no legado (`ID_IDSITUACAO_NF` em 3680, `ID_IDISITUACAO_NF` em 3160): aqui `OWNED BY`, que a
-- carga reposiciona no max(id). (A descrição, VARCHAR2(100) no legado e varchar(80) aqui, alarga na mig 318.)

CREATE SEQUENCE IF NOT EXISTS seq_situacao_nf;
ALTER SEQUENCE seq_situacao_nf OWNED BY situacao_nf.idsituacao_nf;
SELECT setval('seq_situacao_nf', greatest(coalesce((SELECT max(idsituacao_nf) FROM situacao_nf), 0) + 1, 3681), false);
ALTER TABLE situacao_nf ALTER COLUMN idsituacao_nf SET DEFAULT nextval('seq_situacao_nf');

CREATE SEQUENCE IF NOT EXISTS seq_isituacao_nf;
ALTER SEQUENCE seq_isituacao_nf OWNED BY isituacao_nf.idisituacao_nf;
SELECT setval('seq_isituacao_nf', greatest(coalesce((SELECT max(idisituacao_nf) FROM isituacao_nf), 0) + 1, 3161)::bigint, false);
ALTER TABLE isituacao_nf ALTER COLUMN idisituacao_nf SET DEFAULT nextval('seq_isituacao_nf');
CREATE INDEX IF NOT EXISTS ix_isituacao_nf_sit ON isituacao_nf (idsituacao_nf);
CREATE INDEX IF NOT EXISTS ix_isituacao_nf_cfop ON isituacao_nf (codcfop);

-- a pesquisa: o que a tela e os seletores das outras telas filtram (tipo, tipo de operação, se tem CFOP)
DROP VIEW IF EXISTS get_situacao_nf;
CREATE VIEW get_situacao_nf AS
SELECT s.idsituacao_nf, s.idsituacao_nf AS codigo, s.descricao, s.tipo, s.tipo_operacao,
       coalesce(s.ativo, 'S') AS ativo, s.nao_realiza_integracao,
       (SELECT count(*) FROM isituacao_nf i WHERE i.idsituacao_nf = s.idsituacao_nf) AS qtde_cfop
  FROM situacao_nf s;
