-- 279 — REFORMA TRIBUTÁRIA (IBS/CBS) corte-2: os GRUPOS NA NOTA.
-- Corte-1 na mig 278 (os cadastros). Dossiê: `uCadIBSCBS.md` §8. Telas 110/145 da FILA-CONVERSAO.
-- Todo número abaixo é contagem no Oracle de produção (só leitura), 21/09/2026.
--
-- ── ⚠️ A ALÍQUOTA EFETIVA É A QUE CONTA, E A COLUNA DELA NÃO É CONFIÁVEL ───────────────────────────────
-- Este é o defeito caro do corte-2, e tem duas camadas.
--
-- (a) Quem multiplicar a base pela alíquota CHEIA cobra imposto a mais. Nos **31.633 itens com redução**:
--        IBS  real R$    469,70  ·  pela cheia R$  10.872,08   (23×)
--        CBS  real R$  4.233,04  ·  pela cheia R$  97.781,80   (23×)
--        ────────────────────────────────────────────────────
--        cobrados a mais: **R$ 103.951,14**
--     A redução vem de `CLASS_TRIB.PRED_IBS`/`PRED_CBS` (mig 278) e chega ao item em `PREDALIQ_IBSUF` /
--     `PREDALIQ_CBS`: 21.848 itens têm redução de 100% (alíquota ZERO) e 9.833 têm 60%.
--
-- (b) E a saída óbvia — ler a coluna de alíquota efetiva que o legado já grava — **não funciona para a
--     CBS**. `PALIQEFET_CBS` fica em **0 em 46.677 itens cuja redução é 0** (deveria ser 0,9), enquanto
--     41.255 deles têm o VALOR da CBS calculado certo. A coluna é lixo em metade dos casos; o valor não é.
--     Medido nas 97.005 linhas com base:
--        conta                                              | acerta
--        ---------------------------------------------------|---------
--        IBS  derivando  vbc × pibsuf × (1 − predaliq/100)   | **96.966** (99,96%)
--        IBS  lendo      paliqefet_ibsuf                     |   95.038
--        CBS  derivando  vbc × pcbs  × (1 − predaliq/100)    | **89.277**
--        CBS  lendo      paliqefet_cbs                       |   56.129  (57,9%)
--     Por isso o nosso serviço **deriva** e guarda a efetiva como resultado, em vez de confiar na coluna.
--
-- ── ⚠️ O QUE O FORNECEDOR MANDOU NÃO É O QUE FICA: R$ 4,9 MILHÕES DE BASE RECLASSIFICADA ──────────────
-- As colunas `_ORI` guardam o que veio no XML do fornecedor; as sem sufixo, o que ficou depois da
-- conferência de entrada. Divergem, e muito — em **36.278 itens** a base mudou:
--      base do fornecedor  R$ 4.040.470,56  →  base efetiva  R$ 8.936.794,30   (**+R$ 4.896.323,74**)
-- E a CST é reclassificada em 9.530 itens: **7.753 vieram como 000** (tributação integral) e ficaram
-- **200** (alíquota reduzida) — o fornecedor não aplicou a redução e a conferência aplicou; 1.375 no
-- sentido inverso, mais 377 de 410 → 000. É a mesma semântica dos pares `*_nota` do `nf_prod`, e é por
-- isso que as duas colunas existem: sem o par, não há o que conferir.
--
-- ── A aritmética do cabeçalho ─────────────────────────────────────────────────────────────────────────
-- `VIBS = VIBSUF + VIBSMUN` em **10.012 de 10.012** notas (100%) — a regra é exata, não aproximada.
-- O cabeçalho é a soma dos itens em ~95% (9.642 de 10.012 no IBS-UF; 9.115 na base).
--
-- ── Folds declarados (colunas que vêm com destino e SEM regra, porque o cliente não as usa) ───────────
-- No item: `PREDALIQ` e `PALIQEFET` **sem sufixo** estão vazias nas 98.760 linhas — são as genéricas, e o
-- cliente só usa as por tributo (`_IBSUF`, `_IBSMUN`, `_CBS`). No cabeçalho: `VDIF` (diferimento),
-- `VDEVTRIB` (devolução de tributo), `VIBSMUN`, `VCREDPRES` e `VCREDPRESCONDSUS` estão **zeradas nas
-- 10.012 notas** — o município ainda não cobra IBS na fase-teste e o cliente não tem crédito presumido.
-- Vêm com destino porque o leiaute da NF-e as exige e a carga precisa de onde pôr.
--
-- ⚠️ `CODCCLASS_TRIB_NCM_ANEXOS` é **0 em 92.726 dos 98.760 itens** (93,9%) — o legado usa ZERO como
-- "sem vínculo", não NULL. Os 6.034 positivos casam todos com `CCLASS_TRIB_NCM_ANEXOS`. Uma FK direta
-- rejeitaria 92.726 linhas na carga: aqui a coluna é nullable e o zero vira NULL na entrada.
--
-- ⚠️ A EMPRESA VEM DA NOTA (o padrão do Achado 4): nem `NF_IBSCBS` nem `NF_PROD_IBSCBS` guardam loja, e
-- **3.623 das 10.012 notas são da empresa 2**. Sem derivar da NF, todas iriam para a loja 1.

