-- PRODUTO Fase 3: ESTOQUE (saldo por loja/empresa). No legado fica na MESMA form do produto
-- (aba Estoque), então aqui é um DETALHE 1:N do agregado de produto (uma linha por IDEMPRESA).
-- Doc: docs/04-screen-dossier/dossiers/retaguarda/UCadProduto.md
--
-- REGRA DE NEGÓCIO INEGOCIÁVEL (recon UCadProduto): o SALDO (QTDE) é MOVIDO POR TRANSAÇÃO
-- (NF/vendas/ajuste) — no cadastro é READ-ONLY (os 3 campos de saldo são Enabled=False no
-- legado). O cadastro edita apenas MINIMO/MAXIMO/LOCAL por empresa. Produto novo nasce com a
-- linha zerada (QTDE=0, MINIMO=0, MAXIMO=0). QTDE é NOT NULL (trigger VALIDA_ESTOQUE).
-- ADIADO/documentado (não perder a regra): movimentação por NF/vendas/AJUSTE (TfrmAjusteEstoque),
-- reservado (view GET_ESTOQUE_RESERVADO sobre PEDIDOS), saldo consolidado loja+depósito+produção,
-- auditoria AUDIT_ESTOQUE, replicação TRIGGER_ESTOQUE/REM_ESTOQUE→REMESSA_SERVER, ALMOXARIFADO,
-- ESTOQUE_DEP/ESTOQUE_PROD, cascata DEL_PRODUTO.
-- Modelo: PK surrogate id_estoque + UNIQUE(idproduto,idempresa) (no Oracle a unicidade é
-- convenção da app; aqui impomos), p/ encaixar no engine de agregado (detalhe pk única + fk).

CREATE SEQUENCE IF NOT EXISTS seq_estoque;
CREATE TABLE IF NOT EXISTS estoque (
  id_estoque  integer PRIMARY KEY DEFAULT nextval('seq_estoque'),
  idproduto   integer NOT NULL REFERENCES produtos(idproduto) ON DELETE CASCADE,
  idempresa   integer NOT NULL,                 -- saldo por loja/empresa
  qtde        numeric(13,3) NOT NULL DEFAULT 0, -- SALDO — movido por transação; read-only no cadastro
  minimo      numeric(13,3) DEFAULT 0,          -- ponto de reposição (editável)
  maximo      numeric(13,3) DEFAULT 0,          -- estoque máximo (editável)
  local       varchar(50),                      -- localização física (editável)
  UNIQUE (idproduto, idempresa)
);
ALTER SEQUENCE seq_estoque OWNED BY estoque.id_estoque;

-- View de listagem (saldo por empresa + descrição do produto p/ consulta/pesquisa).
CREATE OR REPLACE VIEW get_estoque AS
SELECT
  e.id_estoque,
  e.idproduto,
  e.idempresa,
  p.codbarra,
  p.descricao,
  e.qtde,
  e.minimo,
  e.maximo,
  e.local
FROM estoque e
LEFT JOIN produtos p ON p.idproduto = e.idproduto;

-- Seed: estoque da empresa 1 p/ os 3 produtos (saldo demonstrativo; min/max/local).
INSERT INTO estoque (idproduto, idempresa, qtde, minimo, maximo, local) VALUES
  (1, 1, 120.000, 10.000, 500.000, 'COR-A1'),
  (2, 1,  48.000, 12.000, 300.000, 'COR-B2'),
  (3, 1,  15.500,  5.000, 100.000, 'CAMARA-FRIO')
ON CONFLICT (idproduto, idempresa) DO NOTHING;
SELECT setval('seq_estoque', 1000, false);
