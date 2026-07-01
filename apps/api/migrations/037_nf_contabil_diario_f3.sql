-- NF F5b-fase3: linha de ICMS próprio no DIÁRIO + suporte ao AUTO-DISPARO. Golden PINHEIRAO (500/500):
-- o valor da linha de ICMS = Σ NF_PROD.VRICM dos itens TRIBUTADOS (ALIQUOTA começa com 'T') e de CFOP
-- NÃO-cupom (PROC_CUPOM≠'S') — GetSQLNF (UIntegracaoContabil.pas:483-492). NÃO é o header NF.TOTALICM
-- (que inclui cupom/não-'T' e diverge ~8%). Situação vem do CFOP do item. saída 5949 → ICMS sit791 D127/C232.
-- CMV, base/rate PIS-COFINS de saída (PC_CONFIG) e período fechado = fase-4.

-- PROC_CUPOM (CFOP de cupom/PDV): itens de CFOP cupom NÃO entram no ICMS do razão (GetSQLNF:483-492).
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS proc_cupom char(1) DEFAULT 'N';

-- CFOP 5102 (saída p/ comercialização): situação de ICMS 791 (golden). Garante o CFOP no catálogo.
INSERT INTO cfop (codcfop, descricao) VALUES ('5102', 'VENDA DE MERCADORIA') ON CONFLICT (codcfop) DO NOTHING;
UPDATE cfop SET situacao_icms_saidas_nf = 791 WHERE codcfop = '5102';

-- plano_contas do ICMS (golden sit791 D127/C232).
INSERT INTO plano_contas (codplanocontas, descricao, tipo, status) VALUES
  (127, 'ICMS A RECUPERAR / CUSTO', 'A', 'A'),
  (232, 'ICMS A RECOLHER',          'A', 'A')
ON CONFLICT (codplanocontas) DO NOTHING;

-- IIC da situação de ICMS 791: D127 / C232 (TIPO 'F' fixa).
INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil, codhistorico) VALUES
  (791, 'D', 'F', 127, 1), (791, 'C', 'F', 232, 1)
ON CONFLICT DO NOTHING;
