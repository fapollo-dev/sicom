-- 211 — PRECIFICAÇÃO DE NF (`FRMPRECIFICACAONF`, `uPrecificacaoNF.pas` 1.129 + `uDMPrecificacaoNF` 914).
-- Dossiê: `uPrecificacaoNF.md`. 236 acessos, 17 operadores — e, nas palavras do usuário, "tela de extrema
-- importância e de grande influência": é onde o preço de venda nasce quando a mercadoria chega.
--
-- ⚠️ **seis colunas de `NF_PROD` que a carga descartava, e são justamente as da precificação** — todas
-- preenchidas em ~100% das **495.804** linhas do cliente:
--
-- | coluna | o que é | preenchidas |
-- |---|---|---|
-- | `PMZ` | preço mínimo de zeramento do item | 495.800 |
-- | `VRVENDASUG` | o preço de venda sugerido, calculado na entrada | 495.800 |
-- | `ULTCUSTO` | o custo anterior do produto, congelado no item | 495.800 |
-- | `VRCUSTOCSI` | custo sem imposto | 495.800 |
-- | `FRETE2` | o segundo frete (o legado tem dois) | 495.804 |
-- | `DESPEXTRA` | despesa extra do item | 495.804 |
--
-- Sem elas a tela não tem o que mostrar na coluna "VENDA SUG" nem como comparar com o custo anterior.
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS pmz        numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vrvendasug numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS ultcusto   numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vrcustocsi numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS frete2     numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS despextra  numeric(13,2);

-- ── `cfop.proc_transf` — o que separa TRANSFERÊNCIA de compra ─────────────────────────────────────────────
-- A tela exclui as transferências por padrão (`uPrecificacaoNF.pas:911`): mercadoria que vem de outra loja
-- não é compra e não deve reprecificar. No cliente: 12 CFOPs marcados como transferência, 371 como não.
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS proc_transf char(1);

-- RBAC: a tela tem o gate e o botão de APLICAR é o que muda preço — vale a permissão separada, que é como o
-- cliente separa em outras telas de efeito.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMPRECIFICACAONF', 'FRMPRECIFICACAONF', 7, 1),
  ('FRMPRECIFICACAONF', 'BTNAPLICAR', 7, 1)
ON CONFLICT DO NOTHING;
