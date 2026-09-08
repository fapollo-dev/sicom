-- 201 — INTEGRAÇÃO CONTÁBIL (`FRMTRON`) corte-3: os lançamentos POR DOCUMENTO — cadastro de contas a pagar
-- (13) e a receber (14), transferências entre contas (19), adiantamento a parceiros (63), movimentação de
-- caixa (64) e agrupamento de convênio (65).
-- Fonte: `UIntegracaoContabil.pas` — `TIntegracaoContabilContasPagar` :1225-1440 · `…ContasReceber` :3940-4180
-- · `TIntegracaoMovimentacaoCaixa` :2585-2760 · `TIntegracaoAdiantamento` :2828-3010 ·
-- `TIntegracaoAgrupamentoConvenio` :3117-3300 · `TIntegracaoTransferenciaContas` :4283-4400.
--
-- No razão do cliente: 19 → 17.581 · 65 → 15.119 · 64 → 7.261 · 14 → 6.711 · 13 → 3.935 · 63 → 547.
--
-- A diferença para os cortes 1 e 2: aqui a SITUAÇÃO não vem da configuração, vem **de cada documento**
-- (`IDSITUACAO_NF`) — por isso a origem 13 aparece com 37 situações distintas e a 64 com 21. Só a
-- transferência (2020) e o convênio (910) são fixos na config.

-- ── 1. O que falta em `APAGAR` ─────────────────────────────────────────────────────────────────────────────
-- `CODGRUPO` amarra o título ao seu RATEIO por centro de custo em `CX_APAGAR` — é o dataset de débito do
-- lançamento. `DTCOMPRA` é a data do lançamento. As três estão preenchidas em ~100% do cliente (54.869 /
-- 54.865 / 54.265 de 54.872) e **nenhuma entrava na nossa carga**.
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS codgrupo                  integer;
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS dtcompra                  date;
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS desconto                  numeric(13,2);
-- os três filtros de elegibilidade que faltavam (`:1240-1243`): agrupado, adiantamento e título-filho ficam
-- fora — cada um tem o seu próprio caminho contábil.
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS agrupamento               char(1);
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS codapg_pai                integer;
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS contabilizado_agrupamento char(1);

-- ── 2. O que falta em `ARECEBER` ───────────────────────────────────────────────────────────────────────────
-- `CODGRUPO_AGRUPAMENTO_APG` liga o recebível ao grupo do convênio (16.227 linhas) e
-- `CONTABILIZADO_AGRUPAMENTO` é o flag próprio dessa origem — não o `CONTABILIZADO` do recebível (15.085).
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS agrupamento               char(1);
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS codgrupo_agrupamento_apg  integer;
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS contabilizado_agrupamento char(1);
CREATE INDEX IF NOT EXISTS ix_areceber_grupo_apg ON areceber (codgrupo_agrupamento_apg) WHERE codgrupo_agrupamento_apg IS NOT NULL;

-- ── 3. O que falta em `MOV_CONTAS_BANCARIAS` ───────────────────────────────────────────────────────────────
-- A transferência entre contas é reconhecida por `NRODOCUMENTO LIKE '%TRANSFERENCIA%'` (`:4304`) e datada por
-- `DTEMISSAO`. Preenchidas em 289.813 (100%) e 120.769 linhas no cliente — **as duas fora da carga**, e sem
-- elas a origem 19 (a terceira maior do razão) não teria como ser encontrada. 37.572 linhas casam com o LIKE.
ALTER TABLE mov_contas_bancarias ADD COLUMN IF NOT EXISTS dtemissao    date;
ALTER TABLE mov_contas_bancarias ADD COLUMN IF NOT EXISTS nrodocumento varchar(30);

-- ── 4. Config e situações ──────────────────────────────────────────────────────────────────────────────────
UPDATE config_integracao_contabil SET
  config_transferencia_bancaria = coalesce(config_transferencia_bancaria, 2020),
  config_agrupamento_convenio   = coalesce(config_agrupamento_convenio,    910);

INSERT INTO plano_contas (codplanocontas, descricao, tipo, status) VALUES
  (219, 'ADIANTAMENTO DE SALARIOS',        'E', 'A'),
  (230, 'ADIANTAMENTOS',                   'E', 'A'),
  (384, 'OUTROS GASTOS DIRETOS COM PESSOAL','E','A'),
  (204, 'TRANSITORIO DE DESPESAS',         'E', 'A')
ON CONFLICT (codplanocontas) DO NOTHING;

-- As situações que o CLIENTE usa nestas origens, com as contas e históricos dele. Repare na 910: é a única do
-- corte-3 com histórico DIFERENTE por perna (104/105) — e é por isso que o agrupamento de convênio sai como
-- 1 débito + N créditos (15.089 só-crédito e 30 só-débito em 30 grupos), enquanto as demais saem balanceadas.
INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil, codhistorico)
SELECT * FROM (VALUES
  (2020, 'D', 'A', NULL, 86),   -- TRANSFERÊNCIAS BANCÁRIAS: as duas pontas são conta bancária
  (2020, 'C', 'A', NULL, 86),
  ( 910, 'D', 'F',  219, 104),  -- AGRUPAMENTO CONVENIO: débito fixo, crédito no parceiro de cada título
  ( 910, 'C', 'A', NULL, 105),
  (3140, 'D', 'A', NULL, 89),   -- CONTAS A RECEBER APOLLO SISTEMAS (a situação mais usada na origem 14)
  (3140, 'C', 'A', NULL, 89),
  (1011, 'D', 'F',  230, 87),   -- ADIANTAMENTO / PAGAMENTO
  (1011, 'C', 'A', NULL, 87),
  (1012, 'D', 'A', NULL, 87),   -- ADIANTAMENTO / RECEBIMENTO
  (1012, 'C', 'A', NULL, 87),
  ( 586, 'D', 'F',  384, 88),   -- GASTOS COM PESSOAL (a mais usada nas origens 13 e 64)
  ( 586, 'C', 'A', NULL, 88),
  ( 566, 'D', 'A', NULL, 121),  -- DESPESAS BANCARIAS: as duas pernas automáticas (1.755 linhas na origem 64)
  ( 566, 'C', 'A', NULL, 121)
) AS v(codoperacao, natureza, tipo, codconta_contabil, codhistorico)
WHERE NOT EXISTS (SELECT 1 FROM itens_integracao_contabil i WHERE i.codoperacao = v.codoperacao AND i.natureza = v.natureza);

INSERT INTO situacao_nf (idsituacao_nf, descricao) VALUES
  (2020, 'TRANSFERENCIAS BANCARIAS'), (910, 'AGRUPAMENTO CONVENIO'),
  (3140, 'CONTAS A RECEBER APOLLO SISTEMAS'), (1011, 'PAGAMENTO'), (1012, 'RECEBIMENTO'),
  (586, 'GASTOS COM PESSOAL'), (566, 'DESPESAS BANCARIAS')
ON CONFLICT (idsituacao_nf) DO NOTHING;
