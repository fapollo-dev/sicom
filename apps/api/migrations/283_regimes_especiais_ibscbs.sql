-- 283 — REFORMA corte-6: os REGIMES ESPECIAIS (as 48 classificações que faltavam).
-- Cortes 1-5 nas migrations 278-282. Dossiê: `uCadIBSCBS.md` §17.
--
-- ── ⚠️ PROCEDÊNCIA: aqui a fonte é a LEI, não o dado — e isso muda o peso da regra ────────────────────
-- Os cortes anteriores foram conferidos contra 89.494 itens de produção. **Estes 48 regimes não têm um
-- único produto nem um único item de nota no cliente** (medido: 0 e 0). São incorporação imobiliária,
-- locação de imóveis, transporte internacional, resseguro, cooperativas, serviços financeiros e regimes
-- de suspensão/diferimento — setores que um supermercado não opera.
-- Implementados a pedido explícito do usuário, com a LC 214/2025 como fonte e a aritmética de cada regime
-- provada no smoke. **Nenhum deles foi conferido contra dado real, porque não existe dado real** — quando
-- o primeiro caso aparecer, a regra deve ser reconferida contra ele antes de se confiar no número.
--
-- ── Os SEIS regimes, e por que cada um precisa de coisa diferente ─────────────────────────────────────
-- (1) REDUTOR DE BASE (CST 210 e 222 — 4 classificações). Reduz a **BASE**, não a alíquota. Uma redução
--     de 50% na base com alíquota cheia dá o mesmo que 50% na alíquota com base cheia — mas só quando as
--     duas reduções não se acumulam. Em 210 elas SE ACUMULAM (o nome da CST é "redução de alíquota COM
--     redutor de base"), e aí `base×(1−rb) × aliq×(1−ra)` é diferente de qualquer atalho. As três de 210
--     têm redução de alíquota de 50% e 70% ao mesmo tempo que o redutor.
-- (2) ALÍQUOTA PRÓPRIA (CST 010 uniforme setorial, 011 uniforme nacional — 7). Não usam a alíquota da UF:
--     têm a sua. Aplicar a da UF a um serviço financeiro daria o número errado sem nenhum aviso.
-- (3) ALÍQUOTA FIXA (CST 220, 221 — 4). Valor em REAIS por operação ou por unidade, não percentual. É o
--     regime de incorporação imobiliária e locação. Percentual nenhum representa isso.
-- (4) SUSPENSÃO E DIFERIMENTO (CST 510, 550 — 22). O imposto **não é pago agora**, mas existe: o valor
--     fica registrado como suspenso para controle, e o zero é consequência, não ausência. Guardar só zero
--     perderia a informação de quanto está suspenso — que é exatamente o que a fiscalização pergunta.
-- (5) CRÉDITO PRESUMIDO (9 classificações, indicadas por `IND_CRED_PRES`). Gera crédito **sem** imposto
--     pago na etapa anterior. Vai em coluna própria: somá-lo ao imposto do item misturaria débito com
--     crédito na mesma linha.
-- (6) NÃO TRIBUTADO (CST 400 isenção, 410 imunidade, 800 transferência de crédito, 820 regime específico,
--     830 exclusão de base). Zero — já tratado desde o corte-2.
--
-- ── Onde os parâmetros moram ─────────────────────────────────────────────────────────────────────────
-- `CLASS_TRIB` do legado traz `PRED_IBS`/`PRED_CBS` (redução de alíquota) e os indicadores, mas **não tem
-- onde guardar** alíquota própria, valor fixo, percentual de redutor de base nem percentual de crédito
-- presumido — porque o legado não calcula nada disso. A tabela abaixo é o complemento, com vigência e
-- fonte, no mesmo padrão de `tributacao_reforma` (mig 007) e `imposto_seletivo_ncm` (mig 282).

CREATE SEQUENCE IF NOT EXISTS seq_class_trib_param;
CREATE TABLE IF NOT EXISTS class_trib_parametro (
  codparam          integer PRIMARY KEY DEFAULT nextval('seq_class_trib_param'),
  class_trib        varchar(6) NOT NULL,
  vigencia_inicio   date NOT NULL,
  -- (2) alíquota PRÓPRIA (uniforme setorial/nacional): quando preenchida, substitui a da UF
  aliquota_ibs      numeric(7,4),
  aliquota_cbs      numeric(7,4),
  -- (3) alíquota FIXA: valor em reais, por operação (unidade nula) ou por unidade de medida
  valor_fixo_ibs    numeric(15,4),
  valor_fixo_cbs    numeric(15,4),
  unidade_fixa      varchar(6),
  -- (1) redutor de BASE: percentual que reduz a base antes de aplicar a alíquota
  pred_base         numeric(7,4),
  -- (5) crédito presumido: percentual sobre a base, em coluna própria
  pcred_pres_ibs    numeric(7,4),
  pcred_pres_cbs    numeric(7,4),
  fonte             varchar(200) NOT NULL,
  dtcadastro        timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_class_trib_param OWNED BY class_trib_parametro.codparam;
CREATE UNIQUE INDEX IF NOT EXISTS ux_class_trib_param ON class_trib_parametro (class_trib, vigencia_inicio);

-- o que cada regime produziu no item. Colunas SEPARADAS de propósito: suspenso não é pago, crédito
-- presumido não é débito, e base reduzida não é a base cheia — misturar qualquer um deles no valor do
-- imposto produz um número que a fiscalização não reconhece.
ALTER TABLE nf_prod_ibscbs ADD COLUMN IF NOT EXISTS base_reduzida    numeric(13,2);
ALTER TABLE nf_prod_ibscbs ADD COLUMN IF NOT EXISTS pred_base        numeric(7,4) NOT NULL DEFAULT 0;
ALTER TABLE nf_prod_ibscbs ADD COLUMN IF NOT EXISTS vibs_suspenso    numeric(13,2) NOT NULL DEFAULT 0;
ALTER TABLE nf_prod_ibscbs ADD COLUMN IF NOT EXISTS vcbs_suspenso    numeric(13,2) NOT NULL DEFAULT 0;
ALTER TABLE nf_prod_ibscbs ADD COLUMN IF NOT EXISTS vcred_pres_ibs   numeric(13,2) NOT NULL DEFAULT 0;
ALTER TABLE nf_prod_ibscbs ADD COLUMN IF NOT EXISTS vcred_pres_cbs   numeric(13,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN nf_prod_ibscbs.vibs_suspenso IS
  'IBS que seria devido e está suspenso/diferido (CST 510/550). NÃO é imposto a pagar — é controle.';
COMMENT ON COLUMN nf_prod_ibscbs.vcred_pres_ibs IS
  'crédito presumido de IBS: crédito SEM imposto pago na etapa anterior. Nunca somar ao imposto do item.';

-- e no cabeçalho, para que a nota mostre o total de cada coisa
ALTER TABLE nf_ibscbs ADD COLUMN IF NOT EXISTS vibs_suspenso  numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE nf_ibscbs ADD COLUMN IF NOT EXISTS vcbs_suspenso  numeric(15,2) NOT NULL DEFAULT 0;
-- `vcredpres` já existe desde a mig 279 (o leiaute do legado a previa e o cliente nunca a usou)

-- a apuração passa a distinguir o crédito presumido do crédito normal: os dois abatem, mas a origem é
-- diferente e a fiscalização pergunta separado
ALTER TABLE apuracao_ibscbs ADD COLUMN IF NOT EXISTS ibs_cred_presumido numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE apuracao_ibscbs ADD COLUMN IF NOT EXISTS cbs_cred_presumido numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE apuracao_ibscbs ADD COLUMN IF NOT EXISTS ibs_suspenso numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE apuracao_ibscbs ADD COLUMN IF NOT EXISTS cbs_suspenso numeric(15,2) NOT NULL DEFAULT 0;
