-- 281 — REFORMA IBS/CBS corte-3: a APURAÇÃO (débito × crédito).
-- Cortes 1 e 2 nas migrations 278/279/280. Dossiê: `uCadIBSCBS.md` §13.
-- DESENVOLVIDO (novo): o legado NÃO apura IBS/CBS — ele só grava os grupos na nota. Não há tela, não há
-- tabela de apuração e não há coluna de saldo em lugar nenhum do Oracle (conferido no dicionário). O que
-- há é o SUBSTRATO, e ele é grande. Contagens de produção (só leitura), 22/09/2026.
--
-- ── ⚠️ IBS E CBS SE APURAM SEPARADAMENTE — UM NÃO COMPENSA O OUTRO ───────────────────────────────────
-- Esta é a regra que uma apuração ingênua quebra, e é estrutural: a **CBS é federal** (substitui PIS e
-- COFINS) e o **IBS é dos Estados e Municípios** (substitui ICMS e ISS). São entes tributantes diferentes.
-- Somar os dois num "total de crédito" e abater de um "total de débito" produziria um número que não
-- corresponde a imposto nenhum — e no cliente o erro seria enorme, porque as duas colunas têm ordens de
-- grandeza diferentes: em 2026-01, IBS de crédito R$ 1.530,42 contra CBS de crédito R$ 13.745,12.
-- Por isso cada tributo tem aqui a sua coluna de débito, de crédito, de saldo anterior e de saldo a
-- transportar. Nada é somado entre eles em lugar nenhum.
--
-- ── O substrato, por mês de 2026 ─────────────────────────────────────────────────────────────────────
--   mês      entradas (crédito)                        saídas (débito)
--            notas   base          IBS       CBS       notas  base        IBS     CBS
--   2026-01    697   2.143.096,35  1.530,42  13.745,12    82  254.619,22  92,93  834,79
--   2026-03    801   1.900.976,49    781,03   7.026,77   119  212.402,42  69,58  626,45
--   2026-08    705   1.735.024,32    702,73   6.328,56    56  164.791,64  83,78  754,83
-- O crédito é ~10× o débito, e isso tem explicação: o supermercado COMPRA com NF-e (que já traz os grupos)
-- e VENDE no cupom. Ver o fold do débito de cupom abaixo.
--
-- ── ⚠️ FOLD DECLARADO: o débito de CUPOM não entra ───────────────────────────────────────────────────
-- A venda no PDV sai em NFC-e, e **nenhuma venda de cupom tem grupo IBS/CBS** no cliente: os 98.760 itens
-- de `NF_PROD_IBSCBS` são todos de NF (8.596 notas de entrada e 1.029 de saída). Enquanto for assim, a
-- apuração cobre o que existe — e o débito de saída fica estruturalmente baixo. PDV está **fora de escopo
-- por instrução**, então isto é limite declarado, não esquecimento: quando a NFC-e passar a carregar os
-- grupos, entra uma perna nova aqui, do mesmo jeito que a apuração de ICMS (mig 152) tem a perna do cupom
-- carregando 99,8% do detalhe dela.
--
-- ── Não cumulatividade: o que gera crédito e o que não gera ──────────────────────────────────────────
-- A LC 214/2025 dá crédito do que foi efetivamente onerado. Aqui o crédito sai do que está GRAVADO no
-- grupo do item, e o corte-2 já garante que imunidade, isenção e monofasia gravam ZERO com o motivo
-- (`tratamento`) ao lado — então elas não geram crédito por construção, sem precisar de regra nova. O que
-- a apuração faz é somar `vibsuf + vibsmun` e `vcbs` dos itens das notas do período, por direção.
--
-- ── Os filtros são os mesmos da apuração de ICMS (mig 152), porque a razão é a mesma ─────────────────
-- Data **CONTÁBIL** (não a de emissão), `PROC='S'`, `CANCELADA='N'` e denegada (`STATUSNFE='D'`) fora.
-- Nota cancelada ou denegada não gera nem débito nem crédito.
--
-- ── O saldo transita, e transita SEPARADO ────────────────────────────────────────────────────────────
-- Saldo credor de um período abate o débito do período seguinte — cada tributo no seu. A busca do saldo
-- anterior é pelo período FECHADO imediatamente anterior, e reprocessar um mês antigo NÃO recalcula os
-- seguintes (mesma escolha da apuração de ICMS, e pelo mesmo motivo: o fechado é documento).

