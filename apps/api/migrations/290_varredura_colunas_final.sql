-- 290 — o resto da varredura origem → destino: kardex, cartão, CFOP, pedido e preço.
-- Fecha a série 286-289. O que sobra depois desta migration são colunas isoladas, todas declaradas com
-- prova em `ORIGEM_DECLARADA`. Contagens no Oracle de produção (só leitura), 22/09/2026.
--
-- ── ⚠️ 1. O KARDEX GUARDAVA A QUANTIDADE E NÃO O VALOR ───────────────────────────────────────────────
-- `HISTORICO_PROD` tem **13.968.279 linhas** e o destino trouxe o movimento em quantidade (a mig do kardex
-- mapeou `qtde_alter → qtde` e `qtde_atual → saldo_novo`). Ficaram de fora:
--   · `valor_alter` e `valor_atual` — **445.233 linhas com valor, R$ 6.455.305,54** cada;
--   · `id_origem_documento` — **11.810.697 linhas, 2.668.620 documentos distintos**: é o que liga cada
--     movimento de estoque ao documento que o causou.
-- Sem o valor, o kardex responde "quanto entrou" e não "por quanto"; sem a origem, não responde "de onde".
--
-- ── 2. O CARTÃO perdia os três operadores ────────────────────────────────────────────────────────────
-- Em 2.025.583 recebíveis: `codoperador` (2.068.857 preenchidos), `codoperadoraorigem` (2.031.051) e
-- `codopbx` (1.769.287 — o operador da baixa). São a autoria de quem lançou, de qual operadora veio e de
-- quem baixou: a trilha inteira do recebível de cartão.
--
-- ── 3. O CFOP perdia REGRAS, não dados ───────────────────────────────────────────────────────────────
-- `ALTERA_CUSTO_NF` está em **389 dos 398 CFOPs** com 'S': é o CFOP dizendo se a entrada por ele **altera o
-- custo do produto**. Sem essa coluna toda entrada passaria a alterar custo (ou nenhuma), conforme o
-- default — e é a diferença entre bonificação mexer ou não no preço. Junto vêm `abater_cfop` e
-- `codplanocontas` (a conta contábil por CFOP).
--
-- ── 4. Pedido de compra e preço ──────────────────────────────────────────────────────────────────────
-- `pedidocompra_i.vendaliq` (206.179 itens, R$ 2.417.795,77) e `vrcustob` (199.083, R$ 1.727.767,64) — de
-- novo a escada de custo, como nas migs 287 e 288. E `multi_preco` perdia `codfigurafiscal` (194.212),
-- `idpiscofins` (192.548) e `idtabela` (117.548): a figura fiscal e o enquadramento de PIS/COFINS **do
-- preço**, que é por onde a precificação decide a carga tributária da venda.

-- ── 1. kardex ────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE historico_prod ADD COLUMN IF NOT EXISTS valor_alter        numeric(15,4);
ALTER TABLE historico_prod ADD COLUMN IF NOT EXISTS valor_atual        numeric(15,4);
ALTER TABLE historico_prod ADD COLUMN IF NOT EXISTS id_origem_documento integer;
COMMENT ON COLUMN historico_prod.id_origem_documento IS
  'o documento que causou o movimento: 11.810.697 linhas, 2.668.620 documentos distintos';
CREATE INDEX IF NOT EXISTS ix_historico_prod_origem_doc ON historico_prod (id_origem_documento)
  WHERE id_origem_documento IS NOT NULL;

-- ── 2. a trilha do recebível de cartão ───────────────────────────────────────────────────────────────
ALTER TABLE cartao ADD COLUMN IF NOT EXISTS codoperador        integer;
ALTER TABLE cartao ADD COLUMN IF NOT EXISTS codoperadoraorigem integer;
ALTER TABLE cartao ADD COLUMN IF NOT EXISTS codopbx            integer;

-- ── 3. as regras do CFOP ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS altera_custo_nf char(1);
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS abater_cfop     char(1);
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS codplanocontas  integer;
COMMENT ON COLUMN cfop.altera_custo_nf IS
  'se a entrada por este CFOP altera o custo do produto — S em 389 dos 398 CFOPs do cliente';

-- ── 4. pedido de compra e preço ──────────────────────────────────────────────────────────────────────
ALTER TABLE pedidocompra_i ADD COLUMN IF NOT EXISTS vendaliq numeric(15,4);
ALTER TABLE pedidocompra_i ADD COLUMN IF NOT EXISTS vrcustob numeric(15,4);
ALTER TABLE multi_preco ADD COLUMN IF NOT EXISTS codfigurafiscal integer;
ALTER TABLE multi_preco ADD COLUMN IF NOT EXISTS idpiscofins     integer;
ALTER TABLE multi_preco ADD COLUMN IF NOT EXISTS idtabela        integer;

-- ── 5. os pequenos, que também são regra ─────────────────────────────────────────────────────────────
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS codpdv integer;                    -- 82.108 títulos
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS idunico varchar(40);             -- 15.441, chave externa
ALTER TABLE cotacao_prod ADD COLUMN IF NOT EXISTS codoperador integer;           -- 5.179, autoria
ALTER TABLE contas_bancarias ADD COLUMN IF NOT EXISTS exibe_saldo_emp char(1);   -- 36
ALTER TABLE contas_bancarias_op ADD COLUMN IF NOT EXISTS visualizar_saldos       char(1);
ALTER TABLE contas_bancarias_op ADD COLUMN IF NOT EXISTS habiltiar_lanca_saldo   char(1);
ALTER TABLE contas_bancarias_op ADD COLUMN IF NOT EXISTS habiltiar_troca_valores char(1);
ALTER TABLE contabilista ADD COLUMN IF NOT EXISTS codcontabilista integer;
ALTER TABLE contabilista ADD COLUMN IF NOT EXISTS cod_mun integer;
ALTER TABLE operadoras ADD COLUMN IF NOT EXISTS codrede integer;                 -- 70 operadoras
ALTER TABLE apuracao_pc_det ADD COLUMN IF NOT EXISTS valorpisapura    numeric(15,2);
ALTER TABLE apuracao_pc_det ADD COLUMN IF NOT EXISTS valorcofinsapura numeric(15,2);
ALTER TABLE nf_prod_ibscbs ADD COLUMN IF NOT EXISTS codcclass_trib_ncm_anexos integer;
