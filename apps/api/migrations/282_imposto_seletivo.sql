-- 282 — REFORMA corte-4: o IMPOSTO SELETIVO (IS).
-- Cortes 1-3 nas migrations 278-281. Dossiê: `uCadIBSCBS.md` §14.
-- DESENVOLVIDO (novo): o legado **não tem IS em lugar nenhum** — nem coluna em `NF_PROD_IBSCBS` ou
-- `NF_IBSCBS`, nem tabela de alíquota (conferido no dicionário do Oracle; `CSTIS`/`CCLASSTRIBIS` existem só
-- na staging `INTEGRACAO_IBSCBS`, com 0 linhas). Contagens de produção (só leitura), 22/09/2026.
--
-- ── ⚠️ O IS INTEGRA A BASE DO IBS E DA CBS — ao contrário de ICMS, PIS e COFINS ───────────────────────
-- Esta é a regra que inverte a intuição construída no corte-2. Lá (mig 279) a lição foi "o imposto não
-- entra na base do imposto": ICMS, ISS, PIS e COFINS **saem** da base do IBS/CBS (LC 214/2025, art. 12,
-- § 2º). O Imposto Seletivo é a EXCEÇÃO: o art. 12, § 1º, o inclui expressamente na base do IBS e da CBS.
-- A ordem de cálculo, portanto, é:
--       1) apurar o IS sobre o valor da operação;
--       2) somar o IS à base;
--       3) só então aplicar IBS e CBS.
-- Inverter isso subtributa o IBS/CBS em toda linha que tiver IS. Por isso o cálculo do corte-2 passa a
-- receber o IS ANTES de fechar a base, e não depois.
--
-- ── O substrato no cliente ────────────────────────────────────────────────────────────────────────────
-- O IS incide sobre bens prejudiciais à saúde e ao meio ambiente. Num supermercado isso é bebida e fumo:
--   · **3.283 produtos ativos** com NCM dos capítulos 22 e 24
--   · **70.085 itens de nota** de bebidas (R$ 22.139.235,13) e **2.739** de fumo (R$ 521.209,78)
--   · **R$ 22,66 milhões** de movimento sujeito, portanto, à incidência
-- Por posição: 2202 refrigerante/chá 1.480 produtos · 2204 vinho 498 · 2203 cerveja 400 · 2208 destilado
-- 344 · 2402 cigarro 240 · 2206 outras fermentadas 86 · 2205 vermute 13 · 2403 fumo 3.
--
-- ── ⚠️ NEM TODO NCM DO CAPÍTULO 22 É SUJEITO, E ISSO IMPORTA ──────────────────────────────────────────
-- Água mineral (2201, 99 produtos no cliente) e álcool etílico (2207, 44) estão no mesmo capítulo e **não
-- são** bens sujeitos ao IS. Semear "capítulo 22 inteiro" cobraria seletivo sobre água. Por isso a tabela
-- é por NCM (prefixo), não por capítulo, e o seed lista só as posições que a LC alcança.
--
-- ── A alíquota ainda não existe em lei, e o seed diz isso ─────────────────────────────────────────────
-- A LC 214/2025 define a INCIDÊNCIA; as alíquotas do IS virão por lei ordinária específica. O seed entra
-- com **alíquota zero e a fonte escrita**, exatamente como a mig 007 fez com `tributacao_reforma`: o
-- cadastro fica pronto e rastreável, e quem publicar a alíquota preenche uma linha em vez de mexer em
-- código. Enquanto for zero, o IS não altera nenhum cálculo — mas a estrutura já está no lugar certo,
-- que é dentro da base do IBS/CBS.
--
-- ── Ad valorem e específico ───────────────────────────────────────────────────────────────────────────
-- A LC prevê as duas formas: percentual sobre o valor e valor fixo por unidade de medida (o caso típico do
-- cigarro e da bebida alcoólica). As duas colunas existem e o cálculo soma as duas parcelas — uma
-- implementação só com percentual não representaria o cigarro.

