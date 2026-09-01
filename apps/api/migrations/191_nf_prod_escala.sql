-- 191 — ESCALA das seis colunas de `nf_prod` que o legado guarda com mais casas do que a nossa declaração.
--
-- Achado do ensaio de carga, e só apareceu porque a reconciliação de VALORES passou a existir: `nf_prod` fechava
-- a contagem (252.469/252.469) e seis somas não fechavam —
--   desconto Σ 222.084,06 × 222.087,81 · bonificacao Σ 16.731,94 × 16.731,894362 · frete Σ 15.334,39 ×
--   15.334,395518 · mva Σ 1.083.213,82 × 1.083.213,8507 · seguro Σ 5,52 × 5,5277 · vrbasecalculo Σ
--   3.935.801,29 × 3.935.801,2818
-- porque as colunas são `numeric(13,2)` e o dado real do legado usa até SEIS casas (`tools/cutover/etl/
-- escala-numerica.py`: desconto 6.418919 · frete 81.505672 · bonificacao 2.146742 · mva 0.0001 · seguro 0.0611
-- · vrbasecalculo 440.2748). O Postgres arredondava na carga, em silêncio.
--
-- Não é preciosismo de casa decimal: `DESCONTO` é PERCENTUAL e entra no valor do item pela fórmula que a
-- apuração de ICMS já copia — `(VRCUSTO − VRCUSTO × DESCONTO/100) × QTDE`. Arredondar 6,418919% para 6,42%
-- muda o valor do item, que muda a base, que muda o imposto. `FRETE` e `BONIFICACAO` são rateios por item pela
-- mesma razão, e `VRBASECALCULO` é a base gravada.
--
-- Escala pelo que o dado exige, precisão preservando os 11 dígitos inteiros que a coluna já comportava
-- (13 − 2): 11 + 4 = 15 e 11 + 6 = 17. Nada que cabia antes deixa de caber. A varredura das CINCO fases
-- (20,9M linhas, 69 tabelas) não achou NENHUMA outra coluna numérica fora de escala, nem nenhuma com dígitos
-- inteiros além da precisão declarada — estas seis são o universo do problema.
--
-- Como em 174/176/181/184/187, o `ALTER TYPE` esbarra nas views que expõem essas colunas, então o bloco guarda
-- a definição das dependentes, dropa, altera e recria com o texto original.
DO $$
DECLARE
  v RECORD;
  defs text[] := '{}';
  nomes text[] := '{}';
BEGIN
  FOR v IN
    SELECT DISTINCT c.relname AS view_name, pg_get_viewdef(c.oid, true) AS def
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class c ON c.oid = r.ev_class AND c.relkind = 'v'
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
     WHERE (t.relname, a.attname) IN (
             ('nf_prod','mva'), ('nf_prod','bonificacao'), ('nf_prod','desconto'),
             ('nf_prod','frete'), ('nf_prod','seguro'), ('nf_prod','vrbasecalculo'))
  LOOP
    nomes := nomes || v.view_name;
    defs  := defs  || format('CREATE OR REPLACE VIEW %I AS %s', v.view_name, v.def);
    EXECUTE format('DROP VIEW IF EXISTS %I CASCADE', v.view_name);
  END LOOP;

  ALTER TABLE nf_prod ALTER COLUMN mva           TYPE numeric(15,4);
  ALTER TABLE nf_prod ALTER COLUMN seguro        TYPE numeric(15,4);
  ALTER TABLE nf_prod ALTER COLUMN vrbasecalculo TYPE numeric(15,4);
  ALTER TABLE nf_prod ALTER COLUMN bonificacao   TYPE numeric(17,6);
  ALTER TABLE nf_prod ALTER COLUMN desconto      TYPE numeric(17,6);
  ALTER TABLE nf_prod ALTER COLUMN frete         TYPE numeric(17,6);

  FOR i IN 1 .. coalesce(array_length(defs, 1), 0) LOOP
    EXECUTE defs[i];
  END LOOP;
  RAISE NOTICE 'mig 191: % view(s) recriada(s): %', coalesce(array_length(nomes,1),0), nomes;
END $$;
