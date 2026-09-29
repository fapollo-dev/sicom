-- 390 — mais seis fontes do construtor na versão INTEGRAL do legado (o mecanismo da mig 389: `rel_<fonte>` ao lado da view da
-- tela, sem COMMENT, lida pelo construtor e pelo importador quando existe).
--
-- GET_PRODUTOS (95 colunas), GET_CARTAO (42), GET_PARCEIROS (61), GET_PEDIDOCOMPRA (24) e GET_SCRAP (16) servem também a uma tela
-- → `rel_`. GET_ESTOQUE (10) só o construtor usa → substituída no lugar, como as da mig 388. Colunas na ordem e com a semântica de
-- ALL_VIEWS/ALL_TAB_COLUMNS da produção (só leitura, 29/09/2026); no fim, com o mesmo nome, as da view da tela que o legado não
-- tem. Mais a GET_PEDIDO_NF (as notas de cada pedido, uma linha por pedido × loja), que a GET_PEDIDOCOMPRA usa — também sem
-- COMMENT, como no legado.
--
-- O que é do legado e fica (é o que os relatórios dele mostram):
--   · GET_PRODUTOS: uma linha por PREÇO DA LOJA (MULTI_PRECO — 203.835 na produção), não por produto; ATIVO/ATIVO_COMPRA da
--     MULTI_PRECO quando ATIVO_PELA_MULTIPRECO vale 'S' (o valor específico, qualquer que seja o escopo, manda sobre o geral — é o
--     COALESCE(CE.VALOR, C.VALOR) da view), senão do produto; MARGEM_CALCULADA = (1 − custo de reposição ÷ venda) × 100;
--     EST_ATUAL_X_MINIMO/MAXIMO comparam o saldo com o mínimo (MENOR/MAIOR/IGUAL). Uma proteção a mais: VLR_APRESENTACAO com
--     CONTEUDO_EMBALAGEM zero sai nula (no Oracle derrubaria a view inteira; na produção não há nenhum zero).
--   · GET_CARTAO: sem as vendas LIBERADAS; a operadora efetiva é a BASE quando houver; taxa e dias da taxa da loja
--     (OPERADORAS_TAXA) quando > 0, senão os da operadora; a previsão pula o domingo (+1) e o sábado (+2); TIPO e CARTAO_TIPO da
--     operadora efetiva, TIPOCARTAO (a última) da operadora da venda. A coluna 41 chama-se literalmente "TXEFETIVA TX_ADM_ARQUIVO"
--     (a lista de colunas da view juntou o nome e o alias) e fica com esse nome.
--   · GET_PARCEIROS: uma linha por ENDEREÇO (19.139 na produção para 19.077 parceiros); ESTADO_CIVIL só 'S' é SOLTEIRO — o resto,
--     nulo incluso, sai CASADO; DATA_ANIVERSARIO no ano corrente (29/02 sai nula); a cidade sem IDCIDADE casa pelo NOME;
--     COD_PART_SPED = o CODEND; CONVENIO e DESCONVENIO são a mesma razão do convênio.
--   · GET_PEDIDOCOMPRA: só pedido ativo, uma linha por pedido × loja × endereço do fornecedor × fechamento; TOTAL_PEDIDO = soma do
--     custo das quantidades da loja.
--   · GET_SCRAP: VALOR = Σ qtde × custo dos itens; a NF é a maior do PEDIDO_NF de saída do SCRAP; ORIGEM_ESTOQUE do primeiro item.

-- ─────────────────────────────────────── GET_PEDIDO_NF (auxiliar da GET_PEDIDOCOMPRA) ──────────────────────────────────────
DROP VIEW IF EXISTS get_pedido_nf;
CREATE VIEW get_pedido_nf AS
SELECT cur.codpedcomp, cur.idempresa, string_agg(cur.nronf, ', ' ORDER BY cur.nronf) AS notas
  FROM (SELECT pn.codpedido AS codpedcomp, n.idempresa, n.nronf
          FROM pedido_nf pn JOIN nf n ON n.codnf = pn.codnf
         WHERE pn.tipo = 'P'
        UNION
        SELECT n.codpedcomp, n.idempresa, n.nronf FROM nf n WHERE n.codpedcomp IS NOT NULL) cur
 GROUP BY cur.codpedcomp, cur.idempresa;

