-- 065 — RECEBIMENTO corte-4c: ST RESIDUAL (ICMS-ST a recolher pela loja) → título A Pagar 'RESIDUAL ST'.
--
-- Cenário real (golden PINHEIRAO, 177 títulos): compra interestadual (CFOP 2102/2403) de produto sujeito
-- a ICMS-ST em que o FORNECEDOR não reteve o ST na origem — a LOJA recolhe o ST antecipado. Vira 1 título
-- A Pagar por NF, TIPODOC='RESIDUAL ST', RETENCAO='ICMSST', GERADO='SISTEMA', à vista (DTVENC=data da compra).
--
-- FÓRMULA (verificada 1:1 no golden; uNF.pas:4817-4821): ICMS_ST_APAGAR = TOTALICM_STEXTERNO − ICMS_ST_PAGO_FONTE
-- (só quando TOTALICM_STEXTERNO>0; ICMS_ST_PAGO_FONTE=0 em 100% da amostra — fornecedor não reteve).
--   - TOTALICM_STEXTERNO = ST que a loja deve recolher (Σ do ST-externo por item; golden = Σ STREAL).
--   - ICMS_ST_PAGO_FONTE = ST já retido/destacado na origem (abate o residual).
--
-- FIDELIDADE (dossiê §9): este corte entrega o MECANISMO golden-exato (fórmula + shape do título +
-- persistência) com TOTALICM_STEXTERNO/ICMS_ST_PAGO_FONTE como campos de CABEÇALHO (a F2/operador informa).
-- A AUTO-DERIVAÇÃO por item do TOTALICM_STEXTERNO (o roteamento "ST externo") NÃO está aqui: vive em parte no
-- FuncoesApollo (submódulo fechado) e as condições visíveis do .pas (ST_EXTERNO='S'+CFOP 1403/2403) NÃO batem
-- com os CFOPs reais do golden (2102/2403, ST_EXTERNO='N') — o roteamento real é mais amplo. IMPORTANTE: o gate
-- lógico `externo>0` NÃO é o gate golden — na base, das ~958 entradas com ICMS_ST_APAGAR>0 só 177 geraram
-- título (o gate fino, por situação/CFOP/regime, é do motor fiscal). Hoje isso é inócuo porque total_icmst_externo
-- só é populado quando informado (default 0); quando um motor fiscal por item começar a populá-lo, o gate precisa
-- ser estreitado (senão super-gera ~3,3×). O import de XML não computa ST externo → icms_st_apagar=0 → não gera
-- título (fiel ao NF_IMPORTACAO_NFE do legado, que desliga o caminho de ST externo no import).

-- (A) Campos de ST residual no cabeçalho da NF.
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_icmst_externo numeric(13,2) DEFAULT 0; -- ST a recolher (base do residual)
ALTER TABLE nf ADD COLUMN IF NOT EXISTS icms_st_pago_fonte  numeric(13,2) DEFAULT 0; -- ST já retido na origem (abate)
ALTER TABLE nf ADD COLUMN IF NOT EXISTS icms_st_apagar      numeric(13,2) DEFAULT 0; -- = max(0, externo − pago_fonte)

-- (B) Discriminador de retenção no título A Pagar (RESIDUAL ST → 'ICMSST'; forward-compat p/ retenção federal).
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS retencao varchar(10);
