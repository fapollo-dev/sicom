-- 199 — INTEGRAÇÃO CONTÁBIL (`FRMTRON`) corte-1: a CONFIGURAÇÃO e o que falta em `cartao`.
--
-- Decisão do usuário (08/09): migrar a integração contábil por completo, em três cortes por USO. Dossiê:
-- `uTron-integracao-contabil.md`. O corte-1 é a **baixa de cartões** — 1,34 milhão de linhas no diário do
-- cliente (61 taxas + 62 outras despesas + 51 a baixa), **77% de tudo**, com 58.879 lançamentos só em 2026.
--
-- ── 1. `CONFIG_INTEGRACAO_CONTABIL` ────────────────────────────────────────────────────────────────────────
-- Uma linha por instalação, com a SITUAÇÃO (o par de contas em `itens_integracao_contabil`) de cada tipo de
-- lançamento. O F5b já resolvia a conta por situação, mas lia a situação da NF; as demais origens leem daqui.
-- Trago as 60 colunas do legado — não só as três do corte-1 — porque a tabela é config de instalação, vem
-- inteira na carga, e recortá-la agora obrigaria a mexer no schema a cada corte seguinte.
--
-- ⚠️ `CHAVEAMENTO_PERIODO` é o gate de período da integração (`UIntegracaoContabil.pas:282`): data <= este
-- valor ⇒ bloqueia. Em produção está **NULL**, ou seja hoje não bloqueia nada. Vem como está.
CREATE TABLE IF NOT EXISTS config_integracao_contabil (
  id_configintegcontabil        integer PRIMARY KEY,
  chaveamento_periodo           date,
  -- caixa
  config_fechamentocaixa        integer,
  config_sobracaixa             integer,
  config_faltacaixa             integer,
  config_quebracaixarcb         integer,
  config_vendapdv               integer,
  config_troco_solidario        integer,
  config_recarga                integer,
  config_voucher                integer,
  config_correspondente         integer,
  -- financeiro
  config_transferencia_bancaria integer,
  config_baixa_rcb              integer,
  config_baixa_apg              integer,
  config_contapagaravulsa       integer,
  config_contapagaravulsasemcc  integer,
  config_contareceberavulsa     integer,
  config_contareceberavulsasemcc integer,
  config_juros_pagos            integer,
  config_acrescimos_pagos       integer,
  config_descontos_recebidos    integer,
  config_juros_recebidos        integer,
  config_acrescimos_recebidos   integer,
  config_descontos_concedidos   integer,
  config_descontos_apg          integer,
  config_embutidos_apg          integer,
  config_areceber_conv_func     integer,
  config_agrupamento_convenio   integer,
  -- cartão e cheque
  config_baixa_cartao           integer,   -- origem 51 · vale 893 no cliente
  config_taxa_cartao            integer,   -- origem 61 · vale 895
  config_outras_desp_cartao     integer,   -- origem 62 · vale 894
  config_baixa_cheque           integer,
  config_acresc_receb_chq       integer,
  config_desc_conc_chq          integer,
  -- notas e impostos
  config_icms_entradas_nf       integer,
  config_icms_saidas_nf         integer,
  config_pis_entradas_nf        integer,
  config_pis_saidas_nf          integer,
  config_cofins_entradas_nf     integer,
  config_cofins_saidas_nf       integer,
  config_icms_saidas_reducaoz   integer,
  config_pis_saidas_reducaoz    integer,
  config_cofins_saidas_reducaoz integer,
  config_custo_vendas           integer,
  config_custo_nf_venda         integer,
  config_dif_pedcompra_nf       integer,
  config_acordo_comer_desc_nf   integer,
  config_retencao_pis_nf        integer,
  config_retencao_cofins_nf     integer,
  config_retencao_csll_nf       integer,
  config_retencao_ir_nf         integer,
  config_retencao_inss_nf       integer,
  config_retencao_funrural_nf   integer,
  config_retencao_issqn_nf      integer,
  config_retencao_icmsst        integer,
  config_retencao_senar_nf      integer,
  -- NFC-e (PDV — a coluna vem para a carga não perder o valor; a origem 67 não é migrada)
  config_nfce                   integer,
  config_icms_nfce              integer,
  config_pis_nfce               integer,
  config_cofins_nfce            integer
);

-- ── 2. `cartao.valor_outras_despesas_paga` ─────────────────────────────────────────────────────────────────
-- A baixa de cartão tem TRÊS valores e nós só tínhamos dois: o líquido, a taxa (`valor_taxa_paga`, que já
-- existia) e as **outras despesas**, que faltava. É ela que decide se a origem 62 é lançada
-- (`UIntegracaoContabilBaixaCartao.pas:408`) e entra no líquido do lançamento principal (`:227`).
ALTER TABLE cartao ADD COLUMN IF NOT EXISTS valor_outras_despesas_paga numeric(15,2);