-- ──────────────────────────────────────────────── GET_PRODUTOS (PRODUTOS) ──────────────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_produtos;
CREATE VIEW rel_get_produtos AS
WITH valor_config AS (
  SELECT c.codigo, coalesce(ce.valor, c.valor) AS valor
    FROM configuracoes c LEFT JOIN configuracoes_especificas ce ON ce.id = c.id
   WHERE c.codigo = 'ATIVO_PELA_MULTIPRECO'
)
SELECT pro.codbarra,
       pro.descricao,
       p.vrcusto,
       p.vrcustorep                                                         AS custo_reposicao,
       p.vrvenda,
       CASE WHEN vc.valor = 'S' THEN coalesce(p.ativo, 'S') ELSE coalesce(pro.ativo, 'S') END AS ativo,
       CASE WHEN vc.valor = 'S' THEN coalesce(p.ativo_compra, 'S') ELSE coalesce(pro.ativo_compra, 'S') END AS ativo_compra,
       p.atacarejo_ativo                                                    AS atacarejo,
       pro.comissao,
       f.razao                                                              AS fornecedor,
       pro.coddpto,
       d.descricao                                                          AS departamento,
       g.descricao                                                          AS grupo,
       sg.descricao                                                         AS subgrupo,
       pro.codsecao,
       sc.descricao                                                         AS secao,
       pro.unidade,
       p.markup,
       pro.codfor,
       pro.aliquota,
       pro.balanca,
       p.promocao,
       p.vrpromo,
       p.vrclube_fidelidade                                                 AS vrclubefidelidade,
       pro.pis,
       pro.tipopis,
       pro.fatorkg,
       pro.fatorcx,
       pro.codbalanca,
       pro.descmax,
       pro.especificacao,
       pro.composicao,
       pro.idproduto                                                        AS codigo,
       pro.codgrupo                                                         AS cod_grupo,
       pro.codsubgrupo                                                      AS cod_subgrupo,
       pro.cest,
       pro.dtultimalteracao::date                                           AS data_alteracao,
       p.vrcustoreal                                                        AS custo_total,
       p.dtultprecoalterado::date                                           AS data_alteracao_preco,
       pro.ncmsh                                                            AS ncm,
       substr(pro.descricao, 1, 1)                                          AS comeco_descricao,
       p.idempresa,
       pro.dtcadastro::date                                                 AS data_cadastro,
       (CASE WHEN coalesce(p.vrcustorep, 0) > 0 AND coalesce(p.vrvenda, 0) > 0
             THEN (((coalesce(p.vrcustorep, 0) / coalesce(p.vrvenda, 0)) - 1) * 100 * -1)::numeric(13,2)
             ELSE 0 END)::numeric(13,2)                                     AS margem_calculada,
       gp.descricao                                                         AS grupo_preco,
       pro.idpiscofins,
       i.descricao                                                          AS despis,
       coalesce(pro.imprimircomp, 'N')                                      AS imprimircomp,
       pro.codgrupopreco                                                    AS cod_grupopreco,
       pro.atacado,
       p.vrdescpreco2                                                       AS vrdescpreco2_mp,
       pro.vrdescpreco2                                                     AS vrdescpreco2_pro,
       pro.tpdescpreco2,
       coalesce(e.qtde, 0)                                                  AS qtde_estoque,
       coalesce(ed.qtde, 0)                                                 AS qtde_deposito,
       coalesce(e.qtde, 0) + coalesce(ed.qtde, 0)                           AS qtde_total,
       pro.idproduto_pai                                                    AS produto_pai,
       pro.descricao_resumida,
       pro.descricao_web,
       pro.descricao_balanca,
       pro.quantidade,
       pro.altera_descricao_cotacao,
       CASE WHEN pro.percentual_perdas = 100 THEN 'S' ELSE 'N' END          AS perda,
       ma.idmarca,
       ma.descricao                                                         AS marca,
       coalesce(p.etq_impressa, 'N')                                        AS etq_impressa,
       coalesce(pro.vasilhame, 'N')                                         AS vasilhame,
       ff.codfigurafiscal                                                   AS cod_figura_fiscal,
       ff.descfigurafiscal                                                  AS figura_fiscal,
       CASE WHEN EXISTS (SELECT 1 FROM receita_prod rp WHERE rp.idproduto = p.idproduto) THEN 'S' ELSE 'N' END AS possui_receita,
       pro.fator_filho,
       pro.prod_qtde_etiquetas                                              AS qtde_etiquetas,
       p.vrpromo                                                            AS vlrpromocao,
       coalesce(pro.realizatroca, 'S')                                      AS realiza_troca,
       coalesce(pro.cotacao, 'N')                                           AS cotacao,
       e.minimo                                                             AS est_minimo,
       e.maximo                                                             AS est_maximo,
       CASE WHEN e.qtde < e.minimo THEN 'MENOR' WHEN e.qtde > e.minimo THEN 'MAIOR' WHEN e.qtde = e.minimo THEN 'IGUAL' END AS est_atual_x_minimo,
       CASE WHEN e.qtde < e.maximo THEN 'MENOR' WHEN e.qtde > e.maximo THEN 'MAIOR' WHEN e.qtde = e.maximo THEN 'IGUAL' END AS est_atual_x_maximo,
       pro.unidade_apresentacao,
       coalesce(pro.conteudo_embalagem, 1)                                  AS conteudo_embalagem,
       coalesce(pro.apresentacao_etiqueta, 1)                               AS apresentacao_etiqueta,
       (coalesce(pro.apresentacao_etiqueta, 1) * coalesce(p.vrvenda, 1)) / nullif(coalesce(pro.conteudo_embalagem, 1), 0) AS vlr_apresentacao,
       pro.codoperador,
       pro.tipo_produto,
       p.abc,
       p.perc_abc,
       p.data_abc,
       e.dtvenda::date                                                      AS ultima_venda,
       pro.idctc                                                            AS codctc,
       ct.descricao                                                         AS descricaoctc,
       pro.produto_notavel,
       pro.produto_ancora,
       pro.vrdescpreco2                                                     AS preco2,
       p.pmz,
       -- as da view da tela (get_produtos) que o legado não tem
       pro.idproduto,
       pro.ncmsh
  FROM multi_preco p
  LEFT JOIN produtos pro      ON pro.idproduto = p.idproduto
  LEFT JOIN familias_prod d   ON d.codfamilia = pro.coddpto
  LEFT JOIN familias_prod g   ON g.codfamilia = pro.codgrupo
  LEFT JOIN familias_prod sg  ON sg.codfamilia = pro.codsubgrupo
  LEFT JOIN familias_prod gp  ON gp.codfamilia = pro.codgrupopreco
  LEFT JOIN familias_prod sc  ON sc.codfamilia = pro.codsecao
  LEFT JOIN familias_prod ct  ON ct.codfamilia = pro.idctc
  LEFT JOIN parceiros f       ON f.codparceiro = pro.codfor
  LEFT JOIN piscofins i       ON i.idpiscofins = pro.idpiscofins
  LEFT JOIN estoque e         ON e.idproduto = pro.idproduto AND e.idempresa = p.idempresa
  LEFT JOIN estoque_dep ed    ON ed.idproduto = pro.idproduto AND ed.idempresa = p.idempresa
  LEFT JOIN marcas ma         ON ma.idmarca = pro.idmarca
  LEFT JOIN valor_config vc   ON vc.codigo = 'ATIVO_PELA_MULTIPRECO'
  LEFT JOIN figura_fiscal ff  ON ff.codfigurafiscal = pro.codfigurafiscal;

