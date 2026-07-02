-- 045 — CONTAS A PAGAR (uCadAPagar), gêmea de A Receber: cadastro/gestão (corte-1) + baixa/pagamento
-- (corte-2) numa migration só. Espelha 043+044 para a tabela APAGAR (PK codapg, tenant codempresa),
-- já com as correções auditadas em A Receber (valorpg>0, estorno por PK). NÃO tem "em lote de cobrança"
-- (isso é de recebíveis) — a baixa de A Pagar não checa itens_lotecob.

-- ── colunas de gestão/estado/auditoria (espelha 043) ──
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS dtpgto                 timestamptz;
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS txmulta                numeric(13,2);
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS desconto_boleto        numeric(13,2);
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS tipodoc                varchar(25);
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS origem                 varchar(1);
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS gerado                 varchar(10);
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS cadastrado_manualmente varchar(1) DEFAULT 'N';
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS idpgto                 integer;
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS codbco                 integer;
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS codplc                 integer;
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS obs                    text;
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS nroped                 varchar(20);
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS nrocupom               varchar(20);
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS idsituacao_nf          integer;
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS agrupado               varchar(1) DEFAULT 'N';
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS contabilizado          char(1);
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS usultalteracao         integer;
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS dtultimalteracao       timestamptz;
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS dtcadastro             timestamptz;

CREATE INDEX IF NOT EXISTS ix_apagar_codempresa  ON apagar (codempresa);
CREATE INDEX IF NOT EXISTS ix_apagar_codparceiro ON apagar (codparceiro);

-- Seed (fornecedor codparceiro 22) com variedade de ESTADO p/ o smoke. codapg alto (7001+) p/ não
-- colidir com os títulos que a NF de entrada gera via sequence; setval avança a sequence após o seed.
INSERT INTO apagar (codapg, codparceiro, codempresa, dtvenda, dtvenc, duplicata, valor, txjuros, quitada, consiliado,
                    gerado, cadastrado_manualmente, tipodoc) VALUES
  (7001, 22, 1, '2026-05-01', '2026-06-01', 'APG-7001', 800.00, 5.00, 'N', 'S', 'OPERADOR', 'S', 'DUPLICATA'),
  (7002, 22, 1, '2026-05-02', '2027-01-01', 'APG-7002', 500.00, 5.00, 'N', 'S', 'OPERADOR', 'S', 'DUPLICATA'),
  (7003, 22, 1, '2026-04-10', '2026-05-10', 'APG-7003', 300.00, 5.00, 'S', 'S', 'OPERADOR', 'S', 'DUPLICATA'),
  (7004, 22, 1, '2026-04-15', '2026-05-20', 'APG-7004', 980.00, 5.00, 'N', 'S', 'OPERADOR', 'S', 'DUPLICATA'),
  (7005, 22, 1, '2026-03-01', '2026-04-01', 'APG-7005', 450.00, 5.00, 'N', 'S', 'SISTEMA',  'N', 'DUPLICATA'),
  (7006, 22, 1, '2026-03-15', '2026-04-20', 'APG-7006', 210.00, 5.00, 'N', 'S', 'OPERADOR', 'S', 'DUPLICATA'),
  (7007, 22, 1, '2026-02-01', '2026-03-01', 'APG-7007', 125.00, 5.00, 'N', 'S', 'SISTEMA',  'N', 'DUPLICATA'),
  (7008, 22, 1, '2026-06-01', '2027-01-01', 'APG-7008', 640.00, 5.00, 'N', 'S', 'OPERADOR', 'S', 'DUPLICATA')
ON CONFLICT (codapg) DO NOTHING;
UPDATE apagar SET quitada = 'S'                                    WHERE codapg = 7003; -- pago
UPDATE apagar SET agrupado = 'S'                                   WHERE codapg = 7004; -- agrupado
UPDATE apagar SET idnf = 9999, gerado = 'SISTEMA'                  WHERE codapg = 7005; -- gerado por NF
UPDATE apagar SET contabilizado = 'S'                             WHERE codapg = 7006; -- contabilizado
UPDATE apagar SET origem = 'Q', gerado = 'SISTEMA'                 WHERE codapg = 7007; -- origem automática
UPDATE apagar SET consiliado = 'S', cadastrado_manualmente = 'N'   WHERE codapg = 7008; -- conciliado (não-manual)
SELECT setval('seq_apagar_codapg', (SELECT GREATEST(COALESCE(MAX(codapg),1), 7008) FROM apagar));

