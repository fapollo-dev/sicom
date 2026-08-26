-- 174 — CAPACIDADE DE COLUNA para a CARGA (achados do mapa coluna-a-coluna da F0, `tools/cutover/etl/mapa-colunas.py`).
--
-- O mapa cruza o schema real do destino com o dicionário do Oracle e acusa toda coluna cujo destino é MENOR que a
-- origem — o que só apareceria quando a carga truncasse um valor real. Na F0:
--   • det_aliquota.icm / icm_efetivo / base: numeric(7,2) contra NUMBER(13);
--   • det_aliquota.csosn varchar(4) × VARCHAR2(12) · det_aliquota.lei varchar(200) × VARCHAR2(500);
--   • familias_prod.descricao varchar(60) × VARCHAR2(100) (2.392 linhas) ;
--   • plano_contas.descricao varchar(120) × VARCHAR2(150) (11.024 contas).
--
-- Várias dessas colunas são expostas por VIEWS de lookup, e o Postgres recusa `ALTER TYPE` nesse caso. O bloco
-- abaixo faz o padrão seguro: guarda a definição de TODAS as views que dependem das colunas alvo, dropa,
-- altera e recria com o texto original — sem precisar saber de cor quais são.
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
             ('det_aliquota','icm'), ('det_aliquota','icm_efetivo'), ('det_aliquota','base'),
             ('det_aliquota','csosn'), ('det_aliquota','lei'),
             ('familias_prod','descricao'), ('plano_contas','descricao'))
  LOOP
    nomes := nomes || v.view_name;
    defs  := defs  || format('CREATE OR REPLACE VIEW %I AS %s', v.view_name, v.def);
    EXECUTE format('DROP VIEW IF EXISTS %I CASCADE', v.view_name);
  END LOOP;

  ALTER TABLE det_aliquota  ALTER COLUMN icm         TYPE numeric(15,4);
  ALTER TABLE det_aliquota  ALTER COLUMN icm_efetivo TYPE numeric(15,4);
  ALTER TABLE det_aliquota  ALTER COLUMN base        TYPE numeric(15,4);
  ALTER TABLE det_aliquota  ALTER COLUMN csosn       TYPE varchar(12);
  ALTER TABLE det_aliquota  ALTER COLUMN lei         TYPE varchar(500);
  ALTER TABLE familias_prod ALTER COLUMN descricao   TYPE varchar(100);
  ALTER TABLE plano_contas  ALTER COLUMN descricao   TYPE varchar(150);

  FOR i IN 1 .. coalesce(array_length(defs, 1), 0) LOOP
    EXECUTE defs[i];
  END LOOP;
  RAISE NOTICE 'mig 174: % view(s) recriada(s): %', coalesce(array_length(nomes,1),0), nomes;
END $$;