-- ───────────────────────────────────────────────── GET_CARTAO (CARTAO) ─────────────────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_cartao;
CREATE VIEW rel_get_cartao AS
SELECT ot.operadora,
       c.valor,
       coalesce(c.valorliq, (c.valor + coalesce(c.valor_ajuste_baixa, 0)) - (c.valor * tx.txadm / 100))::numeric(15,2) AS valor_com_taxa,
       c.dtvenda::date                                                      AS data,
       c.dtvenda                                                            AS data_hora,
       CASE extract(dow FROM tx.base) WHEN 0 THEN tx.base + 1 WHEN 6 THEN tx.base + 2 ELSE tx.base END AS previsao_compensacao,
       c.idempresa                                                          AS codigo_empresa,
       coalesce(p.codparceiro, 0)::numeric(10)                              AS codadm,
       CASE WHEN coalesce(ot.codadm, 0) = 0 OR (coalesce(ot.codadm, 0) > 0 AND coalesce(p.codparceiro, 0) = 0)
            THEN 'ADMINISTRADORA NAO ENCONTRADA' ELSE p.razao END           AS administradora,
       c.nrocupom,
       c.nropedido,
       c.nroparcela                                                         AS parcela,
       coalesce(c.qtde_parcelas, 1)                                         AS parcelas,
       CASE WHEN coalesce(c.valor_operacao, 0) <> 0 THEN c.valor_operacao ELSE c.valor END AS valor_operacao,
       ot.codoperadoras                                                     AS codigo_operadora,
       c.codvendcartao                                                      AS codigo,
       c.idpgto,
       c.codpdv,
       c.codoperador,
       c.resumo,
       c.datavencimento::date                                               AS data_venc_resumo,
       c.consiliado,
       CASE WHEN ot.tipo = 'C' THEN 'CREDITO' WHEN ot.tipo = 'D' THEN 'DEBITO' ELSE 'ALIMENTACAO' END AS tipo,
       CASE ot.tipocartao WHEN 0 THEN 'CHEQUE' WHEN 1 THEN 'CARTAO DE DEBITO' WHEN 2 THEN 'CARTAO DE CREDITO'
            WHEN 3 THEN 'CARTAO TIPO VOUCHER' WHEN 5 THEN 'CARTAO FIDELIDADE' WHEN 98 THEN 'DINHEIRO'
            ELSE 'OUTROS TIPO DE CARTAO' END                                AS cartao_tipo,
       CASE c.tipomodalidade WHEN 0 THEN 'AVISTA' WHEN 1 THEN 'PRE-DATADO' WHEN 2 THEN 'PARCELADO PELO ESTABELECIMENTO'
            WHEN 3 THEN 'PARCELADO PELA ADMINISTRADORA' ELSE 'OUTRO TIPO DE PAGAMENTO' END AS tipomodalidade,
       c.nsuhost,
       op.nome                                                              AS nomeoperador,
       op_alt.nome                                                          AS nomeoperadoralteracao,
       ot.codoperadorabase,
       ot.codrede,
       ot.codbandeira,
       tx.txadm,
       tx.dias::numeric(10)                                                 AS diascomp,
       c.valor_ajuste_baixa,
       c.obs,
       c.dtcadastro                                                         AS data_cadastro,
       c.idlote,
       c.autorizacao,
       c.txefetiva                                                          AS "txefetiva tx_adm_arquivo",
       c.valorliq                                                           AS valorliq_arquivo,
       c.data_baixa_arquivo,
       CASE WHEN o.tipo = 'C' THEN 'CREDITO' WHEN o.tipo = 'D' THEN 'DEBITO' WHEN o.tipo = 'A' THEN 'ALIMENTACAO'
            WHEN o.tipo = 'I' THEN 'PIX' ELSE 'OUTROS' END                  AS tipocartao,
       -- as da view da tela (get_cartao) que o legado não tem
       c.codvendcartao, c.idempresa, c.dtvenda, c.nroparcela, c.qtde_parcelas, c.codoperadora, c.nsu, c.txefetiva, c.valorliq,
       c.liberado, c.dtbaixa, tx.txadm                                      AS txadm_efetiva
  FROM cartao c
  LEFT JOIN operadoras o        ON o.codoperadoras = c.codoperadora
  LEFT JOIN operadoras ot       ON ot.codoperadoras = CASE WHEN coalesce(o.codoperadorabase, 0) > 0 THEN o.codoperadorabase ELSE o.codoperadoras END
  LEFT JOIN operadoras_taxa otx ON otx.codoperadoras = ot.codoperadoras AND otx.idempresa = c.idempresa
  LEFT JOIN parceiros p         ON p.codparceiro = ot.codadm
  LEFT JOIN operadores op       ON op.codoperador = c.codoperador
  LEFT JOIN operadores op_alt   ON op_alt.codoperador = c.usultalteracao
  CROSS JOIN LATERAL (
    SELECT CASE WHEN coalesce(otx.txadm, 0) > 0 THEN coalesce(otx.txadm, 0) ELSE coalesce(ot.txadm, 0) END AS txadm,
           CASE WHEN coalesce(otx.diafechamento, 0) > 0 THEN coalesce(otx.diafechamento, 0) ELSE coalesce(ot.diascomp, 0) END AS dias,
           c.dtvenda::date + (CASE WHEN coalesce(otx.diafechamento, 0) > 0 THEN coalesce(otx.diafechamento, 0) ELSE coalesce(ot.diascomp, 0) END
                              * coalesce(c.nroparcela, 1)) AS base
  ) tx
 WHERE coalesce(c.liberado, 'N') = 'N';

