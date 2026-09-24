-- 330 — GERENCIAR SUGESTÃO DE PROMOÇÃO (FRMGERENCIARSUGESTAOPROMOCAO; sem unit no fonte de mai/2020 — reconstruída do dado):
-- SUGEST_PROMO_PROD (471 linhas, até 21/09/2026) é a lista de produtos sugeridos para promoção por operador e loja; a gestão
-- "resolve" a sugestão por exclusão lógica (INDR='S' + usuário + data: 343, quase todas pelo operador que sugere). A mig 311 criou
-- a tabela sem gerador de chave: aqui a sequência (a pós-carga a reposiciona).
CREATE SEQUENCE IF NOT EXISTS seq_sugest_promo_prod;
ALTER TABLE sugest_promo_prod ALTER COLUMN idsugest_promo_prod SET DEFAULT nextval('seq_sugest_promo_prod');
SELECT setval('seq_sugest_promo_prod', greatest(coalesce((SELECT max(idsugest_promo_prod) FROM sugest_promo_prod), 0), 1)::bigint, true);
CREATE INDEX IF NOT EXISTS ix_sugest_promo_prod_aberta ON sugest_promo_prod (idempresa, idproduto) WHERE indr IS NULL;

INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT 'FRMGERENCIARSUGESTAOPROMOCAO', 'FRMGERENCIARSUGESTAOPROMOCAO', 7, e FROM (VALUES (1), (2)) v(e)
WHERE NOT EXISTS (SELECT 1 FROM permissoes WHERE form = 'FRMGERENCIARSUGESTAOPROMOCAO' AND codoperador = 7 AND codempresa = v.e);
