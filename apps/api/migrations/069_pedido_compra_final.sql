-- 069 — PEDIDO DE COMPRA: cortes FINAIS da tela (recon exaustiva uPedidoCompra.pas + uso real Oracle).
--
-- (A) PROPAGAÇÃO DE PREÇO AO CATÁLOGO ("o pedido forma o preço") — REGRA VIVA de alto volume no golden:
--     95,5% dos preços de 2024+ em MULTI_PRECO batem com o VRVENDA do item do pedido. Ação explícita de menu
--     (nunca no gravar): UPDATE MULTI_PRECO SET VRVENDA=<item> (uPedidoCompra.pas:3517) + HISTORICO_DINAMICO
--     ('Atualização on-line de preço, pedido de compra Nro: X'). Gate: produto em promoção não é atualizado
--     (legado: PROMOCAO_ACUMULATIVA [módulo ausente no novo] → proxy conservador multi_preco.promocao='S',
--     documentado). Config ATUALIZA_PRECO_OUTRAS_EMPRESAS: 'S' propaga a todas as empresas ('N' no tenant).
--     LOTEPRECO (fila de etiquetas/PDV) + cascade pai/filho (189 produtos; falta DIF_PRECO no novo) = ADIADOS.
--
-- (B) LIMITE DIÁRIO/SEMANAL DE COMPRA + LIBERAÇÃO — ativo no tenant (VALOR_MAXIMO_SEMANAL_PC=270.000 via
--     override; 233 liberações reais 2021-24). Gate no FECHAR (divergência consciente: o legado valida no
--     gravar; o fechar é o commit do pedido no novo). Fluxo = Σ parcelas de OUTROS pedidos ABERTOS na janela
--     + o fluxo DESTE pedido (materializado OU PROJETADO das CDs quando não há parcelas — A1, espelha o
--     RatearTotalNasParcelas(False) que o legado roda no gravar). Modo FLUXO_CAIXA_SOMENTE_VALOR_PC='P' do
--     legado (GET_FLUXOSAIDAS/contas a pagar ficam com o fluxo visual, adiado). Liberação: grant LIBERAVALORMAX
--     (a senha de supervisor do legado é cifra proprietária → espera OPERADORES corte-3/auth) → grava
--     OPERADOR_ULT_LIB_VALOR_MAX (fiel, :3752), REARMADA na reabertura (M1: liberação vale só p/ o fechar que
--     a seguiu, como o LiberouLimiteDiario transiente do legado). DIVERGÊNCIA (M8): o legado escolhe UM modo
--     via TIPO_FLUXO_CAIXA_PC ('D' xor 'S'); aqui roda o que estiver configurado (>0) — se ambos setados, ambos
--     valem (mais restritivo; o tenant real só usa SEMANAL). ADIADO: TIPO_FLUXO_CAIXA_PC exclusivo.
--
-- (C) BONIFICAÇÃO (pedido-espelho; uso residual: 7 em 6 anos; CODPEDCOMP_BONIFICADO=MORTO [0 refs no fonte
--     e 0 usos]) + DUPLICAR PEDIDO (DM:1653-1853). O detail-staging BONIFICACAO/BONIFICACAO_QTDE do legado é
--     dispensado: o espelho é gerado direto dos itens (documentado). Acordo comercial (gate mínimo) = ADIADO.
--
-- (D) GATES DO GRAVAR: OBRIGA_INFORMAR_CONDICOES_PAGAMENTO (exige condição/CD), prazo máximo por fornecedor
--     (PARCEIROS.QTDE_DIAS_MAXIMO_FP_PC, VerificaFP :6792), pendências financeiras do fornecedor
--     (AVISA_PENDENCIAS_FORNECEDOR: 'B' bloqueia — join A Receber não-quitado), SITUAÇÃO-NF no header
--     (SetaSituacaoNF :5130; o gerar-NF carrega à NF de entrada).
--
-- (E) IMPORTAR ITENS EM MASSA (ImportaItens :8242): produtos ASSOCIADOS (CODFOR) ou já COMPRADOS (histórico)
--     do fornecedor; ATIVO/ATIVO_COMPRA lidos de PRODUTOS (M4, GetSQLProdutos:8313); custo = MULTI_PRECO.VRCUSTO
--     (ou VRCUSTOREP se CUSTO_REP_PC='S'); produto SEM preço na empresa não é candidato (INNER JOIN do legado —
--     evita item custo-0); fator = de-para CODREFERENCIA_FOR (se USAR_FATOR_EMBALAGEM_REFERENCIA_FORNECEDOR='S')
--     senão PRODUTOS.FATORCX. ADIADAS: variantes tabela-do-fornecedor/da-NF/coletor; exclusão de
--     PRODUTOS_FORN_DESASSOCIADOS (M5 — tabela não migrada, parte do épico de-para do recebimento); CarregaOBSForn.
--
-- MORTOS confirmados (0 refs no fonte OU 0 uso no golden — NÃO migrar): NOVO_LIMITE, CODPEDCOMP_BONIFICADO,
-- PEDIDOCOMPRA.IMPORTADO (coberto por nf.codpedcomp+UNIQUE), e-mail pós-gravar (comentado), CD6-CD8 (0%).