-- ─────────────────────────────────────────────── GET_PARCEIROS (PARCEIROS) ─────────────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_parceiros;
CREATE VIEW rel_get_parceiros AS
SELECT p.razao,
       p.codparceiro                                                        AS codigo,
       p.fantasia,
       CASE WHEN p.tipofj = 'F' THEN 'FISICA' WHEN p.tipofj = 'R' THEN 'RURAL' WHEN p.tipofj = 'G' THEN 'GOVERNAMENTAL'
            WHEN p.tipofj = 'J' THEN 'JURIDICA' WHEN p.tipofj = 'E' THEN 'ENTIDADE' END AS tipo_pessoa,
       p.dtcadastro::date                                                   AS data_cadastro,
       p.dtnascimento                                                       AS data_nascimento,
       CASE WHEN p.dtnascimento IS NULL THEN NULL
            WHEN extract(day FROM p.dtnascimento) > 28 AND extract(month FROM p.dtnascimento) = 2 THEN NULL
            ELSE make_date(extract(year FROM current_date)::int, extract(month FROM p.dtnascimento)::int, extract(day FROM p.dtnascimento)::int)
       END                                                                  AS data_aniversario,
       p.email,
       p.credito,
       p.obs,
       p.bloqued                                                            AS bloqueado,
       p.comissao,
       p.venc_prev                                                          AS previsao_vencimento,
       p.descpadrao                                                         AS desconto_padrao,
       p.descpadraoboleto                                                   AS desconto_padraoboleto,
       p.tolerancia,
       p.txjuro,
       p.codref                                                             AS cod_referencia,
       p.dtultcompra                                                        AS data_ultima_compra,
       p.idempresa,
       p.printecf                                                           AS imprimir_ecf,
       p.ultima_alter                                                       AS ultima_alteracao,
       p.diasprazo                                                          AS dias_prazo,
       CASE p.estado_civil WHEN 'S' THEN 'SOLTEIRO' ELSE 'CASADO' END       AS estado_civil,
       p.cargo,
       p.codconvenio                                                        AS cod_convenio,
       g.razao                                                              AS convenio,
       p.cli, p.frn, p.fun, p.tra, p.con,
       p.ativado,
       q.endereco,
       q.bairro,
       q.cidade,
       q.uf,
       q.cep,
       p.codconpagto                                                        AS condicao_pagto,
       q.cnpj_cpf,
       replace(replace(replace(q.cnpj_cpf, '.', ''), '-', ''), '/', '')     AS cnpj_cpf_sem_mascara,
       q.rg_insc,
       q.celular,
       p.fixo,
       p.dispensado_pedido_compra,
       p.dispensado_coleta,
       p.vencimentos,
       (CASE WHEN c.idcidade IS NOT NULL THEN c.idcidade ELSE d.idcidade END)::varchar(20) AS codigo_ibge,
       p.contribuinte_icms,
       p.realiza_troca,
       CASE WHEN coalesce(p.habilita_retencao_pis_nf, 'N') = 'S' OR coalesce(p.habilita_retencao_cofins_nf, 'N') = 'S'
              OR coalesce(p.habilita_retencao_csll_nf, 'N') = 'S' OR coalesce(p.habilita_retencao_ir_nf, 'N') = 'S'
              OR coalesce(p.habilita_retencao_inss_nf, 'N') = 'S' OR coalesce(p.habilita_retencao_issqn_nf, 'N') = 'S'
              OR coalesce(p.habilita_retencao_funrural_nf, 'N') = 'S' THEN 'S' ELSE 'N' END AS realiza_retencoes,
       q.ativado                                                            AS endereco_ativo,
       q.codend                                                             AS cod_part_sped,
       p.classfiscal,
       p.codperfil_parceiro,
       pf.perfil,
       g.razao                                                              AS desconvenio,
       p.classificacao,
       p.idgrupoemp                                                         AS grupoempresarial,
       coalesce(p.participa_cotacao, 'N')                                   AS participa_cotacao,
       p.email_vendedor_representante,
       -- as da view da tela (get_parceiros) que o legado não tem
       p.codparceiro, p.tipofj, p.bloqued
  FROM parceiros p
  LEFT JOIN parceiros_end q ON q.codparceiro = p.codparceiro
  LEFT JOIN parceiros g     ON g.codparceiro = p.codconvenio
  LEFT JOIN cidades c       ON c.idcidade = q.idcidade
  LEFT JOIN cidades d       ON d.cidade = q.cidade AND q.idcidade IS NULL
  LEFT JOIN perfil pf       ON pf.codperfil = p.codperfil_parceiro;