-- os grupos por ITEM da nota
CREATE TABLE IF NOT EXISTS nf_prod_ibscbs (
  codnfprod   integer PRIMARY KEY REFERENCES nf_prod(codnfprod) ON DELETE CASCADE,
  codnf       integer NOT NULL,
  idempresa   integer NOT NULL,
  codproduto  integer NOT NULL,
  -- o que FICOU (depois da conferência de entrada)
  cst         varchar(3),
  cclasstrib  varchar(6),
  vbc         numeric(13,2),
  pibsuf      numeric(7,4),  predaliq_ibsuf  numeric(7,4),  paliqefet_ibsuf  numeric(7,4),  vibsuf  numeric(13,2),
  pibsmun     numeric(7,4),  predaliq_ibsmun numeric(7,4),  paliqefet_ibsmun numeric(7,4),  vibsmun numeric(13,2),
  pcbs        numeric(7,4),  predaliq_cbs    numeric(7,4),  paliqefet_cbs    numeric(7,4),  vcbs    numeric(13,2),
  -- o vínculo com o anexo da LC; 0 no legado = sem vínculo, aqui NULL
  codcclass_trib_ncm integer,
  -- o que o FORNECEDOR mandou no XML (o par de conferência; 36.278 itens divergem na base)
  cst_ori        varchar(3),
  cclasstrib_ori varchar(6),
  vbc_ori        numeric(13,2),
  dtcadastro  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_nf_prod_ibscbs_nf      ON nf_prod_ibscbs (idempresa, codnf);
CREATE INDEX IF NOT EXISTS ix_nf_prod_ibscbs_produto ON nf_prod_ibscbs (codproduto);
-- os itens em que a conferência mudou a classificação ou a base: é a consulta da tela
CREATE INDEX IF NOT EXISTS ix_nf_prod_ibscbs_diverge ON nf_prod_ibscbs (idempresa, codnf)
  WHERE cst_ori IS NOT NULL AND (cst_ori <> cst OR cclasstrib_ori <> cclasstrib OR vbc_ori <> vbc);

-- os totais por NOTA
CREATE TABLE IF NOT EXISTS nf_ibscbs (
  codnf             integer PRIMARY KEY REFERENCES nf(codnf) ON DELETE CASCADE,
  idempresa         integer NOT NULL,
  vbcibscbs         numeric(13,2) NOT NULL DEFAULT 0,
  vibsuf            numeric(13,2) NOT NULL DEFAULT 0,
  vibsmun           numeric(13,2) NOT NULL DEFAULT 0,  -- zerada nas 10.012 do cliente (fase-teste)
  vibs              numeric(13,2) NOT NULL DEFAULT 0,  -- = vibsuf + vibsmun, exato em 10.012/10.012
  vcbs              numeric(13,2) NOT NULL DEFAULT 0,
  vdif              numeric(13,2) NOT NULL DEFAULT 0,  -- diferimento — zerada no cliente
  vdevtrib          numeric(13,2) NOT NULL DEFAULT 0,  -- devolução de tributo — zerada
  vcredpres         numeric(13,2) NOT NULL DEFAULT 0,  -- crédito presumido — zerada
  vcredprescondsus  numeric(13,2) NOT NULL DEFAULT 0,  -- crédito presumido suspenso — zerada
  dtcadastro        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_nf_ibscbs_empresa ON nf_ibscbs (idempresa);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADCLASSTRIBIBSCBS', 'BTNCALCULAR', 7, 1)
ON CONFLICT DO NOTHING;
