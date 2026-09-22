-- 286 — NF: os totais do cabeçalho que a carga deixava para trás (R$ 160 milhões em bases e valores).
-- Primeiro achado do sentido NOVO do `conferir-colunas-orfas.py` (origem → destino), 22/09/2026.
-- Contagens no Oracle de produção (só leitura).
--
-- ── Como isto passou despercebido ────────────────────────────────────────────────────────────────────
-- A conferência antiga olhava só um lado: coluna que o DESTINO exige e a origem não tem, onde a carga cai
-- no default. Estas são o contrário — a ORIGEM tem e o destino não —, e por isso não caem em default
-- nenhum: simplesmente não são carregadas, e o dado some sem deixar buraco. `nf` está no plano desde o
-- começo e mesmo assim perdia 28 colunas do cabeçalho.
--
-- ── O que se perdia, medido (linhas com valor ≠ 0 e a soma) ──────────────────────────────────────────
--   coluna                        notas        soma
--   total_icms_nota_bc           26.056   R$ 49.762.363,32   base de ICMS da NOTA DO FORNECEDOR
--   totalbase_stexterno          17.078   R$ 43.524.106,47   base da ST externa
--   totalbaseicmt                16.999   R$ 41.191.944,85   base de ICMS de transporte
--   totalbaseicmsrep              7.153   R$  7.638.892,75   base de ICMS de repasse
--   totalprodst                   1.903   R$  7.063.321,44   total de produtos com ST
--   total_icms_nota_valor        23.956   R$  6.006.312,03   valor de ICMS da NOTA DO FORNECEDOR
--   total_streal                 17.051   R$  3.058.772,97   ST real
--   totalrepicm                   7.190   R$    913.053,46   repasse de ICMS
--   total_bonificado              1.891   R$    889.628,65
--   total_fcp_valor_st            2.874   R$    279.329,71   FCP-ST
--   total_fcp_valor_st_ret        1.867   R$    117.976,06   FCP-ST retido
--   total_icmsdeson                 475   R$     50.004,76   ICMS desonerado
--   ──────────────────────────────────────────────────────────────────────────
--   total                                 **R$ 160.495.706,47**
--
-- O padrão do que faltava é nítido: o destino trouxe os totais PRINCIPAIS (produto, desconto, frete, ICMS,
-- IPI) e deixou de fora os de **substituição tributária, FCP, repasse e o par de conferência da nota**.
--
-- ── ⚠️ `TOTAL_ICMS_NOTA_*` é o par de conferência do cabeçalho ───────────────────────────────────────
-- É o mesmo desenho dos `icms_nota_*` que o ITEM já tem (mig 279 §8.2): o que o FORNECEDOR declarou, ao
-- lado do que a conferência de entrada apurou. Sem ele no cabeçalho, a nota perde a referência de origem
-- justamente nos dois campos que a fiscalização confronta primeiro — base e valor de ICMS.
--
-- ── O que NÃO entra, e por quê ───────────────────────────────────────────────────────────────────────
-- Das 28 colunas que o conferidor apontou, 16 ficam de fora com prova:
--   · `codnfstatuspro` (42.064) — é FK para a esteira `NF_STATUS_PROCESSO`, que ainda não tem destino;
--     entra junto com ela, num corte próprio, senão seria referência para o nada.
--   · `qtde` (46.312) — contagem de itens da nota; aqui é derivável de `nf_prod` e guardá-la criaria um
--     segundo lugar para a mesma verdade, que é como um dos dois fica desatualizado.
--   · `validatotalnf` — flag de processo do legado, não valor.
--   · `totalfrete2` (1 nota), `total_fcp` (1), `totalvroutros` (1), `totaldescfinal` (22),
--     `totalipi_devolucao` (41) e as demais: resíduo medido, somando menos de R$ 151 mil no total e
--     concentrado em pouquíssimas notas. Voltam se algum dia forem usadas de verdade.

-- bases e valores de ICMS/ST que faltavam
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_icms_nota_bc     numeric(15,2);
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_icms_nota_valor  numeric(15,2);
COMMENT ON COLUMN nf.total_icms_nota_bc IS
  'base de ICMS que o FORNECEDOR declarou — o par de conferência do cabeçalho, como icms_nota_bc no item';
ALTER TABLE nf ADD COLUMN IF NOT EXISTS totalbase_stexterno    numeric(15,2);
ALTER TABLE nf ADD COLUMN IF NOT EXISTS totalbaseicmt          numeric(15,2);
ALTER TABLE nf ADD COLUMN IF NOT EXISTS totalbaseicmsrep       numeric(15,2);
ALTER TABLE nf ADD COLUMN IF NOT EXISTS totalrepicm            numeric(15,2);
ALTER TABLE nf ADD COLUMN IF NOT EXISTS totalprodst            numeric(15,2);
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_streal           numeric(15,2);
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_fcp_valor_st     numeric(15,2);
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_fcp_valor_st_ret numeric(15,2);
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_icmsdeson        numeric(15,2);
ALTER TABLE nf ADD COLUMN IF NOT EXISTS total_bonificado       numeric(15,2);