-- ──────────────────────────────────────────────── GET_ESTOQUE (ESTOQUE) ────────────────────────────────────────────────────
DROP VIEW IF EXISTS get_estoque;
CREATE VIEW get_estoque AS
WITH valor_config AS (
  SELECT c.codigo, coalesce(ce.valor, c.valor) AS valor
    FROM configuracoes c LEFT JOIN configuracoes_especificas ce ON ce.id = c.id
   WHERE c.codigo = 'ATIVO_PELA_MULTIPRECO'
)
SELECT e.idproduto,
       p.descricao,
       e.idempresa,
       m.vrvenda,
       e.qtde,
       m.vrcusto,
       p.servico,
       p.unidade,
       p.codbarra,
       CASE WHEN vc.valor = 'S' THEN coalesce(m.ativo, 'S') ELSE coalesce(p.ativo, 'S') END AS ativo,
       -- as que o Apollo já expunha (mig 022)
       e.id_estoque, e.minimo, e.maximo, e.local
  FROM estoque e
  LEFT JOIN produtos p      ON p.idproduto = e.idproduto
  JOIN multi_preco m        ON m.idproduto = e.idproduto AND m.idempresa = e.idempresa
  LEFT JOIN valor_config vc ON vc.codigo = 'ATIVO_PELA_MULTIPRECO';
