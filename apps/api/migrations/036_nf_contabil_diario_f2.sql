-- NF F5b-fase2: APROFUNDA o DIÁRIO — (a) contas AUTOMÁTICAS TIPO='A' (crédito=parceiro / débito=ponte
-- PLC→PLANO_CONTAS) e (b) linhas de imposto PIS/COFINS. Golden PINHEIRAO (NF 72044/71822, cfop 1403):
-- principal sit6 D148/C11141 + PIS sit788 D235/C154 (totalnf×1,65%) + COFINS sit789 D236/C153 (totalnf×7,6%).
-- A situação de cada linha de imposto vem do CFOP. ICMS-line/CMV/auto-disparo = fase-3.

-- CFOP ganha as situações de imposto (por sentido). Confirmadas no Oracle (CFOP.SITUACAO_*_NF).
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS situacao_icms_entradas_nf   integer;
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS situacao_icms_saidas_nf     integer;
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS situacao_pis_entradas_nf    integer;
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS situacao_pis_saidas_nf      integer;
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS situacao_cofins_entradas_nf integer;
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS situacao_cofins_saidas_nf   integer;

-- plano_contas p/ PIS/COFINS (golden) + cliente (crédito automático de saída).
INSERT INTO plano_contas (codplanocontas, descricao, tipo, status) VALUES
  (235, 'PIS A RECUPERAR',              'A', 'A'),
  (154, 'PIS A RECOLHER (TRANSITORIA)', 'A', 'A'),
  (236, 'COFINS A RECUPERAR',           'A', 'A'),
  (153, 'COFINS A RECOLHER (TRANSIT.)', 'A', 'A'),
  (211, 'CLIENTES DIVERSOS',            'A', 'A')
ON CONFLICT (codplanocontas) DO NOTHING;

-- CFOP 1403 (entrada c/ ST — golden): PIS 788 / COFINS 789. Garante o CFOP no catálogo.
INSERT INTO cfop (codcfop, descricao) VALUES ('1403', 'COMPRA P/ COMERCIALIZACAO (ST)') ON CONFLICT (codcfop) DO NOTHING;
UPDATE cfop SET situacao_pis_entradas_nf = 788, situacao_cofins_entradas_nf = 789 WHERE codcfop = '1403';

-- IIC das situações de imposto (golden): PIS 788 D235/C154; COFINS 789 D236/C153 (TIPO 'F' fixa).
INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil, codhistorico) VALUES
  (788, 'D', 'F', 235, 1), (788, 'C', 'F', 154, 1),
  (789, 'D', 'F', 236, 1), (789, 'C', 'F', 153, 1)
ON CONFLICT DO NOTHING;

-- situação 'A' de teste (900): débito AUTOMÁTICO (ponte PLC) + crédito AUTOMÁTICO (parceiro).
INSERT INTO situacao_nf (idsituacao_nf, descricao, tipo) VALUES (900, 'TESTE CONTA AUTOMATICA', 'E')
ON CONFLICT (idsituacao_nf) DO NOTHING;
INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil, codhistorico) VALUES
  (900, 'D', 'A', NULL, 1), (900, 'C', 'A', NULL, 1)
ON CONFLICT DO NOTHING;

-- pontes p/ o TIPO='A': PLC codcc=1 → conta 148; parceiro 22 → conta cliente 211 (saída) /
-- fornecedor 11141 (entrada). (parceiros.codcontabil/_for são varchar; o serviço coage p/ integer.)
UPDATE plc SET codcontabil = 148 WHERE codplc = 1;
UPDATE parceiros SET codcontabil = '211', codcontabil_for = '11141' WHERE codparceiro = 22;
