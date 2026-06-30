-- NOTA FISCAL — Fase 4: FATURAMENTO (geração de títulos financeiros). Efeito de DINHEIRO.
-- A NF gera títulos em ARECEBER (saída) / APAGAR (entrada) por IDNF, a partir de uma condição
-- de pagamento (nº parcelas + vencimentos). No legado os títulos eram criados FORA da transação
-- do estoque (não-atômico); aqui o faturamento é uma ação explícita e ATÔMICA (NfFaturamentoService).
-- Doc: dossiê uNF.md §6. SEM trigger.

-- ARECEBER (015) é subset mínimo do Lote; acrescenta o necessário p/ um título de NF.
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS idnf    integer;          -- vínculo com a NF (nullable: títulos manuais/legados)
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS quitada char(1) DEFAULT 'N'; -- trava de estorno (não apagar título liquidado)
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS nrodup  integer;          -- nº da parcela
CREATE INDEX IF NOT EXISTS ix_areceber_idnf ON areceber (idnf);

-- APAGAR não existia — espelha ARECEBER para a ENTRADA (NF tipo 'E'). Usa codempresa por
-- simetria com areceber e com o valor único de tenant (divergência do nome legado IDEMPRESA).
CREATE SEQUENCE IF NOT EXISTS seq_apagar_codapg;
CREATE TABLE IF NOT EXISTS apagar (
  codapg      integer PRIMARY KEY DEFAULT nextval('seq_apagar_codapg'),
  codparceiro integer,                 -- fornecedor (→ parceiros.codparceiro)
  codempresa  integer NOT NULL,        -- escopo multi-tenant por empresa
  idnf        integer,                 -- vínculo com a NF
  dtvenda     timestamptz,             -- emissão/compra
  dtvenc      timestamptz,             -- vencimento
  duplicata   varchar(20),
  nrodup      integer,                 -- nº da parcela
  valor       numeric(13,2),
  txjuros     numeric(13,2),
  quitada     char(1) DEFAULT 'N',
  consiliado  char(1) DEFAULT 'N'
);
ALTER SEQUENCE seq_apagar_codapg OWNED BY apagar.codapg;
CREATE INDEX IF NOT EXISTS ix_apagar_idnf ON apagar (idnf);

-- Flag de faturamento na NF (idempotência do faturar + gate do estorno). Default 'N'.
ALTER TABLE nf ADD COLUMN IF NOT EXISTS faturada char(1) DEFAULT 'N';

-- RBAC das ações de faturamento (operador 7, empresa 1).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMNF', 'BTNFATURAR',              7, 1),
  ('FRMNF', 'BTNESTORNARFATURAMENTO',  7, 1);
