-- 076 — DEVOLUÇÃO DE COMPRA resíduo SPED c1: SITUAÇÃO OPERACIONAL da NF de devolução (idsituacao_nf).
--
-- Hoje o gerarNf da devolução cria a NF de saída SEM idsituacao_nf (header). No golden 536/539 NFs
-- finalidade=4 têm idsituacao_nf=17 ('VENDAS PDV') — os 4 CFOPs de devolução (5202/6202/5411/6411)
-- mapeiam→17 via ISITUACAO_NF (uPedidoDevolucaoCompra.pas:362-368/541-552: GetSQLSituacaoNF join
-- SITUACAO_NF WHERE TIPO='S'; SetCFOP→CodigoSituacaoNF). O gerarNf passa a resolver a situação do CFOP
-- de saída e carimbar nf.idsituacao_nf (header).
--
-- INERTE p/ o contábil: o auto-disparo (tentarContabilizar) é dirigido pelo RATEIO nf_contabil (que a
-- devolução NÃO popula), não pelo header idsituacao_nf → carimbar 17 não arma contabilização (RISK #1
-- da recon mitigado). Situação nova, não mapeada em itens_integracao_contabil → sem conta automática.
INSERT INTO situacao_nf (idsituacao_nf, descricao, tipo) VALUES
  (17, 'VENDAS PDV', 'S')
ON CONFLICT (idsituacao_nf) DO NOTHING;

-- de-para CFOP de SAÍDA → situação (idsituacao_nf_saida): os 4 CFOPs de devolução → 17. Espelha ISITUACAO_NF.
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS idsituacao_nf_saida integer REFERENCES situacao_nf(idsituacao_nf);
UPDATE cfop SET idsituacao_nf_saida = 17 WHERE codcfop IN ('5202', '6202', '5411', '6411') AND idsituacao_nf_saida IS NULL;
