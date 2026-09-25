-- UNIDADES (UCadUnidade): a exclusão da tela é lógica (INDR), e a listagem do motor filtra pela view — que não tinha o INDR.
-- A view ganha também ATIVO/PRODUCAO/FRACIONADO (as colunas que a tela edita). Colunas novas só no fim (CREATE OR REPLACE VIEW).
CREATE OR REPLACE VIEW get_unidade AS
  SELECT codunidade, codunidade AS codigo, sigla, descricao, indr, ativo, producao, fracionado FROM unidade;

-- a porta da tela de alíquotas (PossuiAcessoForm do form-base: o grant FORM/FORM) para o operador dos testes, como as outras telas
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT 'FRMCADALIQUOTA', 'FRMCADALIQUOTA', 7, 1
 WHERE EXISTS (SELECT 1 FROM operadores WHERE codoperador = 7)
   AND NOT EXISTS (SELECT 1 FROM permissoes WHERE form = 'FRMCADALIQUOTA' AND opcao = 'FRMCADALIQUOTA' AND codoperador = 7 AND codempresa = 1);
