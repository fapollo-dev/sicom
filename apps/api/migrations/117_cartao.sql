-- 117 — CARTÕES / RECEBÍVEIS DE CARTÃO (FRMCADCARTAO/FRMCADOPERADORAS) corte-1: OPERADORAS + recebível
-- (consulta/cadastro). É um Contas-a-Receber especializado em cartão: cada venda no cartão vira um recebível
-- (`cartao`) com valor bruto, taxa da administradora e vencimento; LIBERADO='N' aberto / 'S' baixado. O legado
-- NÃO gera o recebível na retaguarda — nasce no PDV (OFF) ou no cadastro manual. Corte-1 = cadastro de OPERADORAS
-- (taxa/dias-comp) + cadastro/consulta do recebível com LÍQUIDO e VENCIMENTO computados (espelha a view GET_CARTAO).
-- ADIADO: baixa em lote (UbaixaCartao → banco/caixa), conciliação de extrato (CONS_REG10 + adquirentes), geração
-- automática via PDV/ETL. Sem baixa neste corte → todo recebível nasce LIBERADO='N'.

-- BANDEIRA — lookup fixo (cadastro de referência).
CREATE TABLE IF NOT EXISTS bandeira (
  idbandeira integer PRIMARY KEY,
  bandeira   varchar(40) NOT NULL
);
INSERT INTO bandeira (idbandeira, bandeira) VALUES
  (1,'Amex'),(2,'Cabal'),(3,'Dinners Club'),(4,'Elo'),(5,'Hipercard'),(6,'Maestro'),
  (7,'Mastercard'),(8,'Visa'),(9,'Visa Electron'),(10,'Visa Vale'),(9999,'Própria')
ON CONFLICT (idbandeira) DO NOTHING;
CREATE OR REPLACE VIEW get_bandeira AS SELECT idbandeira, idbandeira AS codigo, bandeira FROM bandeira;

-- OPERADORAS — a administradora/adquirente (Cielo/Rede/…) por produto (crédito/débito/voucher). Carrega os
-- parâmetros econômicos: TXADM (% da adm) e DIASCOMP (dias p/ compensação → base do vencimento). codoperadorabase
-- permite herdar params de uma operadora-base (leaf→base). codadm = adquirente como PARCEIRO (p/ SPED, soft ref).
CREATE SEQUENCE IF NOT EXISTS seq_operadoras;
CREATE TABLE IF NOT EXISTS operadoras (
  codoperadoras     integer PRIMARY KEY DEFAULT nextval('seq_operadoras'),
  operadora         varchar(50) NOT NULL,
  txadm             numeric(13,4) DEFAULT 0,     -- taxa % da administradora
  txadmparc         numeric(13,4) DEFAULT 0,     -- taxa % parcelado
  diascomp          integer DEFAULT 0,           -- dias p/ compensação (vencimento = dtvenda + diascomp×parcela)
  tipo              char(1),                     -- 'C' crédito / 'D' débito / 'A' alimentação/voucher
  tipocartao        integer,                     -- 1 débito / 2 crédito / 3 voucher / 99 pix/outros
  codbandeira       integer,                     -- código de bandeira/integração (soft ref)
  codadm            integer,                     -- adquirente como PARCEIRO (SPED) — soft ref
  codbanco          integer,                     -- banco de repasse — soft ref
  codoperadorabase  integer,                     -- herança leaf→base (0/null = a própria)
  ativo             char(1) DEFAULT 'S',
  indr              varchar(1),                  -- soft-delete I/E (padrão do engine)
  indr_usuario      integer,
  indr_data         timestamptz,
  usucadastro       integer,
  dtcadastro        timestamptz DEFAULT now(),
  usultalteracao    integer,
  dtultimalteracao  timestamptz
);
ALTER SEQUENCE seq_operadoras OWNED BY operadoras.codoperadoras;
CREATE OR REPLACE VIEW get_operadoras AS
  SELECT codoperadoras, codoperadoras AS codigo, operadora, txadm, txadmparc, diascomp, tipo, tipocartao,
         codbandeira, codadm, codbanco, ativo, indr
  FROM operadoras;

-- OPERADORAS_TAXA — override POR EMPRESA da taxa/dia-de-compensação (detalhe mestre-detalhe de OPERADORAS).
CREATE SEQUENCE IF NOT EXISTS seq_operadoras_taxa;
CREATE TABLE IF NOT EXISTS operadoras_taxa (
  idoperadorastaxa  integer PRIMARY KEY DEFAULT nextval('seq_operadoras_taxa'),
  codoperadoras     integer NOT NULL REFERENCES operadoras(codoperadoras) ON DELETE CASCADE,
  idempresa         integer NOT NULL,
  txadm             numeric(13,4) DEFAULT 0,     -- override do % (se >0 tem precedência sobre operadoras.txadm)
  diafechamento     integer,                     -- override do diascomp
  usucadastro       integer,
  dtcadastro        timestamptz DEFAULT now(),
  usultalteracao    integer,
  dtultimalteracao  timestamptz
);
ALTER SEQUENCE seq_operadoras_taxa OWNED BY operadoras_taxa.idoperadorastaxa;
CREATE UNIQUE INDEX IF NOT EXISTS ux_operadoras_taxa ON operadoras_taxa (codoperadoras, idempresa);

