-- 060 — PEDIDO DE COMPRA (FRMPEDIDOCOMPRA): a MAIOR tela do legado (uPedidoCompra.pas, 8973 linhas).
-- Agregado mestre-detalhe: PEDIDOCOMPRA (cabeçalho) + PEDIDOCOMPRA_I (itens). Recon Oracle (10.378 pedidos /
-- 286.854 itens): documento de INTENÇÃO de compra (previsão) — o FATO (fiscal/estoque/financeiro definitivos)
-- nasce na NF de entrada que referencia o pedido (NF.CODPEDCOMP, vínculo invertido; ainda não migrado → adiado).
-- SEM efeitos: no legado o pedido é TRANSACIONAL PURO (nenhum trigger no cabeçalho; o único trigger é auditoria
-- no item). Corte-1 = NÚCLEO (cabeçalho + itens) + workflow FECHADO (rascunho→fechado) + soft-delete.
--
-- Achados decisivos do recon refletidos aqui:
--  • QUANTIDADE do item = FATOREMBALAGEM (NÃO existe coluna "qtd" no legado).
--  • VLREMBALAGEM = FATOREMBALAGEM × VRCUSTO (custo estendido do item; confirmado 100% nas amostras) — derivado
--    server-side. Total do pedido = Σ VLREMBALAGEM (o cabeçalho NÃO persiste totais → calculado na view/on-demand).
--  • Item NÃO tem CFOP/UNIDADE (vêm do produto/regra fiscal). Impostos do item (ICME/IPI/PISCONFIS) são ALÍQUOTAS
--    de SIMULAÇÃO, não valores — o imposto definitivo é da NF → ADIADO (não replicar cálculo fiscal no pedido).
--  • markup/vrvenda/margens = analítica do motor `precificacao` (SUGESTÃO) → ADIADO (reuso opcional em corte-2).
--  • EMPRESAS (legado) é um CSV "1-para-N-lojas" (COMPRA_1_PARA_N_LOJAS quase sempre 'N'). Corte-1 é single-empresa
--    (empresaScoped IDEMPRESA, padrão do monorepo); o 1-para-N é feature ADIADA.

-- ── Cabeçalho ────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_pedidocompra;
CREATE TABLE IF NOT EXISTS pedidocompra (
  codpedcomp          integer PRIMARY KEY DEFAULT nextval('seq_pedidocompra'),
  idempresa           integer NOT NULL,                         -- escopo multi-tenant (empresaScoped)
  codparceiro         integer NOT NULL REFERENCES parceiros(codparceiro), -- fornecedor (PARCEIROS.FRN='S')
  codoperador         integer,                                  -- comprador (server-set = operador do contexto no create)
  data                timestamptz NOT NULL DEFAULT now(),       -- emissão do pedido
  dt_vencimento       timestamptz,                              -- vencimento negociado (condição de pgto = corte-2)
  codconpagto         integer,                                  -- código da condição de pgto (lookup CONDICOES_PAGTO = corte-2)
  pc_tipo_frete       varchar(3),                               -- 'CIF' / 'FOB'
  pc_valor_frete      numeric(15,2),                            -- valor do frete (header)
  pc_nronf_cruzamento varchar(500),                             -- nº da NF do fornecedor (conferência manual)
  obs                 varchar(2000),
  fechado             char(1) NOT NULL DEFAULT 'N',             -- workflow: 'N' rascunho → 'S' fechado (state-controlled)
  dtfaturamento       timestamptz,                              -- estado (faturado) — via NF de entrada (corte-2)
  dtencerramento      timestamptz,                              -- estado (encerrado) — via NF de entrada (corte-2)
  indr                varchar(1),                               -- soft-delete I/E (padrão do engine)
  indr_usuario        integer,
  indr_data           timestamptz,
  usultalteracao      integer,
  dtultimalteracao    timestamptz,
  dtcadastro          timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_pedidocompra OWNED BY pedidocompra.codpedcomp;
CREATE INDEX IF NOT EXISTS ix_pedidocompra_emp ON pedidocompra (idempresa, codparceiro);

-- ── Itens ────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_pedidocompra_i;
CREATE TABLE IF NOT EXISTS pedidocompra_i (
  codpedcompi     integer PRIMARY KEY DEFAULT nextval('seq_pedidocompra_i'),
  codpedcomp      integer NOT NULL REFERENCES pedidocompra(codpedcomp),
  idproduto       integer NOT NULL REFERENCES produtos(idproduto),
  fatorembalagem  numeric(13,2) NOT NULL,          -- QUANTIDADE pedida (o legado não tem coluna "qtd")
  vrcusto         numeric(12,4) NOT NULL,          -- custo unitário negociado com o fornecedor
  vlrembalagem    numeric(18,4),                   -- = fatorembalagem × vrcusto (custo estendido; derivado server-side; largo p/ nunca truncar o produto)
  desconto        numeric(12,4),                   -- desconto do item (valor)
  descontop       numeric(6,2),                    -- desconto do item (%)
  obs             varchar(1000),
  indr            varchar(1)                       -- (itens são substituídos no update; coluna p/ paridade)
);
ALTER SEQUENCE seq_pedidocompra_i OWNED BY pedidocompra_i.codpedcompi;
CREATE INDEX IF NOT EXISTS ix_pedidocompra_i_ped ON pedidocompra_i (codpedcomp);

-- ── View de listagem (Pesquisa) ────────────────────────────────────────────────
-- Total = Σ VLREMBALAGEM dos itens (o cabeçalho NÃO persiste total — fiel ao legado). Fornecedor via JOIN.
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
  pc.dtfaturamento,
  pc.dtencerramento,
  pc.obs,
  pc.indr,
  COALESCE((SELECT SUM(i.vlrembalagem) FROM pedidocompra_i i WHERE i.codpedcomp = pc.codpedcomp), 0) AS total,
  COALESCE((SELECT COUNT(*)            FROM pedidocompra_i i WHERE i.codpedcomp = pc.codpedcomp), 0) AS qtde_itens
FROM pedidocompra pc
LEFT JOIN parceiros f ON f.codparceiro = pc.codparceiro;

-- ── RBAC (operador 7, empresas 1+2) ────────────────────────────────────────────
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMPEDIDOCOMPRA', 'BTNGRAVAR',  7, 1),
  ('FRMPEDIDOCOMPRA', 'BTNGRAVAR',  7, 2),
  ('FRMPEDIDOCOMPRA', 'BTNEXCLUIR', 7, 1),
  ('FRMPEDIDOCOMPRA', 'BTNEXCLUIR', 7, 2),
  ('FRMPEDIDOCOMPRA', 'BTNFECHAR',  7, 1),
  ('FRMPEDIDOCOMPRA', 'BTNFECHAR',  7, 2),
  ('FRMPEDIDOCOMPRA', 'BTNREABRIR', 7, 1),
  ('FRMPEDIDOCOMPRA', 'BTNREABRIR', 7, 2)
ON CONFLICT DO NOTHING;
