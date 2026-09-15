-- 222 — DIGITAÇÃO DE PEDIDOS (`FRMDIGITACAOPEDIDOS`). 116 acessos, 9 operadores.
--
-- O **pedido de venda** — balcão, televenda, entrega. Não confundir com `PEDIDOCOMPRA` (`FRMPEDIDOCOMPRA`,
-- já migrado): aqui é o que a loja VENDE.
--
-- ⚠️ **`PEDIDOS` é 1 linha por ITEM**, não por pedido: o cabeçalho está repetido em cada linha
-- (`NROPEDIDO` agrupa). Em produção: **37.080 linhas em 25.784 pedidos**, de 2020 a **30/07/2026**.
--
-- ── O épico encolheu, e o dado é que disse ──────────────────────────────────────────────────────────────
-- O legado tem 12.876 linhas de fonte nesta família: a tela (3.271 + 4.116 de `.dfm`), o data module
-- (374 + 1.331) e **três telas auxiliares** — formas de pagamento (811), produção (2.108) e o RDM (865).
-- Medido na produção em 15/09/2026, o substrato das auxiliares está **todo zerado**:
--
--   `PEDIDOS_PARCELAS` 0 · `PEDIDOSPRODUCAO` 0 · `PEDIDOSPRODUCAO_ITENS` 0 · `PEDIDOS_COZINHA` 0 ·
--   `PEDIDOS_IMPRESSORA` 0
--
-- Este cliente usa o **pedido simples**: sem parcelamento próprio, sem produção/cozinha, sem impressora de
-- setor. As 2.919 linhas dessas telas não têm o que migrar — e é por isso que o corte-1 cobre a tela toda
-- para ele, em vez de um pedaço.
--
-- ── 56 colunas de 108 ───────────────────────────────────────────────────────────────────────────────────
-- Contadas uma a uma no dado: **52 das 108 colunas estão inteiramente nulas** em 37.080 linhas. Trazemos as
-- 56 vivas; as outras entram quando (e se) alguém as usar, com o mesmo critério.
CREATE SEQUENCE IF NOT EXISTS seq_pedidos;
CREATE TABLE IF NOT EXISTS pedidos (
  -- ⚠️ como em `vendas`, a PK do legado identifica o ITEM, e aqui a sequência garante a chave por linha
  codpedidos      bigint PRIMARY KEY DEFAULT nextval('seq_pedidos'),
  nropedido       varchar(20) NOT NULL,          -- o que agrupa as linhas num pedido
  idempresa       integer NOT NULL,
  nroitem         integer,
  codproduto      integer,
  codbarra        varchar(20),
  descricao       varchar(150),
  unidade         char(3),
  aliquota        char(3),
  qtde            numeric(15,3) DEFAULT 0,
  fatoremb        numeric(15,4) DEFAULT 1,
  vrvenda         numeric(15,2) DEFAULT 0,
  vrcusto         numeric(15,2) DEFAULT 0,
  vrcustorep      numeric(15,2) DEFAULT 0,
  vrcustocsi      numeric(15,4) DEFAULT 0,
  vrfrete         numeric(15,2) DEFAULT 0,
  -- desconto/acréscimo: o do ITEM e o rateado do pedido
  desc_acre_item  numeric(15,2) DEFAULT 0,
  desc_acre       numeric(15,2) DEFAULT 0,
  promocao        char(1) DEFAULT 'N',
  -- a promoção acumulativa (`FRMCADPROMOCAOACUMULATIVA`, mig 214) chega ao pedido por estas duas
  desc_promo_acumulativa    numeric(15,2) DEFAULT 0,
  qtde_promocao_acumulativa numeric(15,3) DEFAULT 0,
  aplica_flex     char(1),
  bonificado      char(1),
  troca           char(1),
  -- categoria, para o relatório agrupar sem ir ao cadastro
  coddpto         integer,
  codgrupo        integer,
  codsubgrupo     integer,
  codsecao        integer,
  -- quem vende e para quem
  codparceiro     integer,
  codparceiro_end integer,
  cliente         varchar(120),
  codvendedor     integer,
  comissao        numeric(13,4) DEFAULT 0,
  operador        integer,
  -- entrega
  entregar        char(1) DEFAULT 'N',
  obs_entrega     varchar(255),
  -- situação: processado no estoque, no financeiro, cancelado e o motivo
  proc            char(1) DEFAULT 'N',
  proc_fin        char(1) DEFAULT 'N',
  cancelado       char(1) DEFAULT 'N',
  tipocanc        char(1),
  tipo            char(1),
  processo_liquidado char(1),
  cupom_emitido   char(1),
  importado       char(1),
  consultapdv     char(1),
  flaggravado     char(1),
  origem          varchar(30),
  origem_documento varchar(30),
  id_origem_documento integer,
  chave           varchar(60),
  pis             char(2),
  dtvenda         timestamp,
  dt_fatu         timestamp,
  dtcadastro      timestamp DEFAULT now(),
  usultalteracao  integer,
  dtultimalteracao timestamp,
  -- o CODPEDIDOS do legado, preservado como em `vendas.codvendas_legado`
  codpedidos_legado bigint
);

CREATE INDEX IF NOT EXISTS ix_pedidos_nro      ON pedidos (idempresa, nropedido);
CREATE INDEX IF NOT EXISTS ix_pedidos_dtvenda  ON pedidos (idempresa, dtvenda);
CREATE INDEX IF NOT EXISTS ix_pedidos_parceiro ON pedidos (codparceiro) WHERE codparceiro IS NOT NULL;

INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMDIGITACAOPEDIDOS', 'FRMDIGITACAOPEDIDOS', 7, 1)
ON CONFLICT DO NOTHING;
