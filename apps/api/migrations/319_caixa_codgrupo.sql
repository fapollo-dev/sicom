-- 319 — o GRUPO do lançamento de caixa (CAIXA.CODGRUPO), a sequência `ID_CODGRUPO` do legado (GetID('CODGRUPO')).
-- O caixa que a NF gera no processamento (`GerarLancamentosDeCaixa`, udmNF.pas:9266; UCadSituacaoNF.md C4) leva um grupo
-- novo por lançamento. O grupo é compartilhado com o CX_VENDAS (turno do PDV) e o CX_APAGAR: a sequência começa acima
-- do maior dos três (a carga a reposiciona pelo CAIXA; o pós-carga, pelos três).
CREATE SEQUENCE IF NOT EXISTS seq_caixa_codgrupo;
ALTER SEQUENCE seq_caixa_codgrupo OWNED BY caixa.codgrupo;
SELECT setval('seq_caixa_codgrupo', greatest(
  coalesce((SELECT max(codgrupo) FROM caixa), 0),
  coalesce((SELECT max(codgrupo) FROM cx_vendas), 0),
  coalesce((SELECT max(codgrupo) FROM cx_apagar), 0)) + 1, false);