-- View GET_APAGAR — espelha get_areceber (juro/total live, carência por PARCEIROS.TOLERANCIA).
CREATE OR REPLACE VIEW get_apagar AS
SELECT
  a.codapg,
  a.codparceiro,
  a.codempresa,
  a.consiliado,
  p.razao,
  a.duplicata,
  a.dtvenda,
  a.dtvenc,
  a.valor,
  a.txjuros,
  GREATEST(0, (CURRENT_DATE - a.dtvenc::date))                                   AS dias_atrazo,
  COALESCE(p.tolerancia, 0)                                                      AS dias_tolerancia,
  CAST(
    CASE WHEN (CURRENT_DATE - a.dtvenc::date) < COALESCE(p.tolerancia, 0) THEN 0
         ELSE COALESCE((a.txjuros / 30.0) * GREATEST(0, (CURRENT_DATE - a.dtvenc::date)) * a.valor / 100, 0)
    END AS numeric(13,2))                                                         AS juro,
  CAST(
    CASE WHEN (CURRENT_DATE - a.dtvenc::date) < COALESCE(p.tolerancia, 0) THEN a.valor
         ELSE a.valor + COALESCE((a.txjuros / 30.0) * GREATEST(0, (CURRENT_DATE - a.dtvenc::date)) * a.valor / 100, 0)
    END AS numeric(13,2))                                                         AS total,
  a.idnf, a.nrodup, a.quitada, a.agrupado, a.contabilizado, a.tipodoc, a.origem, a.gerado,
  a.cadastrado_manualmente, a.dtpgto, a.idpgto, a.codbco, a.codplc, a.idsituacao_nf
FROM apagar a
LEFT JOIN parceiros p ON (p.codparceiro = a.codparceiro);

-- Baixa/pagamento (corte-2): APAGAR_BX (1 título → N baixas; estorno LÓGICO via INDR 'I'/'E').
CREATE SEQUENCE IF NOT EXISTS seq_apagar_bx_codapgbx;
CREATE TABLE IF NOT EXISTS apagar_bx (
  codapgbx      integer PRIMARY KEY DEFAULT nextval('seq_apagar_bx_codapgbx'),
  codapg        integer NOT NULL REFERENCES apagar(codapg) ON DELETE CASCADE,
  codempresa    integer NOT NULL,
  valorpg       numeric(13,2),
  juros         numeric(13,2) DEFAULT 0,
  multa         numeric(13,2) DEFAULT 0,
  acre_desc     numeric(13,2) DEFAULT 0,
  dtpgto        timestamptz,
  codopbx       integer,
  data_operacao timestamptz,
  indr          varchar(1) DEFAULT 'I',
  contabilizado char(1),
  obs           text
);
ALTER SEQUENCE seq_apagar_bx_codapgbx OWNED BY apagar_bx.codapgbx;
CREATE INDEX IF NOT EXISTS ix_apagar_bx_codapg  ON apagar_bx (codapg);
CREATE INDEX IF NOT EXISTS ix_apagar_bx_empresa ON apagar_bx (codempresa);

-- RBAC da tela FRMCADAPAGAR (empresa 1 = smoke; 2 = teste de tenant do serviço).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADAPAGAR', 'BTNGRAVAR',            7, 1),
  ('FRMCADAPAGAR', 'BTNEXCLUIR',           7, 1),
  ('FRMCADAPAGAR', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADAPAGAR', 'BTNEDITAR',            7, 1),
  ('FRMCADAPAGAR', 'BTNBAIXAR',            7, 1),
  ('FRMCADAPAGAR', 'BTNESTORNARBAIXA',     7, 1),
  ('FRMCADAPAGAR', 'BTNGRAVAR',            7, 2),
  ('FRMCADAPAGAR', 'BTNBAIXAR',            7, 2),
  ('FRMCADAPAGAR', 'BTNESTORNARBAIXA',     7, 2);
