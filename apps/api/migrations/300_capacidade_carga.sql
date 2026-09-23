-- 300 — CAPACIDADE: três colunas que QUEBRARIAM a carga, medidas contra o dado da PRODUÇÃO (só leitura, 23/09/2026).
-- O `mapa-colunas.py` existe para isto, mas mede na HOMOLOGAÇÃO (parada em fev/2024) — e na homologação só duas
-- apareciam. Refeita a conferência com a produção, em todas as fases do plano: cinco apontadas, duas eram falso
-- positivo (a carga já transforma: `empresas.cnpj` perde a pontuação e `apuracao_pc_det.tipo` vira C/D), três são
-- reais e ficam aqui. O teto é o tamanho DECLARADO no Oracle, não o maior dado de hoje.
--
--   diario.tipodoc          10 → 25    'CONTA A RECEBER' (15.089 linhas) e 'QUEBRA/SOBRA' (21.507) têm 15
--   diario.deschist        255 → 4000  121 históricos com até 371 caracteres
--   diario.documento        60 → 200   paridade com o Oracle (nenhum dado passa hoje, mas o campo é livre)
--   clube_desconto_mov.movimento varchar(60) → text
--        ⚠️ a mig 285 supôs "a chave do cupom (ex.: 51NFCE3121…)"; é o REGISTRO POSICIONAL INTEIRO do movimento
--        do clube (a chave na 1ª linha e o registro de largura fixa depois, 1,5 a 3 mil caracteres — CLOB no
--        legado). Com varchar(60) todas as 3,1 milhões de linhas falhariam.
--
-- `diario` é o razão contábil inteiro (1,69 milhão de linhas): a carga dele parava na primeira linha longa.
ALTER TABLE diario ALTER COLUMN tipodoc TYPE varchar(25);
ALTER TABLE diario ALTER COLUMN deschist TYPE varchar(4000);
ALTER TABLE diario ALTER COLUMN documento TYPE varchar(200);
ALTER TABLE clube_desconto_mov ALTER COLUMN movimento TYPE text;
