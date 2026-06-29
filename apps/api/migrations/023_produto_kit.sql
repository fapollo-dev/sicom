-- PRODUTO Fase 4 (kit/BOM): COMPOSIÇÃO (kit) + DECOMPOSIÇÃO (1→N) + RECEITA (ficha técnica).
-- Na MESMA form do produto (3 sub-grids), detalhes 1:N do agregado. Cada item referencia
-- OUTRO produto (IDPRODUTO_01 / IDPRODUTO_RECEITA) — lookup de produto na tela.
-- Doc: docs/04-screen-dossier/dossiers/retaguarda/UCadProduto.md
--
-- REGRAS DE NEGÓCIO MANTIDAS (recon UCadProduto):
--  - DECOMPOSIÇÃO deve somar 100% (quando há itens) — validação no schema (msg verbatim).
--  - Flags PRODUTOS.COMPOSICAO/DECOMPOSICAO/RECEITA derivadas da presença de itens ('N' se vazio)
--    — derivar() do agregado.
--  - NÃO desativar produto que é COMPONENTE de algum kit (COMPOSICAO.IDPRODUTO_01) — validar() do agregado.
-- ADIADO/documentado (não perder): recálculo em cascata de custo/preço dos kits via MULTI_PRECO
--  (trigger legado PRODUTOS_COMP, gated por PARAMETRO.ATUCOMPOSICAO), sincronização de custo entre
--  empresas, análise de custo da decomposição por NF, atualiza-preço-filho, replicação remessa_server.
--  Auditoria de RECEITA/DECOMPOSIÇÃO eram triggers no Oracle (RECEITA_PROD_HIST/AUDIT_DECOMPOSICAO).

-- Flags no master (presença de itens). Default 'N'.
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS composicao   char(1) DEFAULT 'N';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS decomposicao char(1) DEFAULT 'N';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS receita      char(1) DEFAULT 'N';

-- COMPOSIÇÃO (kit): master IDPRODUTO é o kit; IDPRODUTO_01 é o componente (outro produto).
CREATE SEQUENCE IF NOT EXISTS seq_composicao_codcomp;
CREATE TABLE IF NOT EXISTS composicao (
  codcomp         integer PRIMARY KEY DEFAULT nextval('seq_composicao_codcomp'),
  idproduto       integer NOT NULL REFERENCES produtos(idproduto) ON DELETE CASCADE,  -- o kit
  idproduto_01    integer REFERENCES produtos(idproduto),                              -- o componente
  qtde            numeric(10,4) DEFAULT 1,
  valor           numeric(13,2),                       -- custo unitário do componente
  descricao       varchar(100),
  codcomposicao   varchar(22),
  chavecomposicao varchar(25)
);
ALTER SEQUENCE seq_composicao_codcomp OWNED BY composicao.codcomp;

-- DECOMPOSIÇÃO (1 produto → vários): IDPRODUTO é a partida; IDPRODUTO_01 o resultante; PERCENTUAL.
CREATE SEQUENCE IF NOT EXISTS seq_decomposicao_coddecomp;
CREATE TABLE IF NOT EXISTS decomposicao (
  coddecomp    integer PRIMARY KEY DEFAULT nextval('seq_decomposicao_coddecomp'),
  idproduto    integer NOT NULL REFERENCES produtos(idproduto) ON DELETE CASCADE,
  idproduto_01 integer REFERENCES produtos(idproduto),
  percentual   numeric(13,2) DEFAULT 0,
  gera_scrap   char(1)
);
ALTER SEQUENCE seq_decomposicao_coddecomp OWNED BY decomposicao.coddecomp;

-- RECEITA (ficha técnica/BOM): IDPRODUTO é o produto-receita; IDPRODUTO_RECEITA o ingrediente.
CREATE SEQUENCE IF NOT EXISTS seq_receita_codreceita;
CREATE TABLE IF NOT EXISTS receita_prod (
  codreceita        integer PRIMARY KEY DEFAULT nextval('seq_receita_codreceita'),
  idproduto         integer NOT NULL REFERENCES produtos(idproduto) ON DELETE CASCADE,
  idproduto_receita integer REFERENCES produtos(idproduto),
  qtde              numeric(13,4) DEFAULT 1,
  valor             numeric(13,2),
  unidade           char(2),
  servico           char(1) DEFAULT 'N',
  fatorcxprod       numeric(13,3),
  fatorcxprod_util  numeric(13,3),
  dtcadastro        timestamptz,
  usultalteracao    integer,
  dtultimalteracao  timestamptz
);
ALTER SEQUENCE seq_receita_codreceita OWNED BY receita_prod.codreceita;

-- Seed coerente: kit (prod 1 ← componente prod 2), decomposição (prod 2 → prod 3 a 100%),
-- receita (prod 3 ← ingrediente prod 1). Flags do master batem com a presença de itens.
INSERT INTO composicao (idproduto, idproduto_01, qtde, valor, descricao) VALUES
  (1, 2, 2.0000, 5.0000, 'REFRIGERANTE COLA 2L')
ON CONFLICT DO NOTHING;
INSERT INTO decomposicao (idproduto, idproduto_01, percentual) VALUES
  (2, 3, 100.00)
ON CONFLICT DO NOTHING;
INSERT INTO receita_prod (idproduto, idproduto_receita, qtde, valor, unidade) VALUES
  (3, 1, 1.0000, 3.5000, 'KG')
ON CONFLICT DO NOTHING;

UPDATE produtos SET composicao   = 'S' WHERE idproduto = 1;
UPDATE produtos SET decomposicao = 'S' WHERE idproduto = 2;
UPDATE produtos SET receita      = 'S' WHERE idproduto = 3;
