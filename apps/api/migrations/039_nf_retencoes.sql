-- NF A1: CÁLCULO DE RETENÇÕES no cabeçalho (CalcularRetencoes, udmNF.pas:3558). Retenções de ENTRADA
-- (serviço com retenção): PIS/COFINS/CSLL/IR/INSS/ISSQN/FUNRURAL = base × alíquota/100. Gate:
-- TIPO='E' + parceiro + SITUACAO_NF.TIPO_OPERACAO='E03' (SituacaoGeraRetencao, udmNF:5356) + totalnf>0.
-- Alíquotas vêm da camada de config (ALIQUOTA_RETENCAO_*, por Modulo/Empresa) EXCETO IR/ISSQN, que
-- preferem PERC_ALIQUOTA_IR/ISSQN do parceiro. Bases: IRRF/PIS/COFINS/CSLL/IR sobre
-- BASE_RET_IRRF_PISCOFINS_CSLL (default TOTALNF); INSS sobre BASE_RETENCAO_INSS (default TOTALNF);
-- ISSQN/FUNRURAL sobre TOTALNOTA (=TOTALNF). FUNRURAL tem gate próprio por lista de CFOP.

-- gate de situação (SituacaoGeraRetencao): TIPO_OPERACAO='E03'.
ALTER TABLE situacao_nf ADD COLUMN IF NOT EXISTS tipo_operacao varchar(4);
INSERT INTO situacao_nf (idsituacao_nf, descricao, tipo, tipo_operacao) VALUES
  (1031, 'SERVICOS COM RETENCAO', 'E', 'E03')
ON CONFLICT (idsituacao_nf) DO UPDATE SET tipo_operacao = EXCLUDED.tipo_operacao;

-- totais + bases de retenção no cabeçalho da NF.
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_ret_pis      numeric(13,2) DEFAULT 0;
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_ret_cofins   numeric(13,2) DEFAULT 0;
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_ret_csll     numeric(13,2) DEFAULT 0;
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_ret_ir       numeric(13,2) DEFAULT 0;
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_ret_inss     numeric(13,2) DEFAULT 0;
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_ret_issqn    numeric(13,2) DEFAULT 0;
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_ret_funrural numeric(13,2) DEFAULT 0;
ALTER TABLE nf ADD COLUMN IF NOT EXISTS base_ret_irrf_piscofins_csll numeric(13,2) DEFAULT 0;
ALTER TABLE nf ADD COLUMN IF NOT EXISTS base_retencao_inss numeric(13,2) DEFAULT 0;

-- alíquotas de retenção na camada de config (ids/valores REAIS do PINHEIRAO; wl 'Modulo;Empresa').
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (171, 'ALIQUOTA_RETENCAO_PIS',      '0.65', 'numero', 'Modulo;Empresa', 'Alíquota de retenção de PIS na NF de serviço (%).'),
  (172, 'ALIQUOTA_RETENCAO_COFINS',   '3',    'numero', 'Modulo;Empresa', 'Alíquota de retenção de COFINS na NF de serviço (%).'),
  (173, 'ALIQUOTA_RETENCAO_CSLL',     '1',    'numero', 'Modulo;Empresa', 'Alíquota de retenção de CSLL na NF de serviço (%).'),
  (175, 'ALIQUOTA_RETENCAO_INSS',     '11',   'numero', 'Modulo;Empresa', 'Alíquota de retenção de INSS na NF de serviço (%).'),
  (177, 'ALIQUOTA_RETENCAO_IR',       '1',    'numero', 'Modulo;Empresa', 'Alíquota de retenção de IRRF na NF de serviço (%). Parceiro.PERC_ALIQUOTA_IR tem prioridade se >0.'),
  (179, 'ALIQUOTA_RETENCAO_FUNRURAL', '1',    'numero', 'Modulo;Empresa', 'Alíquota de retenção de FUNRURAL (%).')
ON CONFLICT (id) DO NOTHING;
