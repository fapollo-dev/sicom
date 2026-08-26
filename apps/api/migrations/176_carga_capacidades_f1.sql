-- 176 — CAPACIDADE (F1): as colunas em que o DADO REAL do cliente não cabe no destino.
--
-- O mapa da F1 acusou 20 colunas com declaração menor que a origem, mas declaração não é problema por si
-- (`cnpj varchar(14)` contra `VARCHAR2(30)` nunca estoura). Medindo `max(length)` no Oracle sobraram QUATRO —
-- e três são descrição de produto, o campo que aparece em etiqueta, cupom e SPED:
--   produtos.descricao          dado 126 > destino 120   (43.116 produtos)
--   produtos.descricao_resumida dado 100 > destino  60
--   produtos.descricao_balanca  dado 126 > destino  60
-- A quarta é `empresas.cnpj` (dado 18 > destino 14): lá o CNPJ vem FORMATADO (00.000.000/0000-00). Aqui a
-- coluna é de 14 porque o app guarda só dígitos — então é **transformação de carga** (remover não-dígitos),
-- não alargamento: alargar aceitaria os pontos e quebraria toda comparação de CNPJ do sistema.
-- (mesmo padrão da mig 174: as descrições aparecem em views de lookup e o Postgres recusa ALTER TYPE)
DO $$
DECLARE
  v RECORD; defs text[] := '{}'; nomes text[] := '{}';
BEGIN
  FOR v IN
    SELECT DISTINCT c.relname AS view_name, pg_get_viewdef(c.oid, true) AS def
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class c ON c.oid = r.ev_class AND c.relkind = 'v'
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
     WHERE t.relname = 'produtos'
       AND a.attname IN ('descricao', 'descricao_resumida', 'descricao_balanca')
  LOOP
    nomes := nomes || v.view_name;
    defs  := defs  || format('CREATE OR REPLACE VIEW %I AS %s', v.view_name, v.def);
    EXECUTE format('DROP VIEW IF EXISTS %I CASCADE', v.view_name);
  END LOOP;

  ALTER TABLE produtos ALTER COLUMN descricao          TYPE varchar(150);
  ALTER TABLE produtos ALTER COLUMN descricao_resumida TYPE varchar(100);
  ALTER TABLE produtos ALTER COLUMN descricao_balanca  TYPE varchar(150);

  FOR i IN 1 .. coalesce(array_length(defs, 1), 0) LOOP EXECUTE defs[i]; END LOOP;
  RAISE NOTICE 'mig 176: % view(s) recriada(s): %', coalesce(array_length(nomes,1),0), nomes;
END $$;