CREATE SEQUENCE IF NOT EXISTS seq_apuracao_ibscbs;
CREATE TABLE IF NOT EXISTS apuracao_ibscbs (
  codapuracao_ibscbs integer PRIMARY KEY DEFAULT nextval('seq_apuracao_ibscbs'),
  idempresa       integer NOT NULL,
  competencia     char(6) NOT NULL,              -- AAAAMM
  data_inicio     date NOT NULL,
  data_fim        date NOT NULL,
  -- DÉBITO (saídas)
  base_debito     numeric(15,2) NOT NULL DEFAULT 0,
  ibs_debito      numeric(15,2) NOT NULL DEFAULT 0,
  cbs_debito      numeric(15,2) NOT NULL DEFAULT 0,
  notas_debito    integer NOT NULL DEFAULT 0,
  -- CRÉDITO (entradas)
  base_credito    numeric(15,2) NOT NULL DEFAULT 0,
  ibs_credito     numeric(15,2) NOT NULL DEFAULT 0,
  cbs_credito     numeric(15,2) NOT NULL DEFAULT 0,
  notas_credito   integer NOT NULL DEFAULT 0,
  -- SALDO ANTERIOR — separado por tributo, porque um não compensa o outro
  ibs_saldo_anterior numeric(15,2) NOT NULL DEFAULT 0,
  cbs_saldo_anterior numeric(15,2) NOT NULL DEFAULT 0,
  -- RESULTADO — idem: quatro colunas, nunca um total só
  ibs_a_recolher     numeric(15,2) NOT NULL DEFAULT 0,
  ibs_saldo_credor   numeric(15,2) NOT NULL DEFAULT 0,
  cbs_a_recolher     numeric(15,2) NOT NULL DEFAULT 0,
  cbs_saldo_credor   numeric(15,2) NOT NULL DEFAULT 0,
  fechada         char(1) NOT NULL DEFAULT 'N',
  codoperador     integer,
  dtcadastro      timestamptz DEFAULT now(),
  dtultimalteracao timestamptz
);
ALTER SEQUENCE seq_apuracao_ibscbs OWNED BY apuracao_ibscbs.codapuracao_ibscbs;
CREATE UNIQUE INDEX IF NOT EXISTS ux_apuracao_ibscbs_comp
  ON apuracao_ibscbs (idempresa, competencia);

-- o detalhe por NOTA: é o que permite conferir a apuração contra o documento
CREATE TABLE IF NOT EXISTS apuracao_ibscbs_nf (
  codapuracao_ibscbs integer NOT NULL REFERENCES apuracao_ibscbs(codapuracao_ibscbs) ON DELETE CASCADE,
  codnf           integer NOT NULL,
  direcao         char(1) NOT NULL,              -- E = crédito, S = débito
  base            numeric(15,2) NOT NULL DEFAULT 0,
  ibs             numeric(15,2) NOT NULL DEFAULT 0,
  cbs             numeric(15,2) NOT NULL DEFAULT 0,
  itens           integer NOT NULL DEFAULT 0,
  PRIMARY KEY (codapuracao_ibscbs, codnf)
);
CREATE INDEX IF NOT EXISTS ix_apuracao_ibscbs_nf_nota ON apuracao_ibscbs_nf (codnf);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMAPURACAOIBSCBS', 'FRMAPURACAOIBSCBS', 7, 1),
  ('FRMAPURACAOIBSCBS', 'BTNPROCESSAR',      7, 1),
  ('FRMAPURACAOIBSCBS', 'BTNFECHAR',         7, 1)
ON CONFLICT DO NOTHING;
