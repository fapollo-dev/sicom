-- 059 — AJUSTE DE ESTOQUE (FRMAJUSTEESTOQUE): o movimento MANUAL que escreve no saldo de ESTOQUE (hoje só a
-- NF move, via 027). Tabela FLAT (Oracle AJUSTE_ESTOQUE, 1 linha = 1 ajuste de 1 produto). Fórmula confirmada
-- no Oracle: AUMENTAR → qtdeatual = qtdeanterior + qtde; DIMINUIR → qtdeanterior − qtde; SUBSTITUIR → = qtde.
-- Move estoque.qtde + grava kardex historico_prod (origem='AJUSTE'). SEM contábil (o DIÁRIO não tem codorigem
-- de ajuste; a valoração do estoque é via CMV/inventário, não por-ajuste). DESTINO (LOJA/ESTOQUE) é guardado
-- como rótulo — nosso estoque é single-bucket (o split loja/depósito = ESTOQUE_DEP, adiado).

-- MOTIVOS_OPERACAO — lookup do motivo do ajuste (compartilhado no legado com cancelamento/quebra).
CREATE SEQUENCE IF NOT EXISTS seq_motivos_operacao;
CREATE TABLE IF NOT EXISTS motivos_operacao (
  codmotivoop      integer PRIMARY KEY DEFAULT nextval('seq_motivos_operacao'),
  descricao        varchar(60) NOT NULL,
  tipo_operacao    varchar(20),                 -- classificação legada (CANC_*/CR/AJUSTE…)
  indr             varchar(1),                  -- soft-delete I/E (padrão do engine)
  indr_usuario     integer,
  indr_data        timestamptz,
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_motivos_operacao OWNED BY motivos_operacao.codmotivoop;
CREATE OR REPLACE VIEW get_motivos_operacao AS
  SELECT codmotivoop, codmotivoop AS codigo, descricao, tipo_operacao, indr FROM motivos_operacao;

-- Seed de motivos de ajuste de estoque (motivos operacionais reais de supermercado).
INSERT INTO motivos_operacao (codmotivoop, descricao, tipo_operacao) VALUES
  (1,  'ERRO DE CONTAGEM',         'AJUSTE'),
  (2,  'PRODUTO AVARIADO',         'AJUSTE'),
  (3,  'PRODUTO VENCIDO',          'AJUSTE'),
  (4,  'PERDA / QUEBRA',           'AJUSTE'),
  (5,  'CONSUMO INTERNO',          'AJUSTE'),
  (6,  'ACERTO DE INVENTARIO',     'AJUSTE')
ON CONFLICT (codmotivoop) DO NOTHING;
SELECT setval('seq_motivos_operacao', (SELECT GREATEST(COALESCE(MAX(codmotivoop),1), 6) FROM motivos_operacao));

-- AJUSTE_ESTOQUE — o movimento (flat, append-only; estorno = ajuste compensatório).
CREATE SEQUENCE IF NOT EXISTS seq_ajuste_estoque;
CREATE TABLE IF NOT EXISTS ajuste_estoque (
  codajuste      integer PRIMARY KEY DEFAULT nextval('seq_ajuste_estoque'),
  idproduto      integer NOT NULL REFERENCES produtos(idproduto),
  idempresa      integer NOT NULL,
  operacao       varchar(12) NOT NULL,          -- AUMENTAR / DIMINUIR / SUBSTITUIR
  destino        varchar(12),                   -- LOJA / ESTOQUE (rótulo; single-bucket)
  qtde           numeric(13,3) NOT NULL,        -- quantidade do ajuste (sempre > 0)
  qtdeanterior   numeric(13,3),                 -- saldo antes (auditoria)
  qtdeatual      numeric(13,3),                 -- saldo depois (auditoria)
  codmotivo      integer NOT NULL REFERENCES motivos_operacao(codmotivoop),
  codoperador    integer NOT NULL,              -- legado NOT NULL + FK; o service exige operador (fail-closed)
  origem         varchar(10) DEFAULT 'A',       -- 'A' ajuste manual / 'I' inventário (Oracle)
  idorigem       integer,                       -- vínculo (inventário; null no manual)
  obs            varchar(1000),                 -- capacidade do legado (OBS VARCHAR2(1000))
  estornado      char(1),                       -- 'S' = estornado (reverte o saldo; convenção monorepo — legado é append-only)
  codoperador_estorno integer,
  dtcadastro     timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_ajuste_estoque OWNED BY ajuste_estoque.codajuste;
CREATE INDEX IF NOT EXISTS ix_ajuste_estoque_prod ON ajuste_estoque (idproduto, idempresa);

-- RBAC (operador 7 empresa 1+2): a tela de ajuste + o cadastro de motivos.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMAJUSTEESTOQUE', 'BTNAJUSTAR',        7, 1),
  ('FRMAJUSTEESTOQUE', 'BTNAJUSTAR',        7, 2),
  ('FRMAJUSTEESTOQUE', 'BTNESTORNAR',       7, 1),
  ('FRMAJUSTEESTOQUE', 'BTNESTORNAR',       7, 2),
  ('FRMCADMOTIVOOPERACAO', 'BTNGRAVAR',     7, 1),
  ('FRMCADMOTIVOOPERACAO', 'BTNEXCLUIR',    7, 1),
  ('FRMCADMOTIVOOPERACAO', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADMOTIVOOPERACAO', 'BTNEDITAR',     7, 1)
ON CONFLICT DO NOTHING;
