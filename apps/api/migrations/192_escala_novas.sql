-- 192 — ESCALA de três colunas que o dado de PRODUÇÃO usa com mais casas do que a declaração, achadas pela
-- varredura `escala-numerica.py` sobre as 70 tabelas que o plano antigo não cobria (§7s do plano de carga):
--
--   indexador_tributario.mva               dado com 4 casas (ex. 0.0001) · coluna numeric(7,2)
--   nfe_nao_cadastradas_itens.vrunitario   dado com 9 casas (ex. 0.852027329) · coluna numeric(15,6)
--   nfe_nao_cadastradas_itens.vrunitariotrib idem
--
-- O `vUnCom`/`vUnTrib` da NF-e admite até DEZ casas decimais (leiaute 4.00, TDec_1110: 21 dígitos, 10 decimais)
-- e essas colunas guardam o valor unitário como veio do XML da nota do fornecedor — arredondar para 6 casas
-- muda o unitário que a conferência compara com o pedido. Escala pelo leiaute: numeric(21,10). O MVA é
-- percentual com 4 casas no legado; numeric(9,4) preserva os 5 dígitos inteiros que já cabiam.
--
-- Mesmo padrão de 174/176/181/184/187/191 para as views dependentes.
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
             ('indexador_tributario','mva'),
             ('nfe_nao_cadastradas_itens','vrunitario'), ('nfe_nao_cadastradas_itens','vrunitariotrib'))
  LOOP
    nomes := nomes || v.view_name;
    defs  := defs  || format('CREATE OR REPLACE VIEW %I AS %s', v.view_name, v.def);
    EXECUTE format('DROP VIEW IF EXISTS %I CASCADE', v.view_name);
  END LOOP;

  ALTER TABLE indexador_tributario      ALTER COLUMN mva            TYPE numeric(9,4);
  ALTER TABLE nfe_nao_cadastradas_itens ALTER COLUMN vrunitario     TYPE numeric(21,10);
  ALTER TABLE nfe_nao_cadastradas_itens ALTER COLUMN vrunitariotrib TYPE numeric(21,10);

  FOR i IN 1 .. coalesce(array_length(defs, 1), 0) LOOP
    EXECUTE defs[i];
  END LOOP;
  RAISE NOTICE 'mig 192: % view(s) recriada(s): %', coalesce(array_length(nomes,1),0), nomes;
END $$;