-- ── 3. `mov_contas_bancarias.idlote` — o elo que faltava ───────────────────────────────────────────────────
-- A contabilização casa os cartões do lote com **a movimentação bancária do mesmo lote** (`GetSQLMovimentacao`,
-- `UIntegracaoContabil.pas:1979`: `WHERE M.IDLOTE = :IDLOTE`). A coluna existe no legado e está preenchida em
-- **204.904 das 289.770** linhas (58.391 lotes), mas ficou fora da nossa carga — sem ela o corte-1 não tem
-- como somar o total baixado. Entra também no que o APP grava: `cartao-baixa.service` passa a carimbá-la.
ALTER TABLE mov_contas_bancarias ADD COLUMN IF NOT EXISTS idlote integer;
CREATE INDEX IF NOT EXISTS ix_mcb_idlote ON mov_contas_bancarias (idlote) WHERE idlote IS NOT NULL;

-- ── 4. `diario.documento` ──────────────────────────────────────────────────────────────────────────────────
-- Preenchido em **1.749.372 das 1.749.402** linhas do razão do cliente e ausente do nosso destino — a carga
-- estava jogando fora o número do documento de cada lançamento. Na baixa de cartão vale o `CODVENDCARTAO`.
ALTER TABLE diario ADD COLUMN IF NOT EXISTS documento varchar(60);

-- ⛔ `DIARIO.CODCC` NÃO entra: existe no legado e está preenchida em **0 das 1.749.402** linhas. Coluna morta —
-- o centro de custo do cartão (`CODPLC_TAXA_CARTAO`/`CODPLC_ACREDESC`) só serve para RESOLVER a conta contábil
-- quando a perna da IIC é automática, e para o gate "centro de custo não informado". Nunca é gravado no razão.

-- ── 5. RBAC ────────────────────────────────────────────────────────────────────────────────────────────────
-- O cliente concede só o gate da tela (`FRMTRON`, 21 operadores) — não há opção por botão.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES ('FRMTRON', 'FRMTRON', 7, 1)
ON CONFLICT DO NOTHING;

-- semente mínima para o ambiente de teste: a linha de config com as três situações do corte-1. Em produção a
-- linha vem da CARGA, com os 60 valores reais do cliente — por isso o WHERE NOT EXISTS.
INSERT INTO config_integracao_contabil (id_configintegcontabil, config_baixa_cartao, config_taxa_cartao, config_outras_desp_cartao)
SELECT 1, 893, 895, 894 WHERE NOT EXISTS (SELECT 1 FROM config_integracao_contabil);

-- ── 6. Contas e o mapa situação→contas do corte-1 (golden do cliente) ──────────────────────────────────────
-- 213 CARTOES A RECEBER já vem da mig 106. Faltavam as duas do cartão.
INSERT INTO plano_contas (codplanocontas, descricao, tipo, status) VALUES
  (542, 'CARTOES DE CREDITOS - BAIXAS', 'E', 'A'),
  (555, 'TAXA DE CARTAO',               'E', 'A')
ON CONFLICT (codplanocontas) DO NOTHING;

-- `ITENS_INTEGRACAO_CONTABIL` das três situações, campo a campo como está no cliente. Repare no CODHISTORICO:
-- na 893 as duas pernas têm histórico DIFERENTE (94 débito / 95 crédito) e nas outras duas é o MESMO (96).
-- Não é detalhe cosmético — é o que decide o FORMATO do lançamento (ver o serviço): histórico diferente por
-- perna ⇒ o legado grava DUAS linhas, cada uma com um lado só; histórico igual ⇒ UMA linha balanceada.
-- Prova no razão do cliente: 893 → 15.700 linhas só-débito + 15.700 só-crédito, ZERO balanceadas;
-- 894 → 110.053 balanceadas, ZERO single; 895 → 1.200.524 balanceadas, ZERO single.
INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil, codhistorico)
SELECT * FROM (VALUES
  (893, 'D', 'F', 542, 94),   -- BAIXA DE CARTAO
  (893, 'C', 'F', 213, 95),
  (894, 'D', 'F', 555, 96),   -- BAIXA DE CARTAO - DESPESAS
  (894, 'C', 'F', 213, 96),
  (895, 'D', 'F', 555, 96),   -- BAIXA DE CARTAO - TAXAS
  (895, 'C', 'A', NULL, 96)   -- ← perna AUTOMÁTICA: a conta sai do CODLANCCONTABIL da conta bancária
) AS v(codoperacao, natureza, tipo, codconta_contabil, codhistorico)
WHERE NOT EXISTS (SELECT 1 FROM itens_integracao_contabil i WHERE i.codoperacao = v.codoperacao AND i.natureza = v.natureza);