-- CARTAO — o recebível de cartão (1 linha por venda no cartão). Sem INDR (exclusão física, fiel — LIBERADO é o
-- flag de ciclo, não soft-delete). Colunas mortas do golden dropadas (valor_liquido/tx_aministrativo/resumo/
-- datavencimento/idnf/codcx/origem). Colunas de baixa (dtbaixa/idlote/valor_taxa_paga/…) existem mas só o corte-2
-- (baixa) as escreve.
CREATE SEQUENCE IF NOT EXISTS seq_cartao;
CREATE TABLE IF NOT EXISTS cartao (
  codvendcartao     integer PRIMARY KEY DEFAULT nextval('seq_cartao'),
  idempresa         integer NOT NULL,
  dtvenda           timestamptz DEFAULT now(),   -- data da venda
  nrocupom          varchar(8),
  nropedido         varchar(14),
  codpdv            integer,
  nroparcela        integer DEFAULT 1,
  qtde_parcelas     integer DEFAULT 1,
  codoperadora      integer NOT NULL REFERENCES operadoras(codoperadoras),
  idpgto            integer,                     -- forma de pagamento (soft ref)
  tipocartao        integer,
  codbandeira       integer,
  nsu               varchar(10),
  nsuhost           varchar(30),
  autorizacao       varchar(30),
  nrocartao         varchar(50),
  valor             numeric(13,2) NOT NULL DEFAULT 0,   -- BRUTO
  txefetiva         numeric(13,2),               -- taxa em R$ (preenchida pela conciliação; senão a view computa)
  valorliq          numeric(13,2),               -- líquido real (conciliação); senão a view computa (bruto − taxa)
  valor_operacao    numeric(13,2),
  liberado          char(1) DEFAULT 'N',         -- 'N' aberto / 'S' baixado (autoritativo)
  dtbaixa           timestamptz,
  idlote            integer,
  consiliado        char(1),
  contabilizado     varchar(1),
  codplc_taxa_cartao integer,
  codplc_acredesc   integer,
  valor_taxa_paga   numeric(15,2),
  valor_ajuste_baixa numeric(13,2),
  obs               varchar(2000),
  usucadastro       integer,
  dtcadastro        timestamptz DEFAULT now(),
  usultalteracao    integer,
  dtultimalteracao  timestamptz
);
ALTER SEQUENCE seq_cartao OWNED BY cartao.codvendcartao;
CREATE INDEX IF NOT EXISTS ix_cartao_empresa_lib ON cartao (idempresa, liberado);

-- GET_CARTAO — recebíveis com LÍQUIDO e VENCIMENTO computados (espelha a view GET_CARTAO do legado). Cobre abertos
-- E baixados (o front filtra por LIBERADO). Taxa efetiva = override-por-empresa (>0) > base (herança) > própria.
-- líquido = COALESCE(valorliq real, (bruto + ajuste) − bruto×txadm/100). vencimento = dtvenda + diascomp×parcela,
-- empurrando p/ frente se cair no fim de semana (dom→+1, sáb→+2), fiel ao GET_CARTAO.
CREATE OR REPLACE VIEW get_cartao AS
  SELECT c.codvendcartao, c.codvendcartao AS codigo, c.idempresa, c.dtvenda, c.nrocupom, c.nropedido, c.codpdv,
         c.nroparcela, c.qtde_parcelas, c.codoperadora, o.operadora, c.idpgto, c.tipocartao, c.codbandeira,
         c.nsu, c.autorizacao, c.valor, c.txefetiva, c.valorliq, c.liberado, c.dtbaixa, c.idlote, c.consiliado, c.obs,
         (CASE WHEN COALESCE(otx.txadm,0) > 0 THEN otx.txadm ELSE COALESCE(ot.txadm,0) END) AS txadm_efetiva,
         COALESCE(c.valorliq,
                  (c.valor + COALESCE(c.valor_ajuste_baixa,0))
                   - (c.valor * (CASE WHEN COALESCE(otx.txadm,0) > 0 THEN otx.txadm ELSE COALESCE(ot.txadm,0) END) / 100)
                 )::numeric(13,2) AS valor_com_taxa,
         (CASE extract(dow FROM (c.dtvenda::date + (COALESCE(otx.diafechamento, ot.diascomp, 0) * COALESCE(c.nroparcela,1))))
            WHEN 0 THEN c.dtvenda::date + (COALESCE(otx.diafechamento, ot.diascomp, 0) * COALESCE(c.nroparcela,1)) + 1
            WHEN 6 THEN c.dtvenda::date + (COALESCE(otx.diafechamento, ot.diascomp, 0) * COALESCE(c.nroparcela,1)) + 2
            ELSE c.dtvenda::date + (COALESCE(otx.diafechamento, ot.diascomp, 0) * COALESCE(c.nroparcela,1))
          END) AS previsao_compensacao
  FROM cartao c
  LEFT JOIN operadoras o  ON o.codoperadoras = c.codoperadora
  LEFT JOIN operadoras ot ON ot.codoperadoras = COALESCE(NULLIF(o.codoperadorabase,0), o.codoperadoras)
  LEFT JOIN operadoras_taxa otx ON otx.codoperadoras = ot.codoperadoras AND otx.idempresa = c.idempresa;

-- RBAC (operador 7 empresa 1+2): telas de operadoras e de cartão.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADOPERADORAS', 'BTNGRAVAR', 7, 1), ('FRMCADOPERADORAS', 'BTNGRAVAR', 7, 2),
  ('FRMCADOPERADORAS', 'BTNEXCLUIR', 7, 1), ('FRMCADOPERADORAS', 'BTNADICIONARREGISTRO', 7, 1), ('FRMCADOPERADORAS', 'BTNEDITAR', 7, 1),
  ('FRMCADCARTAO', 'BTNGRAVAR', 7, 1), ('FRMCADCARTAO', 'BTNGRAVAR', 7, 2),
  ('FRMCADCARTAO', 'BTNEXCLUIR', 7, 1), ('FRMCADCARTAO', 'BTNADICIONARREGISTRO', 7, 1), ('FRMCADCARTAO', 'BTNEDITAR', 7, 1)
ON CONFLICT DO NOTHING;
