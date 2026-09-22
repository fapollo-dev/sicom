-- 287 — NF_PROD: a escada de custo e a ST externa que a carga deixava para trás (R$ 137 milhões).
-- Segundo achado do sentido origem → destino do `conferir-colunas-orfas.py`, depois da mig 286 (cabeçalho).
-- Contagens no Oracle de produção (só leitura), 22/09/2026.
--
-- ── O mesmo padrão do cabeçalho, agora no ITEM ───────────────────────────────────────────────────────
-- A mig 286 achou que a `nf` perdia os totais de ST, FCP, repasse e o par de conferência. O item repete o
-- padrão, e com valores maiores — porque é aqui que mora a **escada de custo** que a precificação usa.
--
--   coluna                    itens ≠ 0        soma            o que é
--   vrbase_stexterno           124.158   R$ 43.523.952,71   base da ST externa (o par do total da mig 286)
--   vrcustoreal                422.514   R$ 30.085.170,82   **custo REAL** — degrau da escada de custo
--   ultcustorep                411.701   R$ 18.128.955,45   último custo de reposição
--   custo_real_unit            391.422   R$ 15.931.303,45   custo real unitário
--   markup                     385.147   R$ 12.443.660,80   o markup do item na entrada
--   vrbasecalculoicm_calc       66.351   R$  9.536.359,85   base de ICMS recalculada
--   vendaliq                   383.537   R$  5.994.641,70   venda líquida
--   vricm_calc                  64.648   R$    955.552,19   ICMS recalculado
--   margeml2v                  382.328   R$    572.979,50   margem líquida (valor)
--   fcp_valor_st · _ret         45.045   R$    395.835,56   FCP-ST e FCP-ST retido
--   markupl2                   382.328   R$   -113.802,65   markup líquido
--   vrajcustodec47530          116.847   R$    -89.308,10   ajuste de custo do Decreto 47.530
--   vricms_desonerado            1.733   R$     55.742,41
--   vricms_stexterno             9.242   R$     49.064,44
--   vrfrete                      2.027   R$     30.612,81
--   ──────────────────────────────────────────────────────────────────────────
--   total                                **R$ 137.500.720,73**
--
-- ⚠️ E `IDSITUACAO_NF` está preenchida em **497.983 dos 498.439 itens** (99,9%): é a situação do item na
-- nota, e sem ela o item perde o próprio estado.
--
-- ── Por que a escada de custo importa aqui ───────────────────────────────────────────────────────────
-- O destino já tinha `vrcusto`, `vrcustorep`, `vrcustocsi`, `ultcusto` e `vl_custo` — mas não o
-- **`vrcustoreal`** nem o `custo_real_unit`, que são justamente os degraus que a precificação por NF usa
-- para decidir preço (dossiê `uPrecificacaoNFBruta.md` e a lição das TRÊS escadas de custo). Carregar meia
-- escada faz o recálculo de preço partir de um degrau que não existe — e o erro não aparece como falta,
-- aparece como preço diferente.
--
-- ── O que fica de fora, com prova ────────────────────────────────────────────────────────────────────
-- `vrcustoajustenf` (1 item, R$ 0,01), `atualiza_multipreco_decomp` e `item_perda_total` (flags de
-- decomposição sem uso medido). Declaradas em `ORIGEM_DECLARADA` no conferidor.

-- a escada de custo que faltava
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vrcustoreal      numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS custo_real_unit  numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS ultcustorep      numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS markup           numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS markupl2         numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vendaliq         numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS margeml2v        numeric(15,4);
COMMENT ON COLUMN nf_prod.vrcustoreal IS
  'custo REAL do item — degrau da escada que a precificação por NF usa; carregar meia escada muda o preço';

-- ST externa, FCP-ST e os recalculados
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vrbase_stexterno      numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vricms_stexterno      numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vrbasecalculoicm_calc numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vricm_calc            numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS fcp_aliquota_st       numeric(9,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS fcp_valor_st          numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS fcp_bc_st             numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS fcp_aliquota_st_ret   numeric(9,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS fcp_valor_st_ret      numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS fcp_bc_st_ret         numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vricms_desonerado     numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vrajcustodec47530     numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vrfrete               numeric(15,4);

-- crédito do Simples Nacional (pequeno, mas é regra fiscal: 416 itens)
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vrcredsn   numeric(15,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS aliqcredsn numeric(9,4);

-- a situação do item, preenchida em 99,9% das linhas
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS idsituacao_nf integer;
