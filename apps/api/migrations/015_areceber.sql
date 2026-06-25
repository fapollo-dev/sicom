-- ARECEBER (contas a receber) — subset legado Oracle homolog.
-- É a tabela que o detalhe do lote referencia (ITENS_LOTECOB.CODRCB → ARECEBER.CODRCB) e
-- de onde TODO o grid de itens é LIVE-JOINED (duplicata, cliente, datas, valor, juros…).
-- Subset CONFIRMADO no Oracle (não re-consultado): codrcb (PK), codparceiro, codempresa
-- (ATENÇÃO: ARECEBER usa CODEMPRESA, não IDEMPRESA), dtvenda, dtvenc, duplicata, valor,
-- txjuros, consiliado. Tipos: NUMBER→integer/numeric, TIMESTAMP→timestamptz, VARCHAR2→varchar.
CREATE SEQUENCE IF NOT EXISTS seq_areceber_codrcb;

CREATE TABLE IF NOT EXISTS areceber (
  codrcb      integer PRIMARY KEY DEFAULT nextval('seq_areceber_codrcb'),
  codparceiro integer,                 -- cliente do documento (→ parceiros.codparceiro)
  codempresa  integer NOT NULL,        -- escopo multi-tenant por empresa (≠ IDEMPRESA)
  dtvenda     timestamptz,             -- "Emissão" no grid
  dtvenc      timestamptz,             -- "Venc." no grid; base do atraso/juros
  duplicata   varchar(20),
  valor       numeric(13,2),
  txjuros     numeric(13,2),
  consiliado  char(1)                  -- 'S' = conciliado (filtro do picker quando há fechamento)
);
ALTER SEQUENCE seq_areceber_codrcb OWNED BY areceber.codrcb;

-- Seed de documentos. codrcb EXPLÍCITO para cobrir EXATAMENTE os valores que o smoke/teste
-- existentes referenciam nos itens do agregado (1, 100, 101, 102, 200, 201, 202, 300, 400,
-- 500, 999) — assim os JOINs do detalhe retornam linha e a FK lógica é satisfeita.
-- Todos em codempresa=1 (a empresa do smoke: x-empresa-id=1). Datas variadas: algumas já
-- vencidas (geram juros conforme tolerancia do cliente), outras a vencer. consiliado mix.
INSERT INTO areceber (codrcb, codparceiro, codempresa, dtvenda, dtvenc, duplicata, valor, txjuros, consiliado) VALUES
  (1,   20, 1, '2026-05-01', '2026-06-01', 'DUP-0001', 1000.00, 10.00, 'S'),
  (100, 20, 1, '2026-05-02', '2026-06-02', 'DUP-0100',  500.00,  9.00, 'S'),
  (101, 21, 1, '2026-05-03', '2026-06-15', 'DUP-0101',  750.50, 12.00, 'N'),
  (102, 21, 1, '2026-05-04', '2026-07-10', 'DUP-0102', 1200.00,  8.00, 'S'),
  (200, 22, 1, '2026-04-10', '2026-05-10', 'DUP-0200',  300.00, 15.00, 'S'),
  (201, 22, 1, '2026-04-15', '2026-05-20', 'DUP-0201',  980.00, 10.00, 'S'),
  (202, 20, 1, '2026-05-20', '2026-06-25', 'DUP-0202',  640.00,  9.50, 'N'),
  (300, 21, 1, '2026-03-01', '2026-04-01', 'DUP-0300',  450.00, 11.00, 'S'),
  (400, 22, 1, '2026-03-15', '2026-04-20', 'DUP-0400',  210.00,  7.00, 'N'),
  (500, 20, 1, '2026-06-01', '2026-08-01', 'DUP-0500', 1500.00, 10.00, 'S'),
  (999, 21, 1, '2026-02-01', '2026-03-01', 'DUP-0999',  125.00, 13.00, 'S')
ON CONFLICT (codrcb) DO NOTHING;
SELECT setval('seq_areceber_codrcb', (SELECT COALESCE(MAX(codrcb), 1) FROM areceber));

-- View GET_ARECEBER — o "picker" de documentos (btnAddIten → frmPesquisa 'GET_ARECEBER').
-- Legado filtra por IDEMPRESA e (quando há fechamento de caixa) CONSILIADO='S'. Aqui
-- expomos as colunas CRUAS que o endpoint tenant-scoped filtra (codempresa, consiliado,
-- codrcb) MAIS os aliases legado-fiéis usados pelo grid (CLIENTE/RAZAO, DATA_VENCIMENTO,
-- DATA_VENDA, JURO, TOTAL, *_COBRANCA…). DIAS_ATRAZO/DIAS_TOLERANCIA e JURO/TOTAL usam a
-- MESMA fórmula do detalhe (ver 016_lote_cobranca_full.sql) — carência por PARCEIROS.TOLERANCIA.
CREATE OR REPLACE VIEW get_areceber AS
SELECT
  r.codrcb,
  r.codparceiro,
  r.codempresa,
  r.consiliado,
  p.razao,
  r.duplicata,
  r.dtvenda,
  r.dtvenc,
  r.valor,
  r.txjuros,
  -- dias de atraso (>=0) e tolerância do cliente
  GREATEST(0, (CURRENT_DATE - r.dtvenc::date))                                   AS dias_atrazo,
  COALESCE(p.tolerancia, 0)                                                      AS dias_tolerancia,
  -- JURO: se atraso < tolerancia ⇒ 0; senão txjuros/30 * dias_atraso * valor/100
  CAST(
    CASE WHEN (CURRENT_DATE - r.dtvenc::date) < COALESCE(p.tolerancia, 0) THEN 0
         ELSE COALESCE((r.txjuros / 30.0)
                       * GREATEST(0, (CURRENT_DATE - r.dtvenc::date))
                       * r.valor / 100, 0)
    END AS numeric(13,2))                                                         AS juro,
  -- TOTAL: valor (+ juro quando há atraso além da tolerância)
  CAST(
    CASE WHEN (CURRENT_DATE - r.dtvenc::date) < COALESCE(p.tolerancia, 0) THEN r.valor
         ELSE r.valor + COALESCE((r.txjuros / 30.0)
                       * GREATEST(0, (CURRENT_DATE - r.dtvenc::date))
                       * r.valor / 100, 0)
    END AS numeric(13,2))                                                         AS total,
  e.endereco,
  e.bairro,
  e.cidade,
  e.uf,
  e.telefone
FROM areceber r
LEFT JOIN parceiros p     ON (p.codparceiro = r.codparceiro)
LEFT JOIN parceiros_end e ON (e.codend = p.codend);
