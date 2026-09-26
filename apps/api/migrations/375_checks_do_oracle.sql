-- As CHECK constraints do legado (USER_CONSTRAINTS tipo 'C', fora os NOT NULL — auditoria de 25/09/2026) que o destino não tinha, nas
-- tabelas carregadas. As do BI (BI_*) e dos logs JSON (LICENCIAMENTO_LOG, INFORMES_LOG) são de sistemas de fora; a
-- OPERADORES_RESTRICAO_ACESSO (dia 1-7) já existe (mig 107); CONTAS_BANC_TRANSF_PERM (origem ≠ destino) é regra do serviço
-- (TRANSFERENCIA_MESMA_CONTA) e ganha a guarda no banco. NOT VALID: o dado do legado já obedece (o Oracle as aplica); a guarda vale para o
-- que for gravado daqui em diante.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('agenda_promocao_itens',   'ck_agenda_itens_tv',              $c$tv IN ('T', 'F')$c$),
    ('empresas',                'ck_empresa_alertafiscal_amb',     $c$alertafiscal_ambiente IN ('H', 'P') OR alertafiscal_ambiente IS NULL$c$),
    ('contas_banc_transf_perm', 'ck_cb_transf_perm_dif',           $c$codconta_origem <> codconta_destino$c$),
    ('ncm_lc224_2025',          'ck_ncm_lc224_tipo',               $c$tipo_match IN ('E', 'P', 'C')$c$),
    ('ncm_lc224_2025',          'ck_ncm_lc224_ativo',              $c$ativo IN ('S', 'N')$c$),
    ('apuracao_pc_ajuste_m',    'ck_apuracao_pc_ajuste_m_reg',     $c$reg_m IN ('M110', 'M115', 'M220', 'M225', 'M510', 'M515', 'M620', 'M625')$c$),
    ('apuracao_pc_ajuste_m',    'ck_apuracao_pc_ajuste_m_ind',     $c$ind_aj IS NULL OR ind_aj IN ('0', '1')$c$),
    ('pc_tab_ajuste_pis',       'ck_pc_tab_ajuste_pis_tipo',       $c$tipo IN ('C', 'D')$c$),
    ('pc_tab_ajuste_pis',       'ck_pc_tab_ajuste_pis_ativo',      $c$ativo IN ('S', 'N')$c$),
    ('pc_tab_ajuste_cofins',    'ck_pc_tab_ajuste_cofins_tipo',    $c$tipo IN ('C', 'D')$c$),
    ('pc_tab_ajuste_cofins',    'ck_pc_tab_ajuste_cofins_ativo',   $c$ativo IN ('S', 'N')$c$),
    ('nf',                      'chk_nf_tipo_guia_trans',          $c$tipo_guia_transito IS NULL OR tipo_guia_transito BETWEEN 1 AND 7$c$)
  ) AS v(tabela, nome, cond)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = r.tabela)
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.nome) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID', r.tabela, r.nome, r.cond);
    END IF;
  END LOOP;
END $$;