COMMENT ON VIEW get_estoque IS 'ESTOQUE';

-- ─────────────────────────────────────────── GET_PEDIDOCOMPRA (PEDIDO DE COMPRA) ───────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_pedidocompra;
CREATE VIEW rel_get_pedidocompra AS
SELECT l.*,
       -- as da view da tela (get_pedidocompra) que o legado não tem
       g.codpedcomp, g.codparceiro, g.fornecedor, g.codoperador, g.codconpagto, g.pc_tipo_frete, g.pc_valor_frete,
       g.pc_nronf_cruzamento, g.idsituacao_nf, g.dtfaturamento, g.dtencerramento, g.indr, g.total, g.qtde_itens, g.empresas
  FROM (
    SELECT p.codpedcomp                                                     AS nropedido,
           p.data::date                                                     AS data,
           a.razao                                                          AS parceiro,
           coalesce(pq.fechado, 'N')                                        AS fechado,
           pce.codempresa                                                   AS idempresa,
           p.dt_vencimento::date                                            AS dt_vencimento,
           o.nome                                                           AS operador,
           p.codoperador                                                    AS codigo_operador,
           c.descricao                                                      AS condicao_pagto,
           p.codparceiro                                                    AS codigo_parceiro,
           p.codpedcomp                                                     AS codigo,
           pe.codend                                                        AS codparceiro_end,
           pe.uf                                                            AS uf_fornecedor,
           p.bonificacao,
           p.importado,
           sum(pq.totalcusto)                                               AS total_pedido,
           a.ativado                                                        AS fornecedor_ativo,
           op.nome                                                          AS operador_fechamento,
           pq.data_fechamento,
           pnf.notas,
           p.compra_1_para_n_lojas,
           p.obs,
           p.pc_tipo_frete                                                  AS tipo_frete,
           p.pc_valor_frete                                                 AS valor_frete
      FROM pedidocompra p
      JOIN pedido_compra_empresa pce ON pce.codpedcomp = p.codpedcomp AND coalesce(p.indr, 'I') = 'I'
      LEFT JOIN parceiros a          ON a.codparceiro = p.codparceiro
      LEFT JOIN parceiros_end pe     ON pe.codparceiro = p.codparceiro
      LEFT JOIN operadores o         ON o.codoperador = p.codoperador
      LEFT JOIN condicoes_pagto c    ON c.codconpagto = p.codconpagto
      LEFT JOIN (SELECT pdq.idempresa, pdq.totalcusto, coalesce(pdq.fechado, 'N') AS fechado, i.codpedcomp, pdq.codoperador, pdq.data_fechamento
                   FROM pedido_compra_qtde pdq JOIN pedidocompra_i i ON i.codpedcompi = pdq.codpedcompi) pq
                                     ON pq.codpedcomp = p.codpedcomp AND pq.idempresa = pce.codempresa
      LEFT JOIN operadores op        ON op.codoperador = pq.codoperador
      LEFT JOIN get_pedido_nf pnf    ON pnf.codpedcomp = p.codpedcomp AND pnf.idempresa = pq.idempresa
     GROUP BY p.codpedcomp, p.data::date, a.razao, coalesce(pq.fechado, 'N'), pce.codempresa, p.dt_vencimento::date, o.nome,
              p.codoperador, c.descricao, p.codparceiro, pe.codend, pe.uf, p.bonificacao, p.importado, a.ativado, op.nome,
              pq.data_fechamento, pnf.notas, p.compra_1_para_n_lojas, p.obs, p.pc_tipo_frete, p.pc_valor_frete
  ) l
  LEFT JOIN get_pedidocompra g ON g.codpedcomp = l.codigo
 ORDER BY l.data, l.parceiro, l.idempresa, l.operador_fechamento;