CREATE SEQUENCE IF NOT EXISTS seq_imposto_seletivo_ncm;
CREATE TABLE IF NOT EXISTS imposto_seletivo_ncm (
  codis_ncm        integer PRIMARY KEY DEFAULT nextval('seq_imposto_seletivo_ncm'),
  ncm              varchar(8) NOT NULL,          -- prefixo: 4 dígitos (posição) ou 8 (item)
  descricao        varchar(200) NOT NULL,
  vigencia_inicio  date NOT NULL,
  aliquota         numeric(7,4) NOT NULL DEFAULT 0,   -- ad valorem, % sobre o valor da operação
  valor_por_unidade numeric(15,4) NOT NULL DEFAULT 0, -- específico, R$ por unidade de medida
  unidade          varchar(6),                        -- a unidade do específico (UN, LT, MC…)
  fonte            varchar(200) NOT NULL,
  dtcadastro       timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_imposto_seletivo_ncm OWNED BY imposto_seletivo_ncm.codis_ncm;
CREATE UNIQUE INDEX IF NOT EXISTS ux_imposto_seletivo_ncm ON imposto_seletivo_ncm (ncm, vigencia_inicio);
CREATE INDEX IF NOT EXISTS ix_imposto_seletivo_ncm_pref ON imposto_seletivo_ncm (ncm);

-- as posições que a LC 214/2025 alcança, com alíquota a definir em lei ordinária.
-- ⚠️ 2201 (água mineral) e 2207 (álcool etílico) ficam DE FORA de propósito: mesmo capítulo, não sujeitos.
INSERT INTO imposto_seletivo_ncm (ncm, descricao, vigencia_inicio, aliquota, valor_por_unidade, unidade, fonte) VALUES
  ('2202', 'Bebidas não alcoólicas açucaradas (refrigerantes e similares)', '2027-01-01', 0, 0, NULL, 'LC 214/2025 art. 409 — alíquota a definir em lei ordinária'),
  ('2203', 'Cervejas de malte',                                            '2027-01-01', 0, 0, NULL, 'LC 214/2025 art. 409 — alíquota a definir em lei ordinária'),
  ('2204', 'Vinhos de uvas frescas',                                       '2027-01-01', 0, 0, NULL, 'LC 214/2025 art. 409 — alíquota a definir em lei ordinária'),
  ('2205', 'Vermutes e outros vinhos aromatizados',                        '2027-01-01', 0, 0, NULL, 'LC 214/2025 art. 409 — alíquota a definir em lei ordinária'),
  ('2206', 'Outras bebidas fermentadas',                                   '2027-01-01', 0, 0, NULL, 'LC 214/2025 art. 409 — alíquota a definir em lei ordinária'),
  ('2208', 'Bebidas espirituosas e destilados',                            '2027-01-01', 0, 0, NULL, 'LC 214/2025 art. 409 — alíquota a definir em lei ordinária'),
  ('2402', 'Charutos, cigarrilhas e cigarros de tabaco',                    '2027-01-01', 0, 0, NULL, 'LC 214/2025 art. 409 — alíquota a definir em lei ordinária'),
  ('2403', 'Outros produtos de tabaco e sucedâneos',                        '2027-01-01', 0, 0, NULL, 'LC 214/2025 art. 409 — alíquota a definir em lei ordinária')
ON CONFLICT (ncm, vigencia_inicio) DO NOTHING;

-- o IS no item: valor apurado e a alíquota que o produziu
ALTER TABLE nf_prod_ibscbs ADD COLUMN IF NOT EXISTS vis        numeric(13,2) NOT NULL DEFAULT 0;
ALTER TABLE nf_prod_ibscbs ADD COLUMN IF NOT EXISTS pis_seletivo numeric(7,4) NOT NULL DEFAULT 0;
COMMENT ON COLUMN nf_prod_ibscbs.vis IS
  'Imposto Seletivo do item. INTEGRA a base do IBS/CBS (LC 214/2025 art. 12 §1º) — ao contrário de ICMS, PIS e COFINS, que a base exclui.';

-- e no cabeçalho
ALTER TABLE nf_ibscbs ADD COLUMN IF NOT EXISTS vis numeric(15,2) NOT NULL DEFAULT 0;

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADCLASSTRIBIBSCBS', 'BTNSELETIVO', 7, 1)
ON CONFLICT DO NOTHING;
