-- 046 — PLANO DE CONTAS (contábil), corte-1: transforma o subset flat de 035 (só destino do DIÁRIO)
-- num cadastro em ÁRVORE gerenciável. Acrescenta a máscara/chave-de-negócio (CODIEXPANDIDO),
-- CLASSE (T/A — o discriminador REAL; o `tipo` do 035 estava rotulado errado), NATUREZA (grupo do
-- balanço/DRE), NIVEL, self-FK de CODPAI, auditoria e sequence do PK. Semeia o ESQUELETO de sintéticas
-- (3 raízes + níveis 2-4) do golden PINHEIRAO e faz o backfill das analíticas seedadas pela NF.
-- Global por schema (sem coluna de empresa). Máscara configurável + auto-código + plano referencial = corte-2.

-- ── colunas do cadastro ──
ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS codiexpandido    varchar(30);   -- máscara pontilhada (chave de negócio)
ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS codireduzido     varchar(15);   -- código reduzido
ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS natureza         integer;       -- 1 Ativo/2 Passivo/3 PL/4 Resultado/5 Comp/9 Outras
ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS nivel            integer;       -- profundidade na árvore
ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS integrado        char(1) DEFAULT 'N';
ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS usultalteracao   integer;
ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz;
ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS dtcadastro       timestamptz;

-- `classe` era varchar(20) e nunca populado; padroniza p/ char(1) T/A (Sintética/Analítica).
ALTER TABLE plano_contas ALTER COLUMN classe TYPE char(1) USING NULLIF(left(classe,1),'');

-- PK ganha sequence (as contas novas do cadastro são numeradas; o legado usa sequence surrogate).
CREATE SEQUENCE IF NOT EXISTS seq_plano_contas;
ALTER TABLE plano_contas ALTER COLUMN codplanocontas SET DEFAULT nextval('seq_plano_contas');

-- ESQUELETO de sintéticas (CLASSE='T') do golden PINHEIRAO — ids 9001..9021 (fora da faixa do seed).
INSERT INTO plano_contas (codplanocontas, codiexpandido, descricao, classe, natureza, nivel, codpai, tipo, status) VALUES
  (9001, '1',           'ATIVO',                    'T', 1, 1, NULL, 'E', 'A'),
  (9002, '1.1',         'ATIVO CIRCULANTE',         'T', 1, 2, 9001, 'E', 'A'),
  (9003, '1.1.01',      'DISPONIVEL',               'T', 1, 3, 9002, 'E', 'A'),
  (9004, '1.1.01.08',   'VALORES EM TRANSITO',      'T', 1, 4, 9003, 'E', 'A'),
  (9005, '1.1.02',      'CREDITOS',                 'T', 1, 3, 9002, 'E', 'A'),
  (9006, '1.1.02.09',   'IMPOSTOS A RECUPERAR',     'T', 1, 4, 9005, 'E', 'A'),
  (9007, '1.1.03',      'ESTOQUES',                 'T', 1, 3, 9002, 'E', 'A'),
  (9008, '1.1.03.01',   'MERCADORIAS',              'T', 1, 4, 9007, 'E', 'A'),
  (9009, '2',           'PASSIVO',                  'T', 2, 1, NULL, 'E', 'A'),
  (9010, '2.1',         'PASSIVO CIRCULANTE',       'T', 2, 2, 9009, 'E', 'A'),
  (9011, '2.1.01',      'FORNECEDORES',             'T', 2, 3, 9010, 'E', 'A'),
  (9012, '2.1.01.01',   'FORNECEDORES NACIONAIS',   'T', 2, 4, 9011, 'E', 'A'),
  (9013, '3',           'CONTAS DE RESULTADO',      'T', 4, 1, NULL, 'E', 'A'),
  (9014, '3.1',         'RECEITAS',                 'T', 4, 2, 9013, 'E', 'A'),
  (9015, '3.1.01',      'RECEITA DE VENDAS',        'T', 4, 3, 9014, 'E', 'A'),
  (9016, '3.1.01.01',   'VENDAS DE MERCADORIAS',    'T', 4, 4, 9015, 'E', 'A'),
  (9017, '3.1.02',      'DEDUCOES DA RECEITA',      'T', 4, 3, 9014, 'E', 'A'),
  (9018, '3.1.02.01',   'IMPOSTOS SOBRE VENDAS',    'T', 4, 4, 9017, 'E', 'A'),
  (9019, '3.2',         'CUSTOS',                   'T', 4, 2, 9013, 'E', 'A'),
  (9020, '3.2.01',      'CUSTO DAS VENDAS',         'T', 4, 3, 9019, 'E', 'A'),
  (9021, '3.2.01.01',   'CUSTO DA MERCADORIA VENDIDA','T', 4, 4, 9020, 'E', 'A')