-- ── (cfg) chaves de configuração ─────────────────────────────────────────────────────────────────
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (321, 'ATUALIZA_PRECO_OUTRAS_EMPRESAS', 'N', 'S/N', 'Modulo;Empresa', 'Propagação de preço do pedido: S atualiza MULTI_PRECO de TODAS as empresas; N só a empresa do pedido.'),
  (322, 'VALOR_MAXIMO_DIARIO_PC',  '0', 'numero', 'Modulo;Empresa', 'Limite de desembolso DIÁRIO em pedidos de compra (Σ parcelas de pedidos abertos no dia). 0 = sem limite.'),
  (323, 'VALOR_MAXIMO_SEMANAL_PC', '0', 'numero', 'Modulo;Empresa', 'Limite de desembolso SEMANAL (dom-sáb) em pedidos de compra. 0 = sem limite. (Tenant real usa 270.000.)'),
  (324, 'OBRIGA_INFORMAR_CONDICOES_PAGAMENTO', 'N', 'S/N', 'Modulo;Empresa', 'Exige condição de pagamento (codconpagto ou CD1..CD8) ao gravar o pedido de compra.'),
  (325, 'AVISA_PENDENCIAS_FORNECEDOR', 'N', 'texto', 'Modulo;Empresa', 'Pendências financeiras do fornecedor (A Receber não quitado) no pedido: N ignora / S avisa (front) / B bloqueia.'),
  (326, 'CUSTO_REP_PC', 'N', 'S/N', 'Modulo;Empresa', 'Importar itens: usa VRCUSTOREP (custo de reposição) como custo do item em vez de VRCUSTO.'),
  (327, 'USAR_FATOR_EMBALAGEM_REFERENCIA_FORNECEDOR', 'N', 'S/N', 'Modulo;Empresa', 'Importar itens: fator de embalagem vem da referência do fornecedor (de-para) em vez de PRODUTOS.FATORCX.')
ON CONFLICT (id) DO NOTHING;

-- ── colunas novas ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS operador_ult_lib_valor_max integer;  -- liberador do limite (fiel :3752)
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS bonificacao char(1) DEFAULT 'N';     -- pedido-espelho de bonificação
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS idsituacao_nf integer;               -- situação-NF (carrega ao gerar-NF)
ALTER TABLE pedidocompra_i ADD COLUMN IF NOT EXISTS bonificacao numeric(13,2);         -- % bonificado do item (100 no espelho)
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS qtde_dias_maximo_fp_pc integer;         -- prazo máx (dias) de CD por fornecedor

-- ── view de listagem: expõe bonificacao (pintura azul do legado) + idsituacao_nf ─────────────────
-- DROP+CREATE (não OR REPLACE): as colunas novas entram no MEIO da lista e o CREATE OR REPLACE VIEW do
-- Postgres proíbe reordenar colunas de uma view existente (erro checkViewColumns).
DROP VIEW IF EXISTS get_pedidocompra;
CREATE VIEW get_pedidocompra AS
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
  COALESCE((SELECT SUM(i.vlrembalagem) FROM pedidocompra_i i WHERE i.codpedcomp = pc.codpedcomp), 0) AS total,
  COALESCE((SELECT COUNT(*)            FROM pedidocompra_i i WHERE i.codpedcomp = pc.codpedcomp), 0) AS qtde_itens
FROM pedidocompra pc
LEFT JOIN parceiros f ON f.codparceiro = pc.codparceiro;

-- ── RBAC: liberação do limite é grant PRÓPRIO (espelha USUARIOS_LIBERAM_VALOR_MAX_EXCEDIDO) ───────
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMPEDIDOCOMPRA', 'LIBERAVALORMAX', 7, 1),
  ('FRMPEDIDOCOMPRA', 'LIBERAVALORMAX', 7, 2)
ON CONFLICT DO NOTHING;
