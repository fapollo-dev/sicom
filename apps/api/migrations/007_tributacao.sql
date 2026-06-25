-- FISCAL: REUSA a regra do legado (DET_ALIQUOTA) + DESENVOLVE a Reforma por cima.
-- DET_ALIQUOTA resolve, por (ALIQUOTA, UF): ICM, ICM_EFETIVO (pós redução de base),
-- BASE, CST (00=tributado, 20=redução, 40=isento, 60=ST) e LEI (a fonte legal).
CREATE TABLE IF NOT EXISTS det_aliquota (
  aliquota   varchar(6)  NOT NULL,
  uf         char(2)     NOT NULL,
  icm        numeric(7,2) NOT NULL DEFAULT 0,
  icm_efetivo numeric(7,2) NOT NULL DEFAULT 0,
  base       numeric(7,2) NOT NULL DEFAULT 0,
  cst        integer     NOT NULL DEFAULT 0,
  csosn      varchar(4),
  descricao  varchar(120),
  lei        varchar(200),
  PRIMARY KEY (aliquota, uf)
);

-- Seed REAL extraído de pinheirao.DET_ALIQUOTA (homologação).
INSERT INTO det_aliquota (aliquota,uf,icm,icm_efetivo,base,cst,csosn,descricao,lei) VALUES
 ('IST','SP',0.0,0.0,0.0,40,NULL,NULL,NULL),
 ('NTB','SP',0.0,0.0,0.0,0,NULL,NULL,NULL),
 ('STB','SP',0.0,0.0,0.0,60,NULL,NULL,NULL),
 ('T01','SP',17.0,17.0,100.0,0,NULL,NULL,NULL),
 ('T02','SP',12.0,12.0,100.0,0,NULL,NULL,NULL),
 ('T04','SP',3.0,3.0,100.0,0,NULL,NULL,NULL),
 ('T10','GO',12.0,7.0,41.66,20,NULL,'COM REDUCAO DE BASE','ARTIGO 8, INCISO XXXIII, ANEXO IX, RCTE/GO'),
 ('T12','GO',19.0,7.0,63.16,20,NULL,'REDUCAO / CESTA BASICA','ARTIGO 8, INCISO XXXIII, ANEXO IX, RCTE/GO'),
 ('T56','MG',18.0,8.4,53.33,20,NULL,'TRIBUTADO 18% COM REDUCAO PARA 8,40%',NULL);

-- DESENVOLVIDO (novo): Reforma Tributária (IBS+CBS+IS) por UF e vigência — mesmo padrão
-- parametrizável (vigência + fonte). Resolução escolhe a vigência mais recente <= data ref.
CREATE TABLE IF NOT EXISTS tributacao_reforma (
  uf              char(2) NOT NULL,
  vigencia_inicio date    NOT NULL,
  ibs             numeric(7,2) NOT NULL DEFAULT 0,
  cbs             numeric(7,2) NOT NULL DEFAULT 0,
  imposto_seletivo numeric(7,2) NOT NULL DEFAULT 0,
  fonte           varchar(200) NOT NULL,
  PRIMARY KEY (uf, vigencia_inicio)
);
INSERT INTO tributacao_reforma (uf, vigencia_inicio, ibs, cbs, imposto_seletivo, fonte) VALUES
 ('SP','2026-01-01',0.1,0.9,0,'EC 132/2023 + LC 214/2025 (fase-teste 2026)'),
 ('MG','2026-01-01',0.1,0.9,0,'EC 132/2023 + LC 214/2025 (fase-teste 2026)'),
 ('SP','2033-01-01',17.7,8.8,0,'EC 132/2023 (regime pleno — alíquotas de referência ilustrativas)');
