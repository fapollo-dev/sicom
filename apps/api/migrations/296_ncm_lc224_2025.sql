-- 296 — A TABELA DA LC 224/2025 (`NCM_LC224_2025`): PIS/COFINS reduzidos por prefixo de NCM, vigência 01/04/2026.
-- 59 linhas, cadastradas no legado em 09/06/2026. Achada no inventário completo de tabelas fora do plano.
-- Contagens no Oracle de produção (só leitura), 23/09/2026.
--
-- ── O que é ──────────────────────────────────────────────────────────────────────────────────────────
-- Cada linha é um NCM (ou prefixo, ou capítulo) de produto que tinha PIS/COFINS a alíquota ZERO e que, pela
-- LC 224/2025, passa a pagar **10% da alíquota padrão** (a própria tabela diz, na coluna `IMPACTO`:
-- "Aliquota 10% da padrao"): PIS 0,165% / COFINS 0,76% no lucro real e 0,065% / 0,3% no presumido, com o CST
-- mantido (06 na saída, 73 na entrada) e a base legal de cada item (ex.: Lei 10.925/2004, art. 1º, X).
--
--   `TIPO_MATCH`: P = prefixo · E = NCM exato (ou com "Ex") · C = capítulo inteiro
--   `ATIVO`: 53 em S; os 6 em N são capítulos inteiros (25-29, "Quimicos"/"Outros"), largos demais
--
-- ── ⚠️ O LEGADO TEM A TABELA, MAS NÃO A APLICA ────────────────────────────────────────────────────────
-- Medido: o catálogo `PISCOFINS` não tem NENHUMA alíquota 0,165/0,76 nem 0,065/0,3, e não mudou em 2026; e as
-- **28.428 vendas com CST 06** da primeira semana de abril/2026 saíram com alíquota de PIS NULA. A tabela foi
-- cadastrada (jun/2026) e nenhum cálculo a lê. Por fidelidade, o Apollo a carrega como REFERÊNCIA e também não
-- calcula nada com ela — aplicar a redução é decisão fiscal do cliente, não conversão.
--
-- Os valores de alíquota estão em FRAÇÃO (0,00165 = 0,165%), como o legado gravou.

CREATE TABLE IF NOT EXISTS ncm_lc224_2025 (
  id                  integer PRIMARY KEY,
  segmento            varchar(50),
  ncm_padrao          varchar(60) NOT NULL,
  -- P = prefixo · E = NCM exato · C = capítulo
  tipo_match          char(1) NOT NULL,
  prefixo_match       varchar(10) NOT NULL,
  descricao           varchar(2000),
  excecoes            varchar(2000),
  -- ⚠️ em FRAÇÃO, como o legado grava: 0.00165 = 0,165%
  aliq_pis_pres       numeric(10,7),
  aliq_cofins_pres    numeric(10,7),
  aliq_pis_real       numeric(10,7),
  aliq_cofins_real    numeric(10,7),
  cst_pis_sai         varchar(2),
  cst_cofins_sai      varchar(2),
  cst_pis_ent         varchar(2),
  cst_cofins_ent      varchar(2),
  tributo             varchar(60),
  base_legal          varchar(500),
  item_lc224          varchar(300),
  impacto             varchar(500),
  obs                 varchar(2000),
  dt_vigencia_inicio  date NOT NULL,
  dt_vigencia_fim     date,
  ativo               char(1) NOT NULL DEFAULT 'S',
  dtcadastro          timestamptz DEFAULT now(),
  usultalteracao      integer,
  dtultimalteracao    timestamptz
);
CREATE INDEX IF NOT EXISTS ix_ncm_lc224_prefixo ON ncm_lc224_2025 (prefixo_match) WHERE ativo = 'S';
