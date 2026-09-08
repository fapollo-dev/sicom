-- 200 — INTEGRAÇÃO CONTÁBIL (`FRMTRON`) corte-2: BAIXAS DE CONTAS A PAGAR e A RECEBER (origens 15 · 16) e os
-- acessórios de cada uma — juros (53/56), acréscimos (54/57) e descontos (55/58).
-- Fonte: `UIntegracaoContabil.pas` (`TIntegracaoContabilBaixaContasPagar` :1587-1940 ·
-- `TIntegracaoContabilBaixaContasReceber` :3481-3849). Dossiê: `uTron-integracao-contabil.md`.
--
-- No razão do cliente: 15 → 47.828 linhas · 16 → 35.689 · 54 → 336 · 55 → 861 · 57 → 553 · 58 → 130.
-- As origens de JUROS (53 e 56) têm **ZERO linhas** — o cliente não cobra nem paga juros por esta via; a regra
-- entra assim mesmo, porque é a mesma passagem de código e o dado pode aparecer amanhã.

-- ── 1. `IDLOTE` nas baixas — o elo com a movimentação bancária ──────────────────────────────────────────────
-- É por ele que o legado casa as baixas do lote com a saída/entrada no banco. Preenchido em **100%** das linhas
-- do cliente (51.136 em `APAGAR_BX`, 19.080 em `ARECEBER_BX`) e, como aconteceu com `mov_contas_bancarias`,
-- estava **fora da nossa carga**.
ALTER TABLE apagar_bx   ADD COLUMN IF NOT EXISTS idlote integer;
ALTER TABLE areceber_bx ADD COLUMN IF NOT EXISTS idlote integer;
CREATE INDEX IF NOT EXISTS ix_apagar_bx_idlote   ON apagar_bx   (idlote) WHERE idlote IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_areceber_bx_idlote ON areceber_bx (idlote) WHERE idlote IS NOT NULL;

-- ── 2. Centros de custo dos acessórios ─────────────────────────────────────────────────────────────────────
-- `CODPLC_JUROS` e `CODPLC_ACREDESC` decidem a conta do lado "resultado" do juro / acréscimo / desconto, e são
-- gate: sem eles o legado recusa a baixa inteira. 4.942 e 4.463 linhas preenchidas em `APAGAR_BX`.
ALTER TABLE apagar_bx   ADD COLUMN IF NOT EXISTS codplc_acredesc integer;
ALTER TABLE apagar_bx   ADD COLUMN IF NOT EXISTS codplc_juros    integer;
ALTER TABLE areceber_bx ADD COLUMN IF NOT EXISTS codplc_acredesc integer;
ALTER TABLE areceber_bx ADD COLUMN IF NOT EXISTS codplc_juros    integer;

-- ── 3. Conta contábil POR TÍTULO e o desconto de duplicata ─────────────────────────────────────────────────
-- `COALESCE(A.CODPLANOCONTAS_DEB_BAIXA_CP, P.CODCONTABIL_FOR)` (`:1595`) — o título pode carregar a própria
-- conta e ela vence a do parceiro. `COD_DESCONTO_TITULO` exclui do lote os títulos descontados em banco
-- (`:1633` / `:3531`): eles têm contabilização própria e não podem entrar aqui.
ALTER TABLE apagar   ADD COLUMN IF NOT EXISTS codplanocontas_deb_baixa_cp  integer;
ALTER TABLE apagar   ADD COLUMN IF NOT EXISTS cod_desconto_titulo          integer;
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS codplanocontas_cred_baixa_cr integer;
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS cod_desconto_titulo          integer;

