-- 303 — PEDIDO DE COMPRA MULTI-LOJA: a quantidade por loja e o fechamento por loja.
-- Adiado como "cross-docking" por decisão do usuário sobre "2% dos pedidos" (número da homologação); na produção
-- são 78% dos pedidos de 2024-2026, e o usuário mandou converter (23/09/2026). Oracle de produção (só leitura).
--
-- ── O modelo do legado ───────────────────────────────────────────────────────────────────────────────
-- `PEDIDOCOMPRA.EMPRESAS` é um CSV das lojas participantes ('1, 2' em 2.192 pedidos desde 2024, '1' em 539, '2'
-- em 39); o pedido NÃO tem IDEMPRESA. O comprador escolhe as lojas entre as que o operador acessa, e pode trocá-las
-- depois ("Alterar empresas participantes", uPedidoCompra.pas:3951). O pedido "pertence" à loja que está no CSV
-- (`PedidoPertenceEmpresaSelecionada`, :3766) — é o que habilita as ações.
--
-- `PEDIDO_COMPRA_QTDE` é a quantidade de cada item EM CADA LOJA: QTDE (caixas), QTDTOTAL = QTDE × FATOREMBALAGEM,
-- TOTALCUSTO = QTDE × VLREMBALAGEM (:1971-1972). Uma linha por item e loja (0 duplicadas), sempre dentro do CSV
-- (0 fora); a linha AUSENTE é quantidade zero (21.328 itens de 2025-26 não têm todas as lojas — o legado tem o botão
-- "retirar quantidade zerada"). O total do item é a soma das lojas — a carga já o faz (Achado 3).
--
-- ── O fechamento é POR LOJA ──────────────────────────────────────────────────────────────────────────
-- "Fechar" marca FECHADO/DATA_FECHAMENTO/CODOPERADOR só nas linhas da LOJA LOGADA (:7780) e põe o cabeçalho em
-- 'S'; "Reabrir" desfaz só as dela (:7840). O estado do pedido é derivado das linhas (`ItemFechado`, :4817):
-- TOTAL quando todas as lojas com linha fecharam, PARCIAL quando só algumas, NENHUM. E as ações seguem esse estado:
--   digitar/apagar a quantidade de uma loja ........ bloqueia se AQUELA loja fechou (:2002, :2055)
--   editar o pedido ................................. bloqueia se TODAS fecharam ou a LOJA LOGADA fechou (:6610)
--   adicionar item .................................. bloqueia se TODAS fecharam (:4432)
--   excluir pedido, excluir item, limpar itens ...... bloqueia se QUALQUER loja fechou (:6664, :6709, :7090)
-- No cliente: 88 mil linhas fechadas por loja desde 2025. Cada fechar/reabrir grava `PEDIDO_COMPRA_HISTORICO`
-- ('Pedido fechado para a empresa N…' 32, 'Pedido reaberto para a empresa N…' 232).
--
-- `PEDIDO_COMPRA_EMPRESA` é o CSV normalizado (15.070 linhas, todas dentro do CSV; `PCE_FRETE` zero em todas).
-- `DIGITACAO_FECHADA` é 'N' em todas as linhas — carregada, sem regra.

-- as lojas do pedido, como o legado grava ('1, 2'); o pedido que já existe no Apollo é da sua loja
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS empresas varchar(250);
UPDATE pedidocompra SET empresas = idempresa::text WHERE empresas IS NULL;

