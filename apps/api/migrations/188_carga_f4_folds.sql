-- 188 — FOLDS da F4 (movimento), os três do 1º ensaio.
--
-- 1) `vendas.nrocupom` é integer e o legado tem **9.999.999.999** (10 dígitos) — acima do teto de integer
--    (2.147.483.647). É o número do cupom do PDV; não dá para truncar nem descartar a venda.
-- (nrocupom aparece em views de relatório; mesmo padrão das migs 174/176/181)
DO $$
DECLARE v RECORD; defs text[] := '{}';
BEGIN
  FOR v IN
    SELECT DISTINCT c.relname AS vn, pg_get_viewdef(c.oid, true) AS def
      FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class c ON c.oid = r.ev_class AND c.relkind = 'v'
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
     WHERE t.relname = 'vendas' AND a.attname = 'nrocupom'
  LOOP
    defs := defs || format('CREATE OR REPLACE VIEW %I AS %s', v.vn, v.def);
    EXECUTE format('DROP VIEW IF EXISTS %I CASCADE', v.vn);
  END LOOP;
  ALTER TABLE vendas ALTER COLUMN nrocupom TYPE bigint;
  FOR i IN 1 .. coalesce(array_length(defs,1),0) LOOP EXECUTE defs[i]; END LOOP;
END $$;

-- 2) `historico_prod.tipo` NOT NULL: o legado permite nulo no kardex.
ALTER TABLE historico_prod ALTER COLUMN tipo DROP NOT NULL;

-- 3) `ux_nfe_naocad_chave`: 2 chaves de NFe importadas duas vezes (4 linhas — §7b). Aqui a unicidade É usada
--    (o manifesto DF-e evita reimportar), então segue o padrão: exclui o histórico em vez de sumir.
ALTER TABLE nfe_nao_cadastradas ADD COLUMN IF NOT EXISTS origem_legado char(1);
DROP INDEX IF EXISTS ux_nfe_naocad_chave;
CREATE UNIQUE INDEX IF NOT EXISTS ux_nfe_naocad_chave
  ON nfe_nao_cadastradas (chavenfe)
  WHERE chavenfe IS NOT NULL AND coalesce(origem_legado, 'N') <> 'S';
