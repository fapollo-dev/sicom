-- 379 — as PERMISSÕES DE CONTROLE do cadastro de produto (uMaster.SetStateOfControlsMaster sobre o UCadProduto.dfm).
-- O componente com Tag 1 cujo nome é uma opção de PERMISSOES fica desabilitado para quem não a tem: preço de venda, custo,
-- custo de reposição, ativo p/ venda e p/ compra, e os botões de composição e decomposição. O Apollo não aplicava — todos podiam
-- tudo; agora a tela os desabilita e a gravação confere (produto-permissoes.ts). Na produção (27/09/2026), de 134 operador×loja
-- com acesso à tela, 6 não podem mudar o preço, 8 o custo, 12 incluir na composição, 19 excluir dela.
--
-- Fixture de RBAC do seed (operador 7, lojas 1 e 2), como as demais migrações: a carga traz as PERMISSOES reais.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT 'FRMCADPRODUTO', o.opcao, 7, e.emp
  FROM (VALUES ('EDTVRVENDA'), ('EDTCUSTO'), ('EDTCUSTOREP'), ('CHBATIVO'), ('CHBATIVOCOMPRA'), ('BTNADDITEM'), ('BTNDELITEM'),
               ('BTNLIMPARCOMPOSICAO'), ('BTNADDDESCOMP'), ('BTNEXCLUIDECOMP'), ('BTNLIMPADECOMP')) AS o(opcao)
 CROSS JOIN (VALUES (1), (2)) AS e(emp)
ON CONFLICT DO NOTHING;
