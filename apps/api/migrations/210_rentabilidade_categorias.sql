-- 210 — RENTABILIDADE POR CATEGORIAS (`FRMRENTABILIDADECATEGORIAS`). Dossiê: `uRentabilidadeCategorias.md`.
-- 275 acessos. É a rentabilidade DEPOIS do imposto e da despesa operacional — a Consultoria (mig 207) para
-- em venda menos custo; esta desce até o lucro líquido, descontando ICMS, PIS/COFINS, encargos de compra,
-- despesa operacional, IR e CSLL.
--
-- Nada de schema: `empresas` (imprenda, contsocial, despoperacional, classfiscal, uf), `det_aliquota`
-- (icm_efetivo por UF), `piscofins`, `multi_preco` e `produtos` já têm todas as colunas da fórmula.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRENTABILIDADECATEGORIAS', 'FRMRENTABILIDADECATEGORIAS', 7, 1)
ON CONFLICT DO NOTHING;
