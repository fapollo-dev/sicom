-- 318 — TAMANHOS DO LEGADO: as colunas do destino mais estreitas que as do Oracle (conferir-tamanhos.py, 23/09/2026).
--
-- A terceira escala do "tem que ter todos os campos": a coluna existia, mas menor — `situacao_nf.descricao` VARCHAR2(100) no
-- legado e varchar(80) aqui; `cotacao_prod.valorcusto` NUMBER(15,4) e numeric(13,4). Enquanto o dado cabe ninguém vê; no dia
-- em que o legado aceitar um valor maior, a carga falha ou arredonda. O conferidor mediu na produção: 160 colunas em que o
-- dado de hoje cabe mas o legado aceita mais (textos e números) ficam com o tamanho do legado.
--
-- E a AGENDA DE LIMITAÇÃO guarda a HORA: no legado DTINICIO/DTFIM são TIMESTAMP (a tela põe 00:00 e 23:59 por padrão, e a
-- produção tem agendas de 05:00 até 01:00 do dia seguinte); o destino tinha `date`.
--
-- As outras 14 datas com hora no legado ficam `date`, com veredito e medida em conferir-tamanhos.py (DATAS_DIA): lá a hora é
-- o carimbo do momento da gravação num campo que a tela trata como data.

-- ALTER TYPE falha se uma view usa a coluna: a função guarda as views dependentes (e as que dependem delas), derruba,
-- altera e recria na ordem, com o COMMENT (o catálogo do construtor de relatórios mora no COMMENT da view).
CREATE OR REPLACE FUNCTION apollo_alterar_tipo(p_tabela text, p_coluna text, p_tipo text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _apollo_views_dep (nivel int, oid oid, nome text, def text, comentario text);
  DELETE FROM _apollo_views_dep;
  WITH RECURSIVE dep(oid, nivel) AS (
    SELECT DISTINCT rw.ev_class, 1
      FROM pg_depend d
      JOIN pg_rewrite rw ON rw.oid = d.objid
      JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
     WHERE d.refobjid = p_tabela::regclass AND a.attname = p_coluna AND rw.ev_class <> p_tabela::regclass
    UNION
    SELECT DISTINCT rw.ev_class, dep.nivel + 1
      FROM dep
      JOIN pg_depend d ON d.refobjid = dep.oid
      JOIN pg_rewrite rw ON rw.oid = d.objid
     WHERE rw.ev_class <> dep.oid AND dep.nivel < 20
  )
  INSERT INTO _apollo_views_dep
  SELECT max(dep.nivel), c.oid, c.oid::regclass::text, pg_get_viewdef(c.oid), obj_description(c.oid, 'pg_class')
    FROM dep JOIN pg_class c ON c.oid = dep.oid
   WHERE c.relkind = 'v'
   GROUP BY c.oid;
  FOR r IN SELECT * FROM _apollo_views_dep ORDER BY nivel DESC LOOP
    EXECUTE format('DROP VIEW IF EXISTS %s', r.nome);
  END LOOP;
  EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE %s', p_tabela, p_coluna, p_tipo);
  FOR r IN SELECT * FROM _apollo_views_dep ORDER BY nivel ASC LOOP
    EXECUTE format('CREATE VIEW %s AS %s', r.nome, r.def);
    IF r.comentario IS NOT NULL THEN
      EXECUTE format('COMMENT ON VIEW %s IS %L', r.nome, r.comentario);
    END IF;
  END LOOP;
  DELETE FROM _apollo_views_dep;
END $$;

-- a agenda de limitação com hora (o dia antigo vira 00:00 de Brasília)
SELECT apollo_alterar_tipo('agenda_produto', 'dtinicio', 'timestamptz');
SELECT apollo_alterar_tipo('agenda_produto', 'dtfim', 'timestamptz');

-- os 160 alargamentos (gerados por `conferir-tamanhos.py --sql`)
SELECT apollo_alterar_tipo('agenda_produto', 'descricao', 'varchar(250)');  -- texto VARCHAR2(250) → character varying(150)
SELECT apollo_alterar_tipo('ajuste_estoque', 'operacao', 'varchar(20)');  -- texto VARCHAR2(20) → character varying(12)
SELECT apollo_alterar_tipo('ajuste_estoque', 'destino', 'varchar(20)');  -- texto VARCHAR2(20) → character varying(12)
SELECT apollo_alterar_tipo('apagar', 'retencao', 'varchar(20)');  -- texto VARCHAR2(20) → character varying(10)
SELECT apollo_alterar_tipo('audit_permissoes', 'tipo', 'varchar(200)');  -- texto VARCHAR2(200) → character varying(20)
SELECT apollo_alterar_tipo('bandeira', 'bandeira', 'varchar(100)');  -- texto VARCHAR2(100) → character varying(40)
SELECT apollo_alterar_tipo('caixa', 'tiporecurso', 'varchar(25)');  -- texto VARCHAR2(25) → character varying(20)
SELECT apollo_alterar_tipo('cest', 'cest', 'varchar(20)');  -- texto VARCHAR2(20) → character varying(7)
SELECT apollo_alterar_tipo('cest', 'ncm', 'varchar(150)');  -- texto VARCHAR2(150) → character varying(8)
SELECT apollo_alterar_tipo('cfop', 'preco_custo', 'varchar(2)');  -- texto VARCHAR2(2) → character(1)
SELECT apollo_alterar_tipo('clube_desconto', 'quantidade', 'numeric(16,4)');  -- número NUMBER(15,4) → numeric(15,3)
SELECT apollo_alterar_tipo('clube_desconto', 'quantidade_paga', 'numeric(16,4)');  -- número NUMBER(15,4) → numeric(15,3)
SELECT apollo_alterar_tipo('clube_desconto', 'valor', 'numeric(17,4)');  -- número NUMBER(15,4) → numeric(15,2)
SELECT apollo_alterar_tipo('clube_desconto', 'maximo', 'numeric(16,4)');  -- número NUMBER(15,4) → numeric(15,3)
SELECT apollo_alterar_tipo('clube_desconto', 'valorcombo', 'numeric(17,4)');  -- número NUMBER(15,4) → numeric(15,2)
SELECT apollo_alterar_tipo('clube_desconto', 'minimo', 'numeric(16,4)');  -- número NUMBER(15,4) → numeric(15,3)
SELECT apollo_alterar_tipo('clube_desconto', 'maximo_estoque', 'numeric(16,4)');  -- número NUMBER(15,4) → numeric(15,3)
SELECT apollo_alterar_tipo('clube_desconto', 'valor_minimo_compra', 'numeric(17,4)');  -- número NUMBER(15,4) → numeric(15,2)
SELECT apollo_alterar_tipo('clube_desconto', 'descricao', 'varchar(250)');  -- texto VARCHAR2(250) → character varying(200)
SELECT apollo_alterar_tipo('clube_desconto_mov', 'nome', 'varchar(100)');  -- texto VARCHAR2(100) → character varying(60)
SELECT apollo_alterar_tipo('clube_desconto_mov', 'origem', 'varchar(20)');  -- texto VARCHAR2(20) → character varying(2)
SELECT apollo_alterar_tipo('codauxiliar', 'codauxiliar', 'varchar(20)');  -- texto VARCHAR2(20) → character varying(14)
SELECT apollo_alterar_tipo('config_import_conciliador', 'cic_descricao', 'varchar(250)');  -- texto VARCHAR2(250) → character varying(100)
SELECT apollo_alterar_tipo('config_import_conciliador', 'cic_tipo_importacao', 'varchar(30)');  -- texto VARCHAR2(30) → character varying(20)
SELECT apollo_alterar_tipo('config_import_conciliador_item', 'cici_campo_tabela', 'varchar(50)');  -- texto VARCHAR2(50) → character varying(40)
SELECT apollo_alterar_tipo('config_import_conciliador_item', 'cici_tipo_campo', 'varchar(50)');  -- texto VARCHAR2(50) → character varying(20)
SELECT apollo_alterar_tipo('config_import_conciliador_item', 'cici_formato_campo', 'varchar(100)');  -- texto VARCHAR2(100) → character varying(30)
SELECT apollo_alterar_tipo('config_import_conciliador_item', 'cici_tabela', 'varchar(100)');  -- texto VARCHAR2(100) → character varying(40)
SELECT apollo_alterar_tipo('configuracoes', 'tipovalor', 'varchar(30)');  -- texto VARCHAR2(30) → character varying(20)
SELECT apollo_alterar_tipo('cotacao_forn', 'obs', 'varchar(800)');  -- texto VARCHAR2(800) → character varying(255)
SELECT apollo_alterar_tipo('cotacao_forn_itens', 'valor', 'numeric(15,4)');  -- número NUMBER(15,4) → numeric(13,4)
SELECT apollo_alterar_tipo('cotacao_forn_itens', 'icms', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('cotacao_forn_itens', 'valorembal', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('cotacao_forn_itens', 'valortotal', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('cotacao_prod', 'valorcusto', 'numeric(15,4)');  -- número NUMBER(15,4) → numeric(13,4)
SELECT apollo_alterar_tipo('cotacao_prod', 'valorvenda', 'numeric(15,4)');  -- número NUMBER(15,4) → numeric(13,4)
SELECT apollo_alterar_tipo('cotacao_prod', 'fatorembalagem', 'numeric(14,3)');  -- número NUMBER(13,2) → numeric(13,3)
SELECT apollo_alterar_tipo('cotacao_prod', 'descricao', 'varchar(250)');  -- texto VARCHAR2(250) → character varying(120)
SELECT apollo_alterar_tipo('cotacao_prodqtde', 'qtde', 'numeric(14,3)');  -- número NUMBER(13,2) → numeric(13,3)
SELECT apollo_alterar_tipo('empresas', 'complemento', 'varchar(100)');  -- texto VARCHAR2(100) → character varying(60)
SELECT apollo_alterar_tipo('empresas', 'im', 'varchar(30)');  -- texto VARCHAR2(30) → character varying(20)
SELECT apollo_alterar_tipo('empresas', 'percent_multa', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('empresas', 'valor_cbs', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(7,4)
SELECT apollo_alterar_tipo('grupo_operador', 'descricao', 'varchar(200)');  -- texto VARCHAR2(200) → character varying(40)
SELECT apollo_alterar_tipo('historico', 'tabela', 'varchar(150)');  -- texto VARCHAR2(150) → character varying(40)
SELECT apollo_alterar_tipo('historico_envio_nfe', 'chavenfe', 'varchar(50)');  -- texto VARCHAR2(50) → character varying(44)
SELECT apollo_alterar_tipo('historico_processamento_nf', 'historico', 'varchar(50)');  -- texto VARCHAR2(50) → character varying(20)
SELECT apollo_alterar_tipo('historico_prod', 'historico', 'varchar(450)');  -- texto VARCHAR2(450) → character varying(255)
SELECT apollo_alterar_tipo('historico_prod', 'origem', 'varchar(20)');  -- texto VARCHAR2(20) → character varying(10)
SELECT apollo_alterar_tipo('ibs_uf', 'uf', 'varchar(26)');  -- texto VARCHAR2(26) → character(2)
SELECT apollo_alterar_tipo('ibs_uf', 'valor_ibs_uf', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(7,4)
SELECT apollo_alterar_tipo('indexador_tributario', 'aliquota_reduzida_lei_3166', 'numeric(13,2)');  -- número NUMBER(13,2) → numeric(7,2)
SELECT apollo_alterar_tipo('indexador_tributario', 'aliquota_fem', 'numeric(13,2)');  -- número NUMBER(13,2) → numeric(7,2)
SELECT apollo_alterar_tipo('indexador_tributario', 'aliquota_dest', 'numeric(13,2)');  -- número NUMBER(13,2) → numeric(7,2)
SELECT apollo_alterar_tipo('indexador_tributario', 'icm_fonte', 'numeric(13,2)');  -- número NUMBER(13,2) → numeric(7,2)
SELECT apollo_alterar_tipo('indexador_tributario', 'redcom', 'numeric(13,2)');  -- número NUMBER(13,2) → numeric(7,2)
SELECT apollo_alterar_tipo('indexador_tributario', 'mva', 'numeric(13,4)');  -- número NUMBER(13,4) → numeric(9,4)
SELECT apollo_alterar_tipo('indexador_tributario', 'reducao', 'numeric(13,2)');  -- número NUMBER(13,2) → numeric(7,2)
SELECT apollo_alterar_tipo('inventario', 'vrcusto', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('inventario', 'vrvenda', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('inventario', 'diferenca', 'numeric(14,3)');  -- número NUMBER(13,2) → numeric(13,3)
SELECT apollo_alterar_tipo('inventario_rotativo', 'qtd_anterior', 'numeric(15,3)');  -- número NUMBER(15,3) → numeric(13,3)
SELECT apollo_alterar_tipo('inventario_rotativo', 'qtd_atual', 'numeric(15,3)');  -- número NUMBER(15,3) → numeric(13,3)
SELECT apollo_alterar_tipo('inventario_rotativo', 'qtd_coletada', 'numeric(15,3)');  -- número NUMBER(15,3) → numeric(13,3)
SELECT apollo_alterar_tipo('lote_contabil', 'desclote', 'varchar(200)');  -- texto VARCHAR2(200) → character varying(120)
SELECT apollo_alterar_tipo('motivos_operacao', 'descricao', 'varchar(100)');  -- texto VARCHAR2(100) → character varying(60)
SELECT apollo_alterar_tipo('multi_preco', 'fcp_saida', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('multi_preco', 'markup', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('multi_preco', 'icme', 'numeric(15,4)');  -- número NUMBER(15,4) → numeric(13,4)
SELECT apollo_alterar_tipo('multi_preco', 'frete', 'numeric(15,4)');  -- número NUMBER(15,4) → numeric(13,4)
SELECT apollo_alterar_tipo('multi_preco', 'seguro', 'numeric(15,4)');  -- número NUMBER(15,4) → numeric(13,4)
SELECT apollo_alterar_tipo('multi_preco', 'ipi', 'numeric(15,4)');  -- número NUMBER(15,4) → numeric(13,4)
SELECT apollo_alterar_tipo('multi_preco', 'frete2', 'numeric(15,4)');  -- número NUMBER(15,4) → numeric(13,4)
SELECT apollo_alterar_tipo('multi_preco', 'margeml', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('multi_preco', 'margeml2', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('multi_preco', 'lucrobrutop', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('multi_preco', 'lucroliqp', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('multi_preco', 'bonificacao', 'numeric(18,6)');  -- número NUMBER(18,6) → numeric(15,4)
SELECT apollo_alterar_tipo('nf', 'status_pedcomp', 'varchar(100)');  -- texto VARCHAR2(100) → character varying(50)
SELECT apollo_alterar_tipo('nf', 'status_qtd_pedcomp', 'varchar(20)');  -- texto VARCHAR2(20) → character varying(10)
SELECT apollo_alterar_tipo('nf', 'perc_aliquota_ret_issqn', 'numeric(15,4)');  -- número NUMBER(15,4) → numeric(13,2)
SELECT apollo_alterar_tipo('nf', 'qtdetransp', 'numeric(14,3)');  -- número NUMBER(13,2) → numeric(13,3)
SELECT apollo_alterar_tipo('nf', 'especie', 'varchar(60)');  -- texto VARCHAR2(60) → character varying(30)
SELECT apollo_alterar_tipo('nf', 'marca', 'varchar(300)');  -- texto VARCHAR2(300) → character varying(30)
SELECT apollo_alterar_tipo('nf', 'pesobruto', 'numeric(14,3)');  -- número NUMBER(13,2) → numeric(13,3)
SELECT apollo_alterar_tipo('nf', 'pesoliquido', 'numeric(14,3)');  -- número NUMBER(13,2) → numeric(13,3)
SELECT apollo_alterar_tipo('nf', 'chavenfe', 'varchar(50)');  -- texto VARCHAR2(50) → character varying(44)
SELECT apollo_alterar_tipo('nf', 'protocolo_nfe', 'varchar(200)');  -- texto VARCHAR2(200) → character varying(20)
SELECT apollo_alterar_tipo('nf_prod', 'aliqpise', 'numeric(17,4)');  -- número NUMBER(15,2) → numeric(13,4)
SELECT apollo_alterar_tipo('nf_prod', 'aliqpiss', 'numeric(17,4)');  -- número NUMBER(15,2) → numeric(13,4)
SELECT apollo_alterar_tipo('nf_prod', 'aliqcofinse', 'numeric(17,4)');  -- número NUMBER(15,2) → numeric(13,4)
SELECT apollo_alterar_tipo('nf_prod', 'aliqcofinss', 'numeric(17,4)');  -- número NUMBER(15,2) → numeric(13,4)
SELECT apollo_alterar_tipo('nf_prod', 'bonificacao', 'numeric(18,6)');  -- número NUMBER(18,6) → numeric(17,6)
SELECT apollo_alterar_tipo('nf_prod', 'vrdescprod', 'numeric(15,4)');  -- número NUMBER(13,4) → numeric(13,2)
SELECT apollo_alterar_tipo('nf_prod', 'fcp_aliquota_st', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(9,4)
SELECT apollo_alterar_tipo('nf_prod', 'fcp_aliquota_st_ret', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(9,4)
SELECT apollo_alterar_tipo('nf_prod', 'icme', 'numeric(15,4)');  -- número NUMBER(13,4) → numeric(13,2)
SELECT apollo_alterar_tipo('nf_prod', 'depsacess', 'numeric(15,4)');  -- número NUMBER(13,4) → numeric(13,2)
SELECT apollo_alterar_tipo('nf_prod', 'aliqcredsn', 'numeric(12,4)');  -- número NUMBER(10,2) → numeric(9,4)
SELECT apollo_alterar_tipo('nf_prod_ibscbs', 'predaliq_ibsuf', 'numeric(13,4)');  -- número NUMBER(13,4) → numeric(7,4)
SELECT apollo_alterar_tipo('nf_prod_ibscbs', 'paliqefet_ibsuf', 'numeric(13,4)');  -- número NUMBER(13,4) → numeric(7,4)
SELECT apollo_alterar_tipo('nf_prod_ibscbs', 'predaliq_ibsmun', 'numeric(13,4)');  -- número NUMBER(13,4) → numeric(7,4)
SELECT apollo_alterar_tipo('nf_prod_ibscbs', 'paliqefet_ibsmun', 'numeric(13,4)');  -- número NUMBER(13,4) → numeric(7,4)
SELECT apollo_alterar_tipo('nf_prod_ibscbs', 'predaliq_cbs', 'numeric(13,4)');  -- número NUMBER(13,4) → numeric(7,4)
SELECT apollo_alterar_tipo('nf_prod_ibscbs', 'paliqefet_cbs', 'numeric(13,4)');  -- número NUMBER(13,4) → numeric(7,4)
SELECT apollo_alterar_tipo('nf_status_processo', 'chavenfe', 'varchar(50)');  -- texto VARCHAR2(50) → character varying(44)
SELECT apollo_alterar_tipo('nf_status_processo', 'processo_desc', 'varchar(160)');  -- texto VARCHAR2(160) → character varying(120)
SELECT apollo_alterar_tipo('nfe_evento', 'chavenfe', 'varchar(50)');  -- texto VARCHAR2(50) → character varying(44)
SELECT apollo_alterar_tipo('nfe_evento', 'protocolo_autorizacao', 'varchar(100)');  -- texto VARCHAR2(100) → character varying(20)
SELECT apollo_alterar_tipo('nfe_nao_cadastradas', 'status_pedcomp', 'varchar(100)');  -- texto VARCHAR2(100) → character varying(50)
SELECT apollo_alterar_tipo('nfe_nao_cadastradas', 'status_qtd_pedcomp', 'varchar(20)');  -- texto VARCHAR2(20) → character varying(10)
SELECT apollo_alterar_tipo('nfe_nao_cadastradas_itens', 'ncm', 'varchar(30)');  -- texto VARCHAR2(30) → character varying(10)
SELECT apollo_alterar_tipo('nfe_nao_cadastradas_itens', 'vrunitario_trib', 'numeric(17,6)');  -- número NUMBER(13,2) → numeric(15,6)
SELECT apollo_alterar_tipo('nfe_xml', 'chavenfe', 'varchar(50)');  -- texto VARCHAR2(50) → character varying(44)
SELECT apollo_alterar_tipo('operadoras', 'txadm', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('operadoras', 'txadmparc', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('operadoras_taxa', 'txadm', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('parceiros', 'email', 'varchar(250)');  -- texto VARCHAR2(250) → character varying(100)
SELECT apollo_alterar_tipo('parceiros', 'descpadrao', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('parceiros', 'txjuro', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('parceiros', 'cargo', 'varchar(70)');  -- texto VARCHAR2(70) → character varying(60)
SELECT apollo_alterar_tipo('parceiros_rel', 'endereco', 'varchar(200)');  -- texto VARCHAR2(200) → character varying(150)
SELECT apollo_alterar_tipo('pc_config', 'cfop', 'varchar(200)');  -- texto VARCHAR2(200) → character varying(4)
SELECT apollo_alterar_tipo('pc_tipocredito', 'descricao', 'varchar(200)');  -- texto VARCHAR2(200) → character varying(120)
SELECT apollo_alterar_tipo('pedido_devolucao_compra_i', 'icms_st_aliquota', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(9,4)
SELECT apollo_alterar_tipo('pedido_devolucao_compra_i', 'fcp_aliquota_st', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(9,4)
SELECT apollo_alterar_tipo('pedido_devolucao_compra_i', 'fcp_aliquota_st_ret', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(9,4)
SELECT apollo_alterar_tipo('pedido_devolucao_compra_i', 'fcp_aliquota_st_nota', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(9,4)
SELECT apollo_alterar_tipo('pedido_devolucao_compra_i', 'fcp_aliquota_st_ret_nota', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(9,4)
SELECT apollo_alterar_tipo('pedido_devolucao_compra_i', 'aliqpise', 'numeric(12,4)');  -- número NUMBER(10,2) → numeric(9,4)
SELECT apollo_alterar_tipo('pedido_devolucao_compra_i', 'aliqcofinse', 'numeric(12,4)');  -- número NUMBER(10,2) → numeric(9,4)
SELECT apollo_alterar_tipo('pedido_devolucao_compra_i', 'qtd_nota_fiscal', 'numeric(14,4)');  -- número NUMBER(13,4) → numeric(13,3)
SELECT apollo_alterar_tipo('pedido_devolucao_compra_i', 'icms_aliquota', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(9,4)
SELECT apollo_alterar_tipo('pedidocompra_i', 'desconto', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(12,4)
SELECT apollo_alterar_tipo('pedidocompra_i', 'descontop', 'numeric(13,2)');  -- número NUMBER(13,2) → numeric(6,2)
SELECT apollo_alterar_tipo('pedidos', 'comissao', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('pedidos', 'cliente', 'varchar(200)');  -- texto VARCHAR2(200) → character varying(120)
SELECT apollo_alterar_tipo('pedidos', 'obs_entrega', 'varchar(600)');  -- texto VARCHAR2(600) → character varying(255)
SELECT apollo_alterar_tipo('pedidos', 'desc_promo_acumulativa', 'numeric(16,3)');  -- número NUMBER(13,3) → numeric(15,2)
SELECT apollo_alterar_tipo('perfil', 'tipo', 'varchar(50)');  -- texto VARCHAR2(50) → character varying(20)
SELECT apollo_alterar_tipo('produtos', 'ncmsh', 'varchar(15)');  -- texto VARCHAR2(15) → character varying(10)
SELECT apollo_alterar_tipo('produtos', 'mva', 'numeric(15,4)');  -- número NUMBER(15,4) → numeric(13,2)
SELECT apollo_alterar_tipo('produtos', 'receita', 'varchar(1400)');  -- texto VARCHAR2(1400) → character(1)
SELECT apollo_alterar_tipo('produtos', 'cest', 'varchar(20)');  -- texto VARCHAR2(20) → character varying(10)
SELECT apollo_alterar_tipo('produtos', 'descricao', 'varchar(255)');  -- texto VARCHAR2(255) → character varying(150)
SELECT apollo_alterar_tipo('produtos', 'descricao_web', 'varchar(255)');  -- texto VARCHAR2(255) → character varying(200)
SELECT apollo_alterar_tipo('reducaoz', 'nroserie', 'varchar(50)');  -- texto VARCHAR2(50) → character varying(30)
SELECT apollo_alterar_tipo('relatorios', 'tipo', 'varchar(100)');  -- texto VARCHAR2(100) → character varying(20)
SELECT apollo_alterar_tipo('relatorios', 'md5_arquivo', 'varchar(100)');  -- texto VARCHAR2(100) → character varying(40)
SELECT apollo_alterar_tipo('relatorios', 'indr', 'varchar(20)');  -- texto VARCHAR2(20) → character(1)
SELECT apollo_alterar_tipo('relatorios_customizados', 'tipo', 'varchar(100)');  -- texto VARCHAR2(100) → character varying(20)
SELECT apollo_alterar_tipo('relatorios_customizados', 'md5_arquivo', 'varchar(100)');  -- texto VARCHAR2(100) → character varying(40)
SELECT apollo_alterar_tipo('relatorios_customizados', 'indr', 'varchar(20)');  -- texto VARCHAR2(20) → character(1)
SELECT apollo_alterar_tipo('situacao_nf', 'tipo_operacao', 'varchar(5)');  -- texto VARCHAR2(5) → character varying(4)
SELECT apollo_alterar_tipo('situacao_nf', 'descricao', 'varchar(100)');  -- texto VARCHAR2(100) → character varying(80)
SELECT apollo_alterar_tipo('vendas', 'razao', 'varchar(150)');  -- texto VARCHAR2(150) → character varying(80)
SELECT apollo_alterar_tipo('vendas', 'cest', 'varchar(20)');  -- texto VARCHAR2(20) → character varying(10)
SELECT apollo_alterar_tipo('vendas', 'pis_aliquota', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('vendas', 'cofins_aliquota', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
SELECT apollo_alterar_tipo('vendas', 'icms_aliquota', 'numeric(15,4)');  -- número NUMBER(13,2) → numeric(13,4)
