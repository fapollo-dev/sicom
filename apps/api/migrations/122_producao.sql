-- 122 — PRODUÇÃO (FRMCADPRODUCAO — uCadProducao "Requisição de produção"): manufatura açougue/padaria. Documento
-- MESTRE-DETALHE: cabeçalho `producao` + itens de SAÍDA `itens_producao` (1 linha = 1 produto ACABADO a produzir).
-- A ficha técnica (bill of materials) mora em `receita_prod` (1 acabado → N ingredientes) com o rendimento em
-- produtos.receitafator. Ao PROCESSAR, o serviço explode a receita (qtde × receita.qtde / receitafator) em
-- `itens_producao_receita` (snapshot do consumo), BAIXA os ingredientes e ENTRA o acabado no estoque + kardex
-- origem='PRODUCAO'. FIEL/pragmático: o app novo tem UM balde `estoque.qtde` — o legado passa a matéria-prima por
-- ESTOQUE_PROD via uma Transferência intermediária (transferência ESTOQUE→ESTOQUE_PROD + consumo ESTOQUE_PROD
-- NETAM a zero no balde real), então consumimos direto do estoque (net-idêntico). ADIADO (fiel): dois-baldes
-- ESTOQUE_PROD + Transferência (multi-bucket dormente, ROI~0), geração de NF (config GERAR_NF_PROCESSAR_PRODUCAO),
-- subsistema atacado/expedição (PEDIDOSPRODUCAO=0 linhas — morto), editor da aba Receita no produto (recon: dados
-- via ETL/seed), CONVERSÃO de unidade KG/LT→estoque na baixa (tabela FATOR_CONVERSAO + conversor genérico: o legado
-- divide a qtde retirada da loja por um fator quando a unidade da receita é KG/LT e difere da do produto). No dado
-- real isso é MORTO — só o acabado 301084 (nunca produzido) usa; as demais receitas caem no ramo-caixa com
-- FATORCXPROD=1 (=1 em 117/117 linhas) → QUANTIDADE_COM = QUANTIDADE, sem conversão. O corte-1 consome na unidade da
-- receita (fiel a 13/13 acabados JÁ produzidos) e o service FALHA ALTO (PRODUCAO_CONVERSAO_NAO_SUPORTADA) se uma
-- receita KG/LT-diferente for processada, em vez de baixar a qtde errada (fiel ao ValidarFatorDeConversaoDosItens).
-- Split empresa solicitante × produtora = morto no tenant (sempre 1→1) e o cliente NÃO o escolhe (server-set = emp,
-- fold [CRÍTICO]: senão moveria estoque de outra empresa); mantido por fidelidade só como registro.

-- Rendimento da receita: quantidade que a receita-base produz (PRODUTOS.RECEITAFATOR no legado).
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS receitafator numeric(13,3);

-- RECEITA_PROD — ficha técnica (BOM plano: 1 acabado IDPRODUTO → N ingredientes IDPRODUTO_RECEITA). Sem header
-- próprio (o "header" é o produto acabado em PRODUTOS + receitafator). Alimentada por ETL/seed (editor adiado).
CREATE SEQUENCE IF NOT EXISTS seq_receita_prod;
CREATE TABLE IF NOT EXISTS receita_prod (
  codreceita                integer PRIMARY KEY DEFAULT nextval('seq_receita_prod'),
  idproduto                 integer NOT NULL,             -- produto ACABADO (a que a receita pertence)
  idproduto_receita         integer NOT NULL,             -- INGREDIENTE / matéria-prima
  qtde                      numeric(13,4),                -- qtde do ingrediente para o rendimento-base (receitafator)
  valor                     numeric(13,2),
  unidade                   char(2),
  servico                   char(1) DEFAULT 'N',          -- 'S' = linha de serviço (não move estoque)
  fatorcxprod               numeric(13,3),
  fatorcxprod_util          numeric(13,3),
  ordem                     integer,
  flg_ingrediente_principal varchar(1),
  dtcadastro                timestamptz DEFAULT now(),
  usultalteracao            integer,
  dtultimalteracao          timestamptz
);
ALTER SEQUENCE seq_receita_prod OWNED BY receita_prod.codreceita;
CREATE INDEX IF NOT EXISTS ix_receita_prod_idproduto ON receita_prod (idproduto);

-- PRODUCAO (cabeçalho) — 1 requisição de produção. Status 'A' aberta / 'P' processada. Sem INDR (exclusão física
-- permitida só enquanto 'A', como o legado).
CREATE SEQUENCE IF NOT EXISTS seq_producao;
CREATE TABLE IF NOT EXISTS producao (
  codproducao         integer PRIMARY KEY DEFAULT nextval('seq_producao'),
  idempresa           integer NOT NULL,                  -- empresa solicitante (CODEMPRESA)
  codempresa_producao integer,                           -- empresa produtora (onde o estoque move); default = idempresa
  codparceiro         integer,                           -- soft ref
  codoperador         integer,
  codplc              integer,                           -- centro de custo (PLC) — soft ref
  data                timestamptz NOT NULL DEFAULT now(),
  dtprocessamento     timestamptz,
  status              char(1) NOT NULL DEFAULT 'A',       -- 'A' aberta / 'P' processada
  usucadastro         integer,
  dtcadastro          timestamptz DEFAULT now(),
  usultalteracao      integer,
  dtultimalteracao    timestamptz
);
ALTER SEQUENCE seq_producao OWNED BY producao.codproducao;
CREATE INDEX IF NOT EXISTS ix_producao_empresa ON producao (idempresa);

