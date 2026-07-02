-- 043 — CONTAS A RECEBER, corte-1 (cadastro/gestão): enriquece ARECEBER com as colunas que a
-- tela uCadAReceber edita/exibe + auditoria + índices, e amplia a view get_areceber para o grid.
-- (Recon Oracle: ARECEBER tem 95 colunas; migramos o SUBSET que o cadastro/gestão usa. Baixa e
--  agrupamento in-place ficam no corte-2/§10.) A tabela usa CODEMPRESA (≠ IDEMPRESA) — o módulo
--  vertical de A Receber filtra por codempresa (como o Lote de Cobrança).

-- ── colunas de gestão do documento (uCadAReceber.dfm "Dados gerais") ──
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS dtpgto                 timestamptz;   -- data de pagamento (baixa)
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS txmulta                numeric(13,2); -- % multa (snapshot EMPRESAS.PERCENT_MULTA)
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS desconto_boleto        numeric(13,2); -- % desconto do boleto
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS tipodoc                varchar(25);   -- DUPLICATA/BOLETO/A VISTA/…
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS origem                 varchar(1);    -- A/B/F/Q/O/C (getter legado)
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS gerado                 varchar(10);   -- SISTEMA/OPERADOR
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS cadastrado_manualmente varchar(1) DEFAULT 'N';
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS codvendedor            integer;       -- parceiros (FUN)
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS codcobrador            integer;       -- parceiros (FUN)
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS idpgto                 integer;       -- forma de pagamento/modalidade
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS codbco                 integer;       -- banco
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS codplc                 integer;       -- centro de custo (PLC)
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS obs                    text;
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS nroped                 varchar(20);
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS nrocupom               varchar(20);
-- ── estado (read-only na tela; travam editar/excluir) ──
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS idsituacao_nf          integer;
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS agrupado               varchar(1) DEFAULT 'N';
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS contabilizado          char(1);
-- ── auditoria (o service carimba; espelha o form-base) ──
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS usultalteracao         integer;
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS dtultimalteracao       timestamptz;
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS dtcadastro             timestamptz;

CREATE INDEX IF NOT EXISTS ix_areceber_codempresa  ON areceber (codempresa);
CREATE INDEX IF NOT EXISTS ix_areceber_codparceiro ON areceber (codparceiro);

-- Seed: marca os títulos 015 como manuais (gerido pela tela) e cria variedade de ESTADO para o
-- smoke exercitar TODAS as travas (quitado/agrupado/de-NF/contabilizado/origem-auto/conciliado).
UPDATE areceber SET gerado = 'OPERADOR', cadastrado_manualmente = 'S', tipodoc = 'DUPLICATA'
  WHERE codrcb IN (1, 100, 101, 200, 202);
UPDATE areceber SET quitada = 'S'                                    WHERE codrcb = 999; -- baixado
UPDATE areceber SET agrupado = 'S'                                   WHERE codrcb = 400; -- agrupado
UPDATE areceber SET idnf = 9999, gerado = 'SISTEMA'                  WHERE codrcb = 300; -- gerado por NF
UPDATE areceber SET contabilizado = 'S', cadastrado_manualmente = 'S', tipodoc = 'DUPLICATA'
  WHERE codrcb = 201;                                                                    -- contabilizado
UPDATE areceber SET origem = 'Q', gerado = 'SISTEMA'                 WHERE codrcb = 102; -- origem automática
UPDATE areceber SET consiliado = 'S', cadastrado_manualmente = 'N', gerado = 'SISTEMA'
  WHERE codrcb = 500;                                                                    -- conciliado (não-manual)

-- View get_areceber — MANTÉM as 19 colunas de 015 (mesma ordem/tipo, exigência do CREATE OR REPLACE)
-- e ACRESCENTA no fim as colunas de gestão/estado que o grid do cadastro usa.
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
  GREATEST(0, (CURRENT_DATE - r.dtvenc::date))                                   AS dias_atrazo,
  COALESCE(p.tolerancia, 0)                                                      AS dias_tolerancia,
  CAST(
    CASE WHEN (CURRENT_DATE - r.dtvenc::date) < COALESCE(p.tolerancia, 0) THEN 0
         ELSE COALESCE((r.txjuros / 30.0)
                       * GREATEST(0, (CURRENT_DATE - r.dtvenc::date))
                       * r.valor / 100, 0)
    END AS numeric(13,2))                                                         AS juro,
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
  e.telefone,
  -- ── colunas de gestão/estado acrescentadas (043) ──
  r.idnf,
  r.nrodup,
  r.quitada,
  r.agrupado,
  r.contabilizado,
  r.tipodoc,
  r.origem,
  r.gerado,
  r.cadastrado_manualmente,
  r.dtpgto,
  r.codvendedor,
  r.codcobrador,
  r.idpgto,
  r.codbco,
  r.codplc,
  r.idsituacao_nf
FROM areceber r
LEFT JOIN parceiros p     ON (p.codparceiro = r.codparceiro)
LEFT JOIN parceiros_end e ON (e.codend = p.codend);

-- RBAC da tela (FRMCADARECEBER) — operador 7 / empresa 1 (o smoke).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADARECEBER', 'BTNGRAVAR',           7, 1),
  ('FRMCADARECEBER', 'BTNEXCLUIR',          7, 1),
  ('FRMCADARECEBER', 'BTNADICIONARREGISTRO',7, 1),
  ('FRMCADARECEBER', 'BTNEDITAR',           7, 1),
  -- grant também na empresa 2 (só p/ o smoke provar a trava de tenant do SERVIÇO, não só o RBAC):
  ('FRMCADARECEBER', 'BTNGRAVAR',           7, 2);
