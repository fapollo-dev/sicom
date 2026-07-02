-- 047 — DRE CONTÁBIL (relatório), corte-1: estrutura semeada + mapeamento conta→linha. Espelha
-- CONFIG_DRE_CONTABIL (árvore de linhas: P=Σ contas vinculadas / F=Σ filhas / E=expressão) e
-- VINCULO_PLC_CFG_DRE (conta→linha). O CÁLCULO (Σ crédito−débito do DIÁRIO por período/empresa,
-- roll-up e fórmula) vive no dre.service. Config é GLOBAL (sem empresa); só a agregação filtra
-- por codempresa. O editor da estrutura é corte-2 (aqui a estrutura é semeada, fiel ao modelo).

CREATE SEQUENCE IF NOT EXISTS seq_dre_estrutura;
CREATE TABLE IF NOT EXISTS dre_estrutura (
  codestrutura  integer PRIMARY KEY DEFAULT nextval('seq_dre_estrutura'),
  codexpandido  varchar(30) NOT NULL,          -- máscara hierárquica (ex.: '01', '01.001')
  descricao     varchar(150) NOT NULL,
  tipo_calculo  char(1) NOT NULL,              -- P=contas vinculadas / F=soma das filhas / E=expressão
  classe        char(1) NOT NULL,              -- A=analítica (recebe vínculo) / S=sintética (agrega)
  expressao     varchar(200),                  -- p/ tipo 'E' (ex.: '<01>+<03>')
  nivel         integer,
  codpai        integer REFERENCES dre_estrutura(codestrutura),
  ativo         char(1) DEFAULT 'S',
  usultalteracao integer, dtultimalteracao timestamptz, dtcadastro timestamptz
);
ALTER SEQUENCE seq_dre_estrutura OWNED BY dre_estrutura.codestrutura;
CREATE UNIQUE INDEX IF NOT EXISTS ux_dre_estrutura_codexp ON dre_estrutura (codexpandido);
CREATE INDEX IF NOT EXISTS ix_dre_estrutura_codpai ON dre_estrutura (codpai);

-- mapeamento conta contábil → linha do DRE (1 conta → 1 linha analítica 'P').
CREATE TABLE IF NOT EXISTS dre_conta (
  codplanocontas integer NOT NULL,             -- → plano_contas.codplanocontas
  codestrutura   integer NOT NULL REFERENCES dre_estrutura(codestrutura) ON DELETE CASCADE,
  PRIMARY KEY (codplanocontas, codestrutura)
);
CREATE INDEX IF NOT EXISTS ix_dre_conta_estrutura ON dre_conta (codestrutura);

-- Seed FIEL de uma estrutura mínima (raízes nível-1 + analíticas mapeadas às contas de Resultado
-- já semeadas em 046). Exercita os 3 tipos de linha (P/F/E).
INSERT INTO dre_estrutura (codestrutura, codexpandido, descricao, tipo_calculo, classe, expressao, nivel, codpai) VALUES
  (1, '01',         'RECEITA LÍQUIDA',        'F', 'S', NULL,             1, NULL),
  (2, '01.001',     'RECEITA BRUTA',          'P', 'A', NULL,             2, 1),
  (3, '01.002',     '(-) DEDUÇÕES',           'P', 'A', NULL,             2, 1),
  (4, '03',         'CUSTO DAS VENDAS',       'F', 'S', NULL,             1, NULL),
  (5, '03.001',     'CUSTO MERC. VENDIDA',    'P', 'A', NULL,             2, 4),
  -- ramo de 3 NÍVEIS (F-filha-de-F) — exercita o roll-up recursivo:
  (7, '04',         'DESPESAS OPERACIONAIS',  'F', 'S', NULL,             1, NULL),
  (8, '04.001',     'DESPESAS ADMINISTRATIVAS','F', 'S', NULL,            2, 7),
  (9, '04.001.001', 'ALUGUÉIS',               'P', 'A', NULL,             3, 8),
  -- fórmula de 3 termos (fiel ao golden: <01>+<03>+<04>):
  (6, '08',         'LUCRO BRUTO',            'E', 'S', '<01>+<03>+<04>', 1, NULL)
ON CONFLICT (codestrutura) DO NOTHING;
SELECT setval('seq_dre_estrutura', (SELECT COALESCE(MAX(codestrutura),1) FROM dre_estrutura));

-- Vínculos: VENDAS(124)→Receita Bruta · IMPOSTOS S/VENDAS(127)→Deduções · CMV(134)→Custo ·
-- ICMS A RECOLHER(232)→Aluguéis (só p/ dar movimento ao ramo de 3 níveis no smoke).
INSERT INTO dre_conta (codplanocontas, codestrutura) VALUES
  (124, 2), (211, 2), (127, 3), (134, 5), (232, 9)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW get_dre_estrutura AS
SELECT codestrutura, codexpandido, descricao, tipo_calculo, classe, expressao, nivel, codpai, ativo
FROM dre_estrutura;

-- RBAC do relatório (permissão de visualização).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMDRE', 'BTNVISUALIZAR', 7, 1);
