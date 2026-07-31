-- 124 — ETIQUETAS DE PREÇO (FRMETIQUETA — Uetiqueta): a tela MAIS usada do legado (impressão de etiquetas de
-- gôndola/preço). A fila `etiqueta_cons_prod` é PRODUZIDA pelo coletor mobile (consulta de preço no handheld →
-- enfileira o produto com IMPRESSA='N') e CONSUMIDA por esta tela: lista os pendentes da EMPRESA (não por operador,
-- fiel a Uetiqueta.pas:589), computa o conteúdo da etiqueta (preço/promo de MULTI_PRECO server-authoritative ×
-- fator), imprime e marca IMPRESSA='S'. Preço IMPRESSO = VALOR_VENDA_PROMOCAO = (PROMOCAO='S' ? VRPROMO : VRVENDA)
-- × fator (Uetiqueta.pas:9-13, "utilizar como principal na etiqueta") — lido do MULTI_PRECO já denormalizado (NÃO
-- reconsulta PROMOCAO/AGENDA). No web a impressão é PDF/HTML (o legado usa FastReport .fr3 → impressora Windows;
-- SEM ZPL/ESC-POS). LOG_IMPRESSAO_ETIQUETA do legado NÃO tem escritor (artefato morto) → aqui é um log web fresco
-- (não quebra paridade). ADIADO: 29 modelos .fr3 (→ 1-2 layouts web), promo acumulativa/atacarejo, nutricional/
-- frigorífico, etiqueta-de-NF, coletor (produtor da fila), config EtiqGrupoPreco/CodReduzido.

-- fila do coletor (produto pendente de etiqueta). Escopo por idempresa + IMPRESSA (consumo NÃO filtra operador).
CREATE SEQUENCE IF NOT EXISTS seq_etiqueta_cons_prod;
CREATE TABLE IF NOT EXISTS etiqueta_cons_prod (
  idetiqueta    integer PRIMARY KEY DEFAULT nextval('seq_etiqueta_cons_prod'),
  idproduto     integer NOT NULL REFERENCES produtos(idproduto),
  operador      integer,                          -- quem enfileirou (coletor) — registrado, ignorado no consumo
  data_consulta timestamptz DEFAULT now(),
  impressa      char(1) DEFAULT 'N',              -- 'N' pendente / 'S' impressa
  idempresa     integer NOT NULL
);
ALTER SEQUENCE seq_etiqueta_cons_prod OWNED BY etiqueta_cons_prod.idetiqueta;
CREATE INDEX IF NOT EXISTS ix_etiq_cons_emp ON etiqueta_cons_prod (idempresa, impressa);

-- log de impressão WEB (fresco; LOG_IMPRESSAO_ETIQUETA do legado é morto/sem escritor).
CREATE SEQUENCE IF NOT EXISTS seq_log_impressao_etiqueta;
CREATE TABLE IF NOT EXISTS log_impressao_etiqueta (
  codlog               bigint PRIMARY KEY DEFAULT nextval('seq_log_impressao_etiqueta'),
  idempresa            integer NOT NULL,
  codoperador          integer,
  datahora_impressao   timestamptz DEFAULT now(),
  codbarra             varchar(50),
  descricao_etiqueta   varchar(500),
  unidade              varchar(20),
  codreduzido          varchar(50),
  qtde_impressa        numeric(15,4),
  valor_venda          numeric(15,2),
  valor_promocao       numeric(15,2),
  valor_venda_promocao numeric(15,2),            -- o preço IMPRESSO
  modelo_etiqueta      varchar(100)
);
ALTER SEQUENCE seq_log_impressao_etiqueta OWNED BY log_impressao_etiqueta.codlog;
CREATE INDEX IF NOT EXISTS ix_log_etiq_emp ON log_impressao_etiqueta (idempresa, datahora_impressao);

-- flags "etiqueta impressa" (fiel: MULTI_PRECO.ETQ_IMPRESSA) + qtde default de etiquetas por produto.
ALTER TABLE multi_preco ADD COLUMN IF NOT EXISTS etq_impressa char(1);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS prod_qtde_etiquetas integer;

-- view da fila: produto pendente + campos crus da etiqueta (o preço final × fator + promo é computado no service,
-- server-authoritative). Grupo-de-preço (FAMILIAS_PROD TIPO='R') exposto p/ a variante EtiqGrupoPreco (corte-2).
CREATE OR REPLACE VIEW get_etiqueta_fila AS
  SELECT e.idetiqueta, e.idproduto, e.idempresa, e.impressa, e.data_consulta, e.operador,
         p.codbarra, p.unidade, p.descricao AS descricao_produto,
         gp.descricao AS descricao_grupo,
         COALESCE(NULLIF(p.fator_filho, 0), 1) AS fator,
         COALESCE(NULLIF(p.prod_qtde_etiquetas, 0), 1) AS qtde_etiquetas,
         mp.vrvenda, mp.vrpromo, COALESCE(mp.promocao, 'N') AS promocao, mp.etq_impressa
  FROM etiqueta_cons_prod e
  JOIN produtos p ON p.idproduto = e.idproduto
  LEFT JOIN multi_preco mp ON mp.idproduto = e.idproduto AND mp.idempresa = e.idempresa
  LEFT JOIN familias_prod gp ON gp.codfamilia = p.codgrupopreco AND gp.tipo = 'R';

-- RBAC (operador 7, empresas 1+2): a tela de etiquetas.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMETIQUETA', 'BTNGRAVAR',            7, 1),
  ('FRMETIQUETA', 'BTNGRAVAR',            7, 2),
  ('FRMETIQUETA', 'BTNEXCLUIR',           7, 1),
  ('FRMETIQUETA', 'BTNEXCLUIR',           7, 2),
  ('FRMETIQUETA', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMETIQUETA', 'BTNADICIONARREGISTRO', 7, 2)
ON CONFLICT DO NOTHING;
