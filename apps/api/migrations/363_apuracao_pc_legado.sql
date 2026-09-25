-- 363 — APURAÇÃO PIS/COFINS com o dado do legado (dossiê UapuracaoPISCOFINS.md, corte A).
--  · o ESCOPO é a raiz do CNPJ (as empresas 1 e 2 juntas) e IDEMPRESA fica NULL nas 18 apurações da produção: a coluna só é preenchida
--    com SELECIONAR_EMPRESA_APURACAO_GERACAO_SPED_CONTRIB = 'S' (a produção tem 'N'). O NOT NULL fazia a carga pôr tudo na empresa 1;
--  · sem unicidade no legado: o mesmo período não é refeito (a tela oferece carregar), e períodos sobrepostos convivem (61 × 101/102);
--  · ID_TIPOCREDITO é NUMBER no legado (101 crédito básico, 106 presumido, 202/299 …) e vem do PISCOFINS — o Apollo tinha '101' fixo em
--    varchar e o catálogo não tinha a coluna;
--  · APURACAO_PC_AJUSTE_M (os ajustes M110/M115/M220/M225/M510/M515/M620/M625 do binário novo; 0 linhas hoje): todos os campos.
ALTER TABLE apuracao_pc ALTER COLUMN idempresa DROP NOT NULL;
ALTER TABLE apuracao_pc DROP CONSTRAINT IF EXISTS apuracao_pc_idempresa_dataini_datafim_key;
CREATE INDEX IF NOT EXISTS ix_apuracao_pc_periodo ON apuracao_pc (dataini, datafim);
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'apuracao_pc_det' AND column_name = 'id_tipocredito') <> 'integer' THEN
    ALTER TABLE apuracao_pc_det ALTER COLUMN id_tipocredito TYPE integer USING nullif(trim(id_tipocredito::text), '')::integer;
  END IF;
END $$;

ALTER TABLE piscofins ADD COLUMN IF NOT EXISTS id_tipocredito integer;
-- as situações da base de desenvolvimento com o tipo de crédito da produção (a carga traz o do cliente)
UPDATE piscofins SET id_tipocredito = CASE idpiscofins WHEN 1 THEN 106 WHEN 11 THEN 106 WHEN 13 THEN 101 WHEN 10 THEN 101 WHEN 14 THEN 202
  WHEN 9 THEN 299 WHEN 12 THEN 299 END WHERE id_tipocredito IS NULL;

-- PC_BASECREDITO: a tabela 4.3.7 da EFD-Contribuições (NAT_BC_CRED), as 18 linhas da produção
INSERT INTO pc_basecredito (idbasecredito, descricao)
SELECT v.id, v.d FROM (VALUES
  (1, 'AQUISICAO DE BENS PARA REVENDA'), (2, 'AQUISICAO DE BEN UTILIZADOS COMO INSUMO'), (3, 'AQUISICAO DE SERVICOS UTILIZADOS COMO  INSUMO'),
  (4, 'ENERGIA ELETRICA E TERMICA, INCLUSIVE SOB A FORMA DE VAPOR'), (5, 'ALUGUEIS DE PREDIOS'), (6, 'ALUGUEIS DE MAQUINAS E EQUIPAMENTOS'),
  (7, 'ARMAZENAGEM DE MAERCADORIA E FRETE NA OPERACAO DE VENDA'), (8, 'CONTRAPRESTACOES DE ARRENDAMENTO MERCANTIL'),
  (9, 'MAQUINAS, EQUIPAMENTOS E OUTROS BENS INCORPORADOS AO ATIVO IMOBILIZADO (CREDITO SOBRE ENCARGOS DE DEPRECIACAO)'),
  (10, 'MAQUINAS, EQUIPAMENTOS E OUTROS BENS INCORPORADOS AO ATIVO IMOBILIZADO (CREDITO COM BASE NO VALOR DE AQUISICAO)'),
  (11, 'AMORTIZACAO E DEPRECIACAO DE EDIFICACOES E BENFEITORIAS EM IMOVEIS'), (12, 'DEVOLUCAO DE VENDAS SUJEITAS A INCIDENCIA NAO-CUMULATIVA'),
  (13, 'OUTRAS OPERACOES COM DIREITO A CREDITO'), (14, 'ATIVIDADE DE TRANPORTE DE CARGAS - SUBCONTRATACAO'),
  (15, 'ATIVIDADE IMOBILIARIA - CUSTO INCORRIDO DE UNIDADE IMOBILIARIA'), (16, 'ATIVIDADE IMOBILIARIA - CUSTO ORCADO DE UNIDADE NAO CONCLUIDA'),
  (17, 'ATIVIDADE DE PRESTACAO DE SERVICOS DE LIMPEZA, CONSERVACAO E MANUTENCAO - VALE TRANSPORTE, VALE REFEICAO OU VALE ALIMENTACAO, FARDAMENTO OU UNIFORME'),
  (18, 'ESTOQUE DE ABERTURA DE BENS')) AS v(id, d)
 WHERE NOT EXISTS (SELECT 1 FROM pc_basecredito b WHERE b.idbasecredito = v.id);