-- ────────────────────────────────────────────────────── GET_SCRAP (SCRAP) ──────────────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_scrap;
CREATE VIEW rel_get_scrap AS
SELECT a.codscrap                                                           AS codigo,
       a.dt_cadastro,
       a.codparceiro                                                        AS codigo_parceiro,
       a.razao                                                              AS parceiro,
       a.valor,
       a.importado,
       a.codnf::numeric(10)                                                 AS codnf,
       n.nronf,
       a.idempresa,
       a.codplc                                                             AS centro_custo,
       a.desccodplc                                                         AS desc_centro_custo,
       a.descricao,
       a.obs,
       CASE WHEN n.statusnfe = 'P' AND n.tpemissao = 1 THEN 'NFE ENVIADA A RECEITA'
            WHEN n.statusnfe = 'P' AND n.tpemissao IN (6, 7) THEN 'NFE ENVIADA EM CONTINGENCIA'
            WHEN n.statusnfe = 'C' AND n.tpemissao = 1 THEN 'NFE CANCELADA NA RECEITA'
            WHEN n.statusnfe = 'C' AND n.tpemissao IN (6, 7) THEN 'NFE CANCELADA EM CONTINGENCIA'
            WHEN n.statusnfe = 'D' THEN 'NFE DENEGADA NA RECEITA'
            ELSE n.statusnfe::varchar END                                   AS status_nfe,
       a.origem_estoque,
       a.mov_estoque,
       -- as da view da tela (get_scrap) que o legado não tem
       g.codscrap, g.codplc, g.codparceiro, g.idsituacao_nf, g.qtde_itens, g.valor_total, g.plc_descricao
  FROM (SELECT s.codscrap, s.dt_cadastro::date AS dt_cadastro, s.codplc, c.desccodplc, c.descricao, s.obs, s.idempresa,
               p.codparceiro, p.razao, s.importado,
               (SELECT sum(si.qtde * si.vr_custo) FROM scrap_item si WHERE si.codscrap = s.codscrap) AS valor,
               (SELECT max(pn.codnf) FROM pedido_nf pn WHERE pn.tipo = 'S' AND pn.codpedido = s.codscrap) AS codnf,
               (SELECT coalesce(si.origem_estoque, 'E') FROM scrap_item si WHERE si.codscrap = s.codscrap ORDER BY si.codscrapitem LIMIT 1) AS origem_estoque,
               coalesce(s.mov_estoque, 'N') AS mov_estoque
          FROM scrap s
          LEFT JOIN plc c       ON c.codplc = s.codplc
          LEFT JOIN parceiros p ON p.codparceiro = s.codparceiro) a
  LEFT JOIN nf n         ON n.codnf = a.codnf
  LEFT JOIN get_scrap g  ON g.codscrap = a.codscrap;