ON CONFLICT (codplanocontas) DO NOTHING;

-- Backfill das ANALÍTICAS (CLASSE='A', nível 5) seedadas pela NF — máscara/natureza/pai do golden.
UPDATE plano_contas SET classe='A', tipo='E', nivel=5, codireduzido=codplanocontas::text,
  codiexpandido = CASE codplanocontas
    WHEN 148 THEN '1.1.03.01.0002' WHEN 147 THEN '1.1.03.01.0001'
    WHEN 154 THEN '1.1.03.01.0027' WHEN 153 THEN '1.1.03.01.0052'
    WHEN 200 THEN '1.1.01.08.0005'
    WHEN 232 THEN '1.1.02.09.0001' WHEN 235 THEN '1.1.02.09.0010' WHEN 236 THEN '1.1.02.09.0011'
    WHEN 11141 THEN '2.1.01.01.14822'
    WHEN 124 THEN '3.1.01.01.0003' WHEN 211 THEN '3.1.01.01.0004'
    WHEN 127 THEN '3.1.02.01.0001' WHEN 134 THEN '3.2.01.01.0001'
  END,
  natureza = CASE WHEN codplanocontas IN (148,147,154,153,200,232,235,236) THEN 1
                  WHEN codplanocontas IN (11141) THEN 2 ELSE 4 END,
  codpai = CASE
    WHEN codplanocontas IN (148,147,154,153) THEN 9008
    WHEN codplanocontas = 200 THEN 9004
    WHEN codplanocontas IN (232,235,236) THEN 9006
    WHEN codplanocontas = 11141 THEN 9012
    WHEN codplanocontas IN (124,211) THEN 9016
    WHEN codplanocontas = 127 THEN 9018
    WHEN codplanocontas = 134 THEN 9021 END
  WHERE codplanocontas IN (148,147,154,153,200,232,235,236,11141,124,211,127,134);

-- qualquer conta remanescente sem classe (ex.: parceiro-conta) → analítica ativa, código = a PK.
UPDATE plano_contas SET classe='A' WHERE classe IS NULL;
UPDATE plano_contas SET codireduzido = codplanocontas::text WHERE codireduzido IS NULL;
UPDATE plano_contas SET codiexpandido = codplanocontas::text WHERE codiexpandido IS NULL;

-- avança a sequence além dos ids usados (surrogate real do Oracle ~12261).
SELECT setval('seq_plano_contas', GREATEST((SELECT MAX(codplanocontas) FROM plano_contas), 12261));

-- self-FK da árvore (agora que todos os codpai apontam p/ contas existentes) + únicos.
CREATE UNIQUE INDEX IF NOT EXISTS ux_plano_contas_codiexpandido ON plano_contas (codiexpandido) WHERE codiexpandido IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_plano_contas_codpai ON plano_contas (codpai);
DO $$ BEGIN
  ALTER TABLE plano_contas ADD CONSTRAINT fk_plano_contas_pai
    FOREIGN KEY (codpai) REFERENCES plano_contas(codplanocontas);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- View de listagem (o grid/árvore lê daqui) — descricao_completa = código + descrição (legado).
CREATE OR REPLACE VIEW get_plano_contas AS
SELECT
  c.codplanocontas,
  c.codiexpandido,
  c.codireduzido,
  c.descricao,
  (COALESCE(c.codiexpandido, c.codplanocontas::text) || ' - ' || c.descricao) AS descricao_completa,
  c.classe,
  c.natureza,
  c.nivel,
  c.codpai,
  c.tipo,
  c.status
FROM plano_contas c;

-- RBAC da tela.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADPLANOCONTAS', 'BTNGRAVAR',            7, 1),
  ('FRMCADPLANOCONTAS', 'BTNEXCLUIR',           7, 1),
  ('FRMCADPLANOCONTAS', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADPLANOCONTAS', 'BTNEDITAR',            7, 1);
