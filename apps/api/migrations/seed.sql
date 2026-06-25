-- Seed real extraído de pinheirao.BANCOS (homologação Oracle), 15 linhas.
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (1,'0204.001','BANCO DO BRASIL','ITBA-MG',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (2,'0106.341','ITAU','ITBA-MG/CENTRO',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (3,'0166.275','BANCO REAL','ITBA-MG',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (4,'0862.399','BMU','ITBA-MG',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (5,'3251.237','BRADESCO','ITBA-MG',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (6,'0784.001','BANCO DO BRASIL','CAPINOPOLIS-MG',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (7,'0071.022','BANCO REAL','ITBA-MG',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (8,'1745.341','ITAU','ITBA-MG/NESTLE',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (9,'1944.104','CAIXA ECONOMICA FEDERAL','CAPINOPOLIS-MG',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (10,'0280.389','MERCANTIL','ITBA-MG',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (11,'0269.001','BANCO DO BRASIL','JABOTICABAL-SP',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (12,'0753.341','ITAU','S VITORIA-MG',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (13,'2319.001','BANCO DO BRASIL','MTE ALEGRE-MG',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (14,'0277.048','BEMGE','CANAPOLIS-MG',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO bancos (codbco,agencia,banco,cidade,uf,agencia_cedente,codbcoblt,convenio,carteira_cobranca,variacao_carteira) VALUES (15,'0125.104','CAIXA ECONOMICA FEDERAL','ITBA-MG',NULL,NULL,NULL,NULL,NULL,NULL);
-- avança a sequence para além do seed (próximo INSERT = 16+)
SELECT setval('seq_bancos_codbco', (SELECT max(codbco) FROM bancos));
