-- 411 — "tem que ter todos os campos": as 8 colunas que a PRODUÇÃO ganhou com o binário novo e o destino não tinha
-- (`tools/cutover/conferir-colunas-orfas.py`, sentido 2, em 06/10/2026; tipos do ALL_TAB_COLUMNS). Todas vazias hoje no
-- cliente (0 de 5 empresas, 0 de 49.655 NF, 0 de 498.439 itens) — entram no schema e na carga do mesmo jeito.
--  · EMPRESAS.FGF4_*: a integração "FGF4" (ambiente, URLs e o token de homologação/produção, timeout). Os tokens são
--    credencial: o `empresaParaRelatorio` não os expõe aos layouts.
--  · NF.QTDE_PESO_NF NUMBER(15,4) · NF_PROD.VRCUSTO_MEDIO NUMBER(18,6).
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS fgf4_ambiente         varchar(1),
  ADD COLUMN IF NOT EXISTS fgf4_url_homologacao  varchar(250),
  ADD COLUMN IF NOT EXISTS fgf4_url_producao     varchar(250),
  ADD COLUMN IF NOT EXISTS fgf4_auth_homologacao varchar(4000),
  ADD COLUMN IF NOT EXISTS fgf4_auth_producao    varchar(4000),
  ADD COLUMN IF NOT EXISTS fgf4_timeout          numeric(10,0);
ALTER TABLE nf      ADD COLUMN IF NOT EXISTS qtde_peso_nf  numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vrcusto_medio numeric(18,6);