-- ITENS_PRODUCAO (saídas) — 1 linha por produto ACABADO produzido. Cascata do cabeçalho. Custo/venda = snapshot
-- server-authoritative de MULTI_PRECO (aba: derivarItensTrx). Sem idempresa (herda de producao, fiel ao legado).
CREATE SEQUENCE IF NOT EXISTS seq_itens_producao;
CREATE TABLE IF NOT EXISTS itens_producao (
  coditenprod      integer PRIMARY KEY DEFAULT nextval('seq_itens_producao'),
  codproducao      integer NOT NULL REFERENCES producao(codproducao) ON DELETE CASCADE,
  idprodutos       integer NOT NULL REFERENCES produtos(idproduto),  -- produto ACABADO (nome plural do legado)
  qtde             numeric(13,3) NOT NULL DEFAULT 0,      -- quantidade a produzir
  unidade          varchar(5),
  vrcusto          numeric(13,4),                         -- snapshot MULTI_PRECO.VRCUSTO (informativo)
  vrvenda          numeric(13,2),                         -- snapshot MULTI_PRECO.VRVENDA (informativo)
  observacao       varchar(1000),
  dtcadastro       timestamptz DEFAULT now(),
  usultalteracao   integer,
  dtultimalteracao timestamptz
);
ALTER SEQUENCE seq_itens_producao OWNED BY itens_producao.coditenprod;
CREATE INDEX IF NOT EXISTS ix_itens_producao_prod ON itens_producao (codproducao);

-- ITENS_PRODUCAO_RECEITA (consumo) — snapshot da receita EXPLODIDA, gravado no PROCESSAR (o legado grava na
-- digitação; aqui no processamento — net-idêntico p/ o efeito no estoque). O REVERTER lê este snapshot p/ reverter
-- exatamente o que foi consumido (mesmo que a receita mestre mude depois). Cascata do item de saída.
CREATE SEQUENCE IF NOT EXISTS seq_itens_producao_receita;
CREATE TABLE IF NOT EXISTS itens_producao_receita (
  coditenprodrec   integer PRIMARY KEY DEFAULT nextval('seq_itens_producao_receita'),
  coditenprod      integer NOT NULL REFERENCES itens_producao(coditenprod) ON DELETE CASCADE,
  codproduto       integer NOT NULL,                      -- INGREDIENTE consumido
  quantidade       numeric(13,4) NOT NULL DEFAULT 0,      -- qtde consumida (já escalada p/ a qtde produzida)
  unidade          varchar(5),
  vrcusto          numeric(13,4),                         -- snapshot MULTI_PRECO.VRCUSTO do ingrediente
  codreceita       integer,                               -- soft ref à receita mestre
  troca            char(1) DEFAULT 'N',
  dtcadastro       timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_itens_producao_receita OWNED BY itens_producao_receita.coditenprodrec;
CREATE INDEX IF NOT EXISTS ix_itens_prod_receita_item ON itens_producao_receita (coditenprod);

-- View de lista/pesquisa: cabeçalho + nº de itens + totais (Σ qtde×custo/venda) + status legível + parceiro.
CREATE OR REPLACE VIEW get_producao AS
  SELECT p.codproducao, p.codproducao AS codigo, p.idempresa, p.codempresa_producao, p.codparceiro, p.codplc,
         p.codoperador, p.data, p.dtprocessamento, p.status,
         CASE WHEN COALESCE(p.status,'A') = 'A' THEN 'ABERTA' ELSE 'PROCESSADA' END AS status_label,
         (SELECT count(*) FROM itens_producao i WHERE i.codproducao = p.codproducao) AS qtde_itens,
         (SELECT COALESCE(SUM(i.qtde * COALESCE(i.vrcusto,0)), 0) FROM itens_producao i WHERE i.codproducao = p.codproducao) AS total_custo,
         (SELECT COALESCE(SUM(i.qtde * COALESCE(i.vrvenda,0)), 0) FROM itens_producao i WHERE i.codproducao = p.codproducao) AS total_venda,
         pa.razao AS parceiro
  FROM producao p
  LEFT JOIN parceiros pa ON pa.codparceiro = p.codparceiro;

-- RBAC (operador 7, empresas 1+2). Processar reusa BTNGRAVAR; reverter reusa BTNEXCLUIR (molde scrap).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADPRODUCAO', 'BTNGRAVAR',            7, 1),
  ('FRMCADPRODUCAO', 'BTNGRAVAR',            7, 2),
  ('FRMCADPRODUCAO', 'BTNEXCLUIR',           7, 1),
  ('FRMCADPRODUCAO', 'BTNEXCLUIR',           7, 2),
  ('FRMCADPRODUCAO', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADPRODUCAO', 'BTNEDITAR',            7, 1)
ON CONFLICT DO NOTHING;
