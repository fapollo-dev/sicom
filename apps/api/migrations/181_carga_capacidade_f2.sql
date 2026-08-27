-- 181 — CAPACIDADE (F2): `inventario.descricao` — dado real 126 > destino 120 (79.190 linhas). É o snapshot da
-- descrição do produto na folha de contagem, então segue a mesma medida que a mig 176 deu em `produtos.descricao`.
DO $$
DECLARE v RECORD; defs text[] := '{}';
BEGIN
  FOR v IN
    SELECT DISTINCT c.relname AS vn, pg_get_viewdef(c.oid, true) AS def
      FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class c ON c.oid = r.ev_class AND c.relkind = 'v'
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
     WHERE t.relname = 'inventario' AND a.attname = 'descricao'
  LOOP
    defs := defs || format('CREATE OR REPLACE VIEW %I AS %s', v.vn, v.def);
    EXECUTE format('DROP VIEW IF EXISTS %I CASCADE', v.vn);
  END LOOP;
  ALTER TABLE inventario ALTER COLUMN descricao TYPE varchar(150);
  FOR i IN 1 .. coalesce(array_length(defs,1),0) LOOP EXECUTE defs[i]; END LOOP;
END $$;