CREATE SEQUENCE IF NOT EXISTS seq_pedido_compra_qtde;
CREATE TABLE IF NOT EXISTS pedido_compra_qtde (
  codpedqtde                integer PRIMARY KEY DEFAULT nextval('seq_pedido_compra_qtde'),
  -- ⚠️ neto do pedido: o item é regravado a cada salvamento (motor de agregado), e a linha por loja é reinserida
  -- com o fechamento da loja preservado (`pedido-compra.aggregate.ts`)
  codpedcompi               integer NOT NULL REFERENCES pedidocompra_i(codpedcompi) ON DELETE CASCADE,
  idempresa                 integer NOT NULL,
  qtde                      numeric(13,4) NOT NULL DEFAULT 0,  -- caixas
  qtdtotal                  numeric(13,4),                     -- = qtde × fatorembalagem (unidades)
  totalcusto                numeric(13,2),                     -- = qtde × vlrembalagem
  -- o FECHAMENTO da loja (as três colunas andam juntas)
  fechado                   char(1),
  codoperador               integer,
  data_fechamento           timestamptz,
  codcomprador              integer,
  digitacao_fechada         varchar(1),
  digitacao_data_fechamento timestamptz,
  digitacao_codoperador     integer,
  indr                      varchar(1)
);
ALTER SEQUENCE seq_pedido_compra_qtde OWNED BY pedido_compra_qtde.codpedqtde;
CREATE UNIQUE INDEX IF NOT EXISTS ux_pedido_compra_qtde ON pedido_compra_qtde (codpedcompi, idempresa);
CREATE INDEX IF NOT EXISTS ix_pedido_compra_qtde_loja ON pedido_compra_qtde (idempresa, fechado);

CREATE TABLE IF NOT EXISTS pedido_compra_empresa (
  codpedcomp  integer NOT NULL,
  codempresa  integer NOT NULL,
  pce_frete   numeric(15,2),
  indr        varchar(1),
  PRIMARY KEY (codpedcomp, codempresa)
);

CREATE SEQUENCE IF NOT EXISTS seq_pedido_compra_historico;
CREATE TABLE IF NOT EXISTS pedido_compra_historico (
  pch_id         integer PRIMARY KEY DEFAULT nextval('seq_pedido_compra_historico'),
  codpedcomp     integer NOT NULL,
  pch_data       timestamptz NOT NULL DEFAULT now(),
  codoperador    integer,
  pch_historico  varchar(1000) NOT NULL
);
ALTER SEQUENCE seq_pedido_compra_historico OWNED BY pedido_compra_historico.pch_id;
CREATE INDEX IF NOT EXISTS ix_pedido_compra_historico ON pedido_compra_historico (codpedcomp, pch_data);

-- a view expõe as lojas: é por elas que a loja participante enxerga o pedido
CREATE OR REPLACE VIEW get_pedidocompra AS
SELECT
  pc.codpedcomp AS codigo,
  pc.codpedcomp,
  pc.idempresa,
  pc.data,
  pc.codparceiro,
  f.razao        AS fornecedor,
  pc.codoperador,
  pc.dt_vencimento,
  pc.codconpagto,
  pc.pc_tipo_frete,
  pc.pc_valor_frete,
  pc.pc_nronf_cruzamento,
  pc.fechado,
  pc.bonificacao,
  pc.idsituacao_nf,
  pc.dtfaturamento,
  pc.dtencerramento,
  pc.obs,
  pc.indr,
  COALESCE((SELECT SUM(i.totalcusto) FROM pedidocompra_i i WHERE i.codpedcomp = pc.codpedcomp), 0) AS total,
  COALESCE((SELECT COUNT(*)          FROM pedidocompra_i i WHERE i.codpedcomp = pc.codpedcomp), 0) AS qtde_itens,
  pc.empresas
FROM pedidocompra pc
LEFT JOIN parceiros f ON f.codparceiro = pc.codparceiro;

-- linhas por loja para os itens que já existem no Apollo: uma, da loja do pedido, com a quantidade do item — e o
-- fechamento do cabeçalho, que para pedido de uma loja só é o fechamento da loja
INSERT INTO pedido_compra_qtde (codpedcompi, idempresa, qtde, qtdtotal, totalcusto, fechado)
SELECT i.codpedcompi, p.idempresa, coalesce(i.qtde, 1), i.qtdtotal, i.totalcusto,
       CASE WHEN p.fechado = 'S' THEN 'S' END
  FROM pedidocompra_i i JOIN pedidocompra p ON p.codpedcomp = i.codpedcomp
 WHERE NOT EXISTS (SELECT 1 FROM pedido_compra_qtde q WHERE q.codpedcompi = i.codpedcompi);
