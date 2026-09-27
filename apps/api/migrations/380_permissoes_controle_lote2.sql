-- 380 — permissões de CONTROLE, lote 2 (docs/05-migration-engineering/permissoes-de-controle.md): NCM e figura fiscal no produto
-- (no form de cadastro o edit com Tag 1 também é desabilitado), a grade do SCRAP e do pedido de compra, os papéis/crédito do cliente,
-- o ativo da unidade, a alíquota do CFOP, os itens do lote de cobrança e da devolução de compra e a senha no cadastro de usuários.
-- Fixture de RBAC do seed (operador 7, lojas 1 e 2), como as demais migrações: a carga traz as PERMISSOES reais.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT x.form, x.opcao, 7, e.emp
  FROM (VALUES ('FRMCADPRODUTO', 'EDTNCMSH'), ('FRMCADPRODUTO', 'EDTCODFIGFISCAL'),
               ('FRMCADSCRAP', 'BTNADICIONARITEM'), ('FRMCADSCRAP', 'BTNEXCLUIRI'), ('FRMCADSCRAP', 'BTNLIMPARI'),
               ('FRMPEDIDOCOMPRA', 'BTNADICIONARI'), ('FRMPEDIDOCOMPRA', 'BTNEXCLUIRI'), ('FRMPEDIDOCOMPRA', 'BTNLIMPARI'),
               ('FRMCADCLIENTES', 'CHBCLIENTE'), ('FRMCADCLIENTES', 'CHBFORNECEDOR'), ('FRMCADCLIENTES', 'CHBFUNCIONARIO'),
               ('FRMCADCLIENTES', 'CHBCONVENIO'), ('FRMCADCLIENTES', 'CHBTRANSPORTADORA'), ('FRMCADCLIENTES', 'CCDCREDITO'),
               ('FRMCADCLIENTES', 'DBLIVREINDEXADOR'), ('FRMCADCLIENTES', 'JVDBCHECKBOX1'),
               ('FRMCADUNIDADE', 'CHBATIVO'), ('FRMCADCFOP', 'CMBALIQUOTA'),
               ('FRMCADLOTECOBRANCA', 'BTNADDITEN'), ('FRMCADLOTECOBRANCA', 'BTNEXCLUIRITEM'),
               ('FRMCADPEDIDODEVOLUCAOCOMPRAS', 'BTNEXCLUIRITEM'), ('FRMCADUSUARIOS', 'EDTSENHARETAGUARDA')) AS x(form, opcao)
 CROSS JOIN (VALUES (1), (2)) AS e(emp)
ON CONFLICT DO NOTHING;