-- ── 4. A IIC das baixas volta a ser a do CLIENTE ───────────────────────────────────────────────────────────
-- A mig 055 semeou 2004/2009 com UMA perna FIXA (183 CAIXA CENTRAL) e registrou a divergência: "no legado AS
-- DUAS pernas são TIPO='A' (perna de dinheiro por RECURSO + perna do parceiro)". Aquilo servia enquanto só
-- existia o auto-disparo da baixa; agora que o caminho do TRON entra, a divergência atrapalha duas vezes:
--   · a perna de dinheiro do TRON sai da MOVIMENTAÇÃO BANCÁRIA do lote, não de uma conta fixa;
--   · na virada a carga TRUNCA a `itens_integracao_contabil` e traz as 224 linhas reais do cliente — ou seja,
--     o ambiente de teste ficaria com uma forma e a produção com outra.
-- Então a semente passa a ser a verdade do cliente, e quem resolve a perna de dinheiro é o SERVIÇO (pelo
-- recurso da baixa, com 183 CAIXA CENTRAL no dinheiro) — `baixa-contabil.service`, que deixa de exigir uma
-- perna fixa. Contas e históricos conferidos no Oracle: 2004 (91/221) e 2009 (92/93), as quatro pernas 'A'.
UPDATE itens_integracao_contabil SET tipo = 'A', codconta_contabil = NULL
 WHERE codoperacao IN (2004, 2009) AND tipo = 'F' AND codconta_contabil = 183;

-- ── 5. As situações dos ACESSÓRIOS (golden do cliente) ─────────────────────────────────────────────────────
INSERT INTO plano_contas (codplanocontas, descricao, tipo, status) VALUES
  (453,   'MULTAS DEDUTIVEIS',   'E', 'A'),
  (554,   'DESCONTOS OBTIDOS',   'E', 'A'),
  (460,   'DESCONTOS CONCEDIDOS','E', 'A'),
  (11291, 'JUROS RECEBIDOS',     'E', 'A')
ON CONFLICT (codplanocontas) DO NOTHING;

-- Em TODAS elas a perna do PARCEIRO é a automática e a do resultado é fixa — e as duas pernas têm o mesmo
-- histórico, ou seja saem numa linha balanceada só (confirmado: 336 · 861 · 553 · 130 linhas, zero single).
-- 874 e 877 (juros) não existem na IIC do cliente porque ele nunca lançou juros por aqui; ficam de fora da
-- semente para não inventar conta — o serviço acusa `SITUACAO_NAO_CONFIGURADA` se um dia aparecer juro.
INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil, codhistorico)
SELECT * FROM (VALUES
  (875, 'D', 'F', 453,   107),  -- CONTAS A PAGAR - ACRESCIMOS PAGOS      (D multas / C fornecedor)
  (875, 'C', 'A', NULL,  107),
  (876, 'D', 'A', NULL,  106),  -- CONTAS A PAGAR - DESCONTOS OBTIDOS     (D fornecedor / C descontos obtidos)
  (876, 'C', 'F', 554,   106),
  (878, 'D', 'A', NULL,   71),  -- CONTAS A RECEBER - BAIXA ACRESCIMOS    (D cliente / C juros recebidos)
  (878, 'C', 'F', 11291,  71),
  (879, 'D', 'F', 460,   161),  -- CONTAS A RECEBER - DESCONTO CONCEDIDO  (D descontos concedidos / C cliente)
  (879, 'C', 'A', NULL,  161)
) AS v(codoperacao, natureza, tipo, codconta_contabil, codhistorico)
WHERE NOT EXISTS (SELECT 1 FROM itens_integracao_contabil i WHERE i.codoperacao = v.codoperacao AND i.natureza = v.natureza);

-- as situações do acessório na config da instalação (o cliente: 875 · 876 · 878 · 879; juros sem valor).
UPDATE config_integracao_contabil SET
  config_acrescimos_pagos     = coalesce(config_acrescimos_pagos,     875),
  config_descontos_recebidos  = coalesce(config_descontos_recebidos,  876),
  config_acrescimos_recebidos = coalesce(config_acrescimos_recebidos, 878),
  config_descontos_concedidos = coalesce(config_descontos_concedidos, 879),
  config_baixa_apg            = coalesce(config_baixa_apg,           2004),
  config_baixa_rcb            = coalesce(config_baixa_rcb,           2009);
