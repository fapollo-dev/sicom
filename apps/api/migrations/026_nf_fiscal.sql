-- NOTA FISCAL — Fase 2: cálculo fiscal por item (REUSO do motor precificacao).
-- Acrescenta as colunas de destaque por item que faltavam e semeia det_aliquota para a UF
-- dos parceiros do seed (MA), p/ o recálculo da NF semeada resolver (resolverAtual exige a
-- linha (aliquota,uf)). O cálculo em si vive em nf-fiscal.service.ts (reusa FiscalPricingService
-- + TributacaoRepository); nada de motor novo. Doc: dossiê uNF.md §7/§10.

-- Colunas fiscais por item (destaque). `ipi` (já em 025) é a ALÍQUOTA %; `vripi` é o valor.
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS bcr   numeric(13,4);          -- % base reduzida ICMS (legado NF_PROD.BCR NUMBER(13,4))
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vripi numeric(13,2) DEFAULT 0; -- valor do IPI (= TOTALPRODS * ipi% / 100)
-- flags GERAICM_* (compõem a base do ICMS próprio); default 'N' = caso revenda dominante.
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS geraicm_ipi   char(1) DEFAULT 'N';
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS geraicm_frete char(1) DEFAULT 'N';
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS geraicm_acess char(1) DEFAULT 'N';

-- det_aliquota p/ MA — os parceiros do seed (014) têm UF='MA'; hoje só há SP/GO/MG.
-- Sem isso, resolverAtual('T01','MA') lançaria ALIQUOTA_NAO_CADASTRADA no recálculo.
INSERT INTO det_aliquota (aliquota,uf,icm,icm_efetivo,base,cst,csosn,descricao,lei) VALUES
 ('IST','MA',0.0,0.0,0.0,40,NULL,'ISENTO',NULL),
 ('NTB','MA',0.0,0.0,0.0,0,NULL,'NAO TRIBUTADO',NULL),
 ('STB','MA',0.0,0.0,0.0,60,NULL,'SUBSTITUICAO TRIBUTARIA',NULL),
 ('T01','MA',22.0,22.0,100.0,0,NULL,'TRIBUTADO INTEGRAL (MA 22%)',NULL),
 ('T02','MA',12.0,12.0,100.0,0,NULL,'INTERESTADUAL 12%',NULL),
 -- alíquota COM redução de base (icm cheia 22% / efetiva 12% / base 54,55%) — prova que o
 -- destaque usa a alíquota CHEIA sobre a base reduzida (a redução NÃO é aplicada 2×).
 ('T20','MA',22.0,12.0,54.55,20,NULL,'TRIBUTADO 22% COM REDUCAO PARA 12%',NULL)
ON CONFLICT (aliquota,uf) DO NOTHING;
