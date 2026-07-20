-- GAP do contábil PIS/COFINS de SAÍDA GERAL (situação 792/793). O F5b só semeou a saída VENDA-ST (5202/5411 →
-- 826/827); a SAÍDA GERAL (venda de mercadoria comum) usa no golden a situação PIS 792 / COFINS 793 em 6 CFOPs
-- (5102/5403/5405/5949/6102/6403 — 642 NFs no PINHEIRAO). Sem o IIC de 792/793 o `lancarPisCofins` chamaria
-- iicDC(792) e lançaria CONTAS_NAO_INFORMADAS → a contabilização dessas NFs FALHARIA. (O gate produtos.idpiscofins>0
-- é o que fez o gap passar despercebido no F5b, cuja amostra usava produto sem idpiscofins.)
--
-- Golden (READ-ONLY): CFOP.situacao_pis_saidas_nf=792 / situacao_cofins_saidas_nf=793; IIC 792 = D conta 128
-- (PIS S/ VENDAS) / C conta 235 (PIS A COMPENSAR); IIC 793 = D 129 (COFINS S/ VENDAS) / C 236; codhistorico 63.

-- contas de débito PIS/COFINS S/ VENDAS (novas; 235/236 já existem do F2). tipo 'A' analítica.
INSERT INTO plano_contas (codplanocontas, descricao, tipo, status) VALUES
  (128, 'PIS S/ VENDAS', 'A', 'A'), (129, 'COFINS S/ VENDAS', 'A', 'A')
ON CONFLICT (codplanocontas) DO NOTHING;

-- IIC das situações de saída geral 792 (PIS) / 793 (COFINS) — golden byte-a-byte (D128/C235, D129/C236, hist 63).
INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil, codhistorico) VALUES
  (792,'D','F',128,63),(792,'C','F',235,63),(793,'D','F',129,63),(793,'C','F',236,63)
ON CONFLICT DO NOTHING;

-- CFOPs de saída geral → situação 792/793 (garante o CFOP no catálogo antes do UPDATE).
INSERT INTO cfop (codcfop, descricao) VALUES
  ('5102','VENDA DE MERCADORIA ADQ. DE TERCEIROS'), ('6102','VENDA DE MERCADORIA ADQ. DE TERCEIROS (INTEREST)'),
  ('5403','VENDA ST NA CONDICAO DE SUBSTITUTO'), ('6403','VENDA ST NA CONDICAO DE SUBSTITUTO (INTEREST)'),
  ('5405','VENDA ST NA CONDICAO DE SUBSTITUIDO'), ('5949','OUTRA SAIDA DE MERCADORIA NAO ESPECIFICADA')
ON CONFLICT (codcfop) DO NOTHING;
UPDATE cfop SET situacao_pis_saidas_nf = 792, situacao_cofins_saidas_nf = 793
  WHERE codcfop IN ('5102','6102','5403','6403','5405','5949');
