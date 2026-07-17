-- COTAÇÃO DE COMPRA (RFQ — uCadCotacao) — corte-1: estrutura + preços. Árvore de 3-4 níveis (não cabe no agregado
-- declarativo → serviço vertical): COTACAO (header) → COTACAO_PROD (produtos) → COTACAO_PRODQTDE (qtde por loja);
-- COTACAO → COTACAO_FORN (fornecedores convidados) → COTACAO_FORN_ITENS (a MATRIZ de preço fornecedor×produto).
-- Fluxo corte-1: criar cotação → lançar preços → fechar/reabrir. Apuração (GANHADOR = menor preço líq-ICMS) +
-- gerar-pedido = corte-2. Preenchimento pelo COMPRADOR (portal do fornecedor = épico à parte). SITUACAO: 'A'/'F'.

CREATE TABLE IF NOT EXISTS cotacao (
  codctc                bigserial PRIMARY KEY,
  idempresa             integer NOT NULL,                    -- empresa dona (tenant/RBAC); a cotação pode cotar p/ várias lojas (prodqtde)
  descricao             varchar(120),
  data                  timestamptz DEFAULT now(),
  situacao              char(1) DEFAULT 'A',                 -- 'A' Aberta | 'F' Fechada
  liberada              char(1) DEFAULT 'N',                 -- flag do portal web (write-once 'N' no desktop)
  pedidos               varchar(1000),                       -- log textual dos pedidos gerados (corte-2) + anti-regeração
  flg_origem            char(1) DEFAULT 'C',                 -- 'C' cotação normal | 'L' por lista de fornecedores
  dtinicio_preenchimento timestamptz,
  dtfim_preenchimento   timestamptz,
  indr                  char(1) DEFAULT 'I',                 -- soft-delete
  codoperador           integer,
  dtcadastro            timestamptz DEFAULT now(),
  usultalteracao        integer,
  dtultimalteracao      timestamptz
);

-- produtos a cotar.
CREATE TABLE IF NOT EXISTS cotacao_prod (
  codcpr                bigserial PRIMARY KEY,
  codctc                bigint NOT NULL REFERENCES cotacao(codctc) ON DELETE CASCADE,
  idproduto             integer NOT NULL,
  descricao             varchar(120),
  quantidade            numeric(13,3) DEFAULT 0,             -- qtde total a cotar (Σ das lojas)
  fatorembalagem        numeric(13,3) DEFAULT 1,
  valorcusto            numeric(13,4) DEFAULT 0,             -- custo de referência (snapshot)
  valorvenda            numeric(13,4) DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cotacao_prod ON cotacao_prod (codctc, idproduto);

-- qtde por LOJA (a cotação é multi-empresa; gerar-pedido re-explode isto em PEDIDO_COMPRA_QTDE — corte-2).
CREATE TABLE IF NOT EXISTS cotacao_prodqtde (
  codcprqtde            bigserial PRIMARY KEY,
  codcpr                bigint NOT NULL REFERENCES cotacao_prod(codcpr) ON DELETE CASCADE,
  idempresa             integer NOT NULL,
  qtde                  numeric(13,3) DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cotacao_prodqtde ON cotacao_prodqtde (codcpr, idempresa);

-- fornecedores convidados.
CREATE TABLE IF NOT EXISTS cotacao_forn (
  codctcforn            bigserial PRIMARY KEY,
  codctc                bigint NOT NULL REFERENCES cotacao(codctc) ON DELETE CASCADE,
  codparceiro           integer NOT NULL,
  participa_apuracao    char(1) DEFAULT 'S',                 -- entra na apuração (corte-2)
  datavalidade          date,
  obs                   varchar(255)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cotacao_forn ON cotacao_forn (codctc, codparceiro);

-- a MATRIZ de preço: o que cada fornecedor cotou por produto.
CREATE TABLE IF NOT EXISTS cotacao_forn_itens (
  codctcfit             bigserial PRIMARY KEY,
  codctcforn            bigint NOT NULL REFERENCES cotacao_forn(codctcforn) ON DELETE CASCADE,
  codcpr                bigint NOT NULL REFERENCES cotacao_prod(codcpr) ON DELETE CASCADE,
  valor                 numeric(13,4) DEFAULT 0,             -- preço unitário cotado
  valorembal            numeric(13,4) DEFAULT 0,
  valortotal            numeric(13,4) DEFAULT 0,
  fatorembalagem        numeric(13,3) DEFAULT 1,
  icms                  numeric(13,4) DEFAULT 0,             -- % ICMS (p/ o preço líquido na apuração — corte-2)
  ganhador              char(1) DEFAULT 'I',                 -- 'A' vencedor | 'I' indefinido/perdedor (apuração corte-2)
  definido              char(1) DEFAULT 'N',                 -- 'S' = escolha manual travada
  verificado            char(1) DEFAULT 'N',
  datamanut             timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cotacao_forn_itens ON cotacao_forn_itens (codctcforn, codcpr);

-- view de leitura do header (lista) + contagens.
CREATE OR REPLACE VIEW get_cotacao AS
  SELECT c.*,
    (SELECT count(*) FROM cotacao_prod p WHERE p.codctc = c.codctc) AS qtde_produtos,
    (SELECT count(*) FROM cotacao_forn f WHERE f.codctc = c.codctc) AS qtde_fornecedores
  FROM cotacao c;

-- RBAC (FRMCADCOTACAO). Seed p/ o operador 7 (smoke).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADCOTACAO', 'BTNGRAVAR', 7, 1), ('FRMCADCOTACAO', 'BTNEXCLUIR', 7, 1),
  ('FRMCADCOTACAO', 'BTNLANCARPRECOS', 7, 1), ('FRMCADCOTACAO', 'BTNFECHAR', 7, 1), ('FRMCADCOTACAO', 'BTNREABRIR', 7, 1),
  ('FRMCADCOTACAO', 'BTNGRAVAR', 7, 2), ('FRMCADCOTACAO', 'BTNEXCLUIR', 7, 2),
  ('FRMCADCOTACAO', 'BTNLANCARPRECOS', 7, 2), ('FRMCADCOTACAO', 'BTNFECHAR', 7, 2), ('FRMCADCOTACAO', 'BTNREABRIR', 7, 2)
ON CONFLICT DO NOTHING;
