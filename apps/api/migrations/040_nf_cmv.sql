-- NF F5b-fase4b: CMV (custo da mercadoria vendida) no DIÁRIO. Desbloqueio: coluna VL_CUSTO = custo
-- CONGELADO por item no lançamento (snapshot de MULTI_PRECO.VRCUSTO por idproduto/idempresa —
-- GetCustoProduto, udmNF.pas:12057; regressão: VL_CUSTO≈MP.VRCUSTO 90/109, e os que divergem têm
-- MP alterado DEPOIS da NF → prova o snapshot). CMV = Σ(VL_CUSTO×FATOREMBAL×QUANTIDADE) só na SAÍDA,
-- CFOP de venda, situação 873 (config), D=134 (CMV) / C=147 (estoque). Golden NF 93540 = 5,57.

-- custo congelado por item (escala 13,4 = legado NF_PROD.VL_CUSTO).
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vl_custo numeric(13,4) NOT NULL DEFAULT 0;

-- plano_contas do CMV (golden sit873: D134 / C147).
INSERT INTO plano_contas (codplanocontas, descricao, tipo, status) VALUES
  (134, 'CUSTO DA MERCADORIA VENDIDA',        'A', 'A'),
  (147, 'ESTOQUE DE MERCADORIAS P/ REVENDA',  'A', 'A')
ON CONFLICT (codplanocontas) DO NOTHING;

-- IIC da situação de CMV 873 (= CONFIG_INTEGRACAO_CONTABIL.CONFIG_CUSTO_NF_VENDA): D134 / C147, TIPO 'F'.
INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil, codhistorico) VALUES
  (873, 'D', 'F', 134, 70), (873, 'C', 'F', 147, 70)
ON CONFLICT DO NOTHING;
