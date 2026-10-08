-- 417 — CURVA ABC POR FORNECEDOR (`FRMRELCURVAABCFORNECEDOR`, uRelCurvaABCFornecedor.pas 458 linhas + uDMRelCurvaABCFornecedor): a curva
-- das COMPRAS, que a FILA dava como coberta pela curva de vendas. Lê NF/NF_PROD/PARCEIROS/EMPRESAS (PC_CURVA_ABC_A/B/C, mig 138) e
-- VENDAS; imprime com os .fr3 da RELATORIOS ("Curva ABC por Fornecedor[ com saidas].fr3"). A PERMISSOES da produção só tem o gate.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELCURVAABCFORNECEDOR', 'FRMRELCURVAABCFORNECEDOR', 7, 1)
ON CONFLICT DO NOTHING;
