-- PRODUTO Fase 2: MULTI_PRECO — preço/custo POR EMPRESA. No legado vive na MESMA form do
-- produto (cdsMulti_Preco_Update), então aqui é um DETALHE 1:N do agregado de produto
-- (uma linha por IDEMPRESA). A tela ARMAZENA; o CÁLCULO (custo→venda + impostos) é REUSADO
-- do módulo `precificacao` (PrecoService/FiscalPricingService/TributacaoRepository) — não
-- reescrever motor fiscal. Doc: docs/04-screen-dossier/dossiers/retaguarda/UCadProduto.md
-- Núcleo (subconjunto das ~100 col): custo/venda/markup/margem/promoção + alíquota de saída.
-- PK natural do legado é (IDPRODUTO, IDEMPRESA); aqui uso PK surrogate + UNIQUE(idproduto,idempresa)
-- p/ encaixar no engine de agregado (detalhe com pk única gerada + fk para o master).

CREATE SEQUENCE IF NOT EXISTS seq_multi_preco;
CREATE TABLE IF NOT EXISTS multi_preco (
  id_multi_preco     integer PRIMARY KEY DEFAULT nextval('seq_multi_preco'),
  idproduto          integer NOT NULL REFERENCES produtos(idproduto) ON DELETE CASCADE,
  idempresa          integer NOT NULL,                  -- preço por loja/empresa
  vrcusto            numeric(15,4),                      -- custo
  vrcustorep         numeric(15,4),                      -- custo de reposição
  markup             numeric(13,4),                      -- markup (%) sobre custo
  vrvenda            numeric(15,4),                      -- preço de venda (resultado do cálculo)
  vrpromo            numeric(15,4),                      -- preço promocional
  promocao           char(1) DEFAULT 'N',                -- em promoção S/N
  margeml            numeric(13,4),                      -- margem líquida (%)
  aliquotasaida      char(3),                            -- código fiscal de saída (→ det_aliquota por UF)
  ativo              char(1) DEFAULT 'S',
  ativo_compra       char(1) DEFAULT 'S',
  dtultprecoalterado timestamptz,
  UNIQUE (idproduto, idempresa)
);
ALTER SEQUENCE seq_multi_preco OWNED BY multi_preco.id_multi_preco;

-- View de listagem (preço por empresa + descrição do produto p/ a Pesquisa).
CREATE OR REPLACE VIEW get_multi_preco AS
SELECT
  mp.id_multi_preco,
  mp.idproduto,
  mp.idempresa,
  p.codbarra,
  p.descricao,
  mp.vrcusto,
  mp.vrvenda,
  mp.markup,
  mp.promocao,
  mp.aliquotasaida,
  mp.ativo
FROM multi_preco mp
LEFT JOIN produtos p ON p.idproduto = mp.idproduto;

-- Seed: preço da empresa 1 p/ os 3 produtos do seed (alíquota de saída = a do produto).
INSERT INTO multi_preco (idproduto, idempresa, vrcusto, vrcustorep, markup, vrvenda, promocao, aliquotasaida, ativo) VALUES
  (1, 1, 3.5000, 3.5000, 30.0000, 4.5500, 'N', 'T01', 'S'),
  (2, 1, 5.0000, 5.0000, 40.0000, 7.0000, 'N', 'T01', 'S'),
  (3, 1, 18.0000, 18.0000, 35.0000, 24.3000, 'N', 'T01', 'S')
ON CONFLICT (idproduto, idempresa) DO NOTHING;
SELECT setval('seq_multi_preco', 1000, false);
