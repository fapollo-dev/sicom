-- 179 — REVERTIDO por evidência do smoke.
--
-- A primeira versão desta migration derrubava o NOT NULL de `codreferencia_for.codref` porque a origem tem 4
-- nulos em 16.229. Só que o app CONTA com o campo preenchido (o de-para converte a referência e, com nulo, o
-- caminho de importação quebrou com "invalid input syntax for type integer: NaN"). Entre afrouxar o app para
-- caber 4 linhas de lixo e descartar essas 4 na carga, a segunda é a escolha certa — e fica CONTADA, como o
-- resto dos descartes (o extrator filtra `codref IS NOT NULL` e o manifesto registra a diferença).
--
-- (nada a fazer aqui; a regra vive em tools/cutover/etl/extrair.py — FILTROS)
SELECT 1;