CREATE SEQUENCE IF NOT EXISTS seq_apuracao_pc_ajuste_m;
CREATE TABLE IF NOT EXISTS apuracao_pc_ajuste_m (
  codapuracao_pc_ajuste_m numeric(10,0) PRIMARY KEY DEFAULT nextval('seq_apuracao_pc_ajuste_m'),
  codapuracao_pc numeric(10,0) NOT NULL,
  reg_m varchar(4) NOT NULL,
  id_pai_ajuste numeric(10,0),
  cod_aj varchar(10),
  ind_aj char(1),
  vl_aj numeric(15,2),
  descr_aj varchar(255),
  num_doc varchar(15),
  dt_ref date,
  det_valor_aj numeric(15,2),
  cst varchar(2),
  det_bc_cred numeric(15,2),
  det_aliq numeric(8,4),
  dt_oper_aj date,
  cod_cta varchar(60),
  desc_aj varchar(255),
  info_compl varchar(255),
  cod_part varchar(60),
  cod_mod varchar(2),
  ser varchar(4),
  cod_item varchar(60)
);
ALTER SEQUENCE seq_apuracao_pc_ajuste_m OWNED BY apuracao_pc_ajuste_m.codapuracao_pc_ajuste_m;
CREATE INDEX IF NOT EXISTS ix_apuracao_pc_ajuste_m ON apuracao_pc_ajuste_m (codapuracao_pc);

-- as configurações que a apuração lê (as linhas da produção)
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 820) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 820 END,
       'SELECIONAR_EMPRESA_APURACAO_GERACAO_SPED_CONTRIB', 'N', 'String',
       'Define se vai solicitar empresa na Apuracao e na Geracao do Sped Contribuicoes.', 'S;N|Sim;Nao', 'Modulo', 'SPED PIS/COFINS',
       'Define se vai solicitar empresa na Apuracao e na Geracao do Sped Contribuicoes.'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'SELECIONAR_EMPRESA_APURACAO_GERACAO_SPED_CONTRIB');
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 811) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 811 END,
       'FILTRAR_CFOP_CALCULO_PIS_COFINS_BASE_ENT', '1407, 1556, 1653, 1908, 1910, 2556, 2910, 1949', 'String',
       'Filtrar os CFOPs base informados na apuração e na geração do Sped Contribuições.', '', 'Modulo;Empresa', 'SPED PIS/COFINS',
       'Filtrar os CFOPs base informados na apuração e na geração do Sped Contribuições.'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'FILTRAR_CFOP_CALCULO_PIS_COFINS_BASE_ENT');
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 293) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 293 END,
       'CONSIDERA_NFCE_CONTINGENCIA_SPED_FISCAL', 'N', 'String', 'Considerar NFCe com status em contingência.', 'S;N|Sim;Nao', 'Modulo', 'Sped',
       'Considerar NFCe com status em contingência.'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'CONSIDERA_NFCE_CONTINGENCIA_SPED_FISCAL');
