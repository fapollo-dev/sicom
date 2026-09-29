-- 395 — o CATÁLOGO do construtor, lote B: 22 fontes da produção que não existiam aqui (retrato de 29/09/2026, conferidas pelo §283).
-- Lista de colunas explícita no CREATE VIEW, como no Oracle.
--
-- O que é do legado e fica (é o que a view de lá devolve):
--   · GET_VENDA_COMPOSICAO só o produto de código de barras '6556' (fixo na view); GET_RELPRODUTOS só a empresa 4 e ativos.
--   · GET_INVENTARIO / GET_ITENS_INVENTARIO: o JOIN do GRUPO compara F.CODFAMILIA (o subgrupo) com o grupo do produto e não restringe
--     G — quando casa, a linha se repete para cada família cadastrada.
--   · GET_CHEQUE_PROPRIO: "vencido" é vencimento antes de AGORA (o cheque que vence hoje já conta).
--   · HISTORICO_DINAMICO.VALOR_CHAVE é texto e casa com IDPRODUTO (número): no Oracle a conversão é implícita; aqui converte-se só o
--     que é número (texto não numérico derrubaria a view lá).
--   · GET_OPERADORES_PERMISSOES: a SENHA existe com o nome e sai nula (como na GET_OPERADORES — mig 393).

CREATE OR REPLACE VIEW get_composicao (codigo_produto_pai, descricao_pai, codigo_composicao, descricao_composicao, qtde, valor, ean_composicao) AS
SELECT c.idproduto, p.descricao, c.idproduto_01, o.descricao, c.qtde, c.valor, o.codbarra
  FROM composicao c
  LEFT JOIN produtos p ON p.idproduto = c.idproduto
  LEFT JOIN produtos o ON o.idproduto = c.idproduto_01
 WHERE p.chavecomposicao = c.chavecomposicao;
COMMENT ON VIEW get_composicao IS 'COMPOSICAO';

CREATE OR REPLACE VIEW get_qualita_vendas_pagamento (nropedido, nro_cupom, data, forma_pagamento, serie, valor_pagamento) AS
SELECT cx.nropedido, cx.coo, cx.data::date, cx.operacao, substr(cx.nropedido, 1, 2), sum(cx.valor - coalesce(cx.troco, 0))
  FROM cx_vendas cx
 WHERE cx.operacao NOT IN ('SUPRIMENTO', 'SANGRIA', 'DESCONTO')
 GROUP BY cx.nropedido, cx.coo, cx.data::date, cx.operacao, substr(cx.nropedido, 1, 2);
COMMENT ON VIEW get_qualita_vendas_pagamento IS 'QUALITA-VENDAS-PAGAMENTO';

CREATE OR REPLACE VIEW get_conf_integ_bancaria (codigo, codempresa, fantasia, codbco, banco, cidade, uf, agencia, nrconta, codfornbco, arqteste,
                                                dias_baixa_boleto, identempresabco) AS
SELECT a.codconf, a.codempresa, e.fantasia, a.codbco, b.banco, b.cidade, b.uf, a.agencia, a.nrconta, a.codfornbco, a.arqteste,
       a.dias_baixa_boleto, a.identempresabco
  FROM conf_integ_bancaria a
  LEFT JOIN empresas e ON e.idempresa = a.codempresa
  LEFT JOIN bancos b   ON b.codbco = a.codbco;
COMMENT ON VIEW get_conf_integ_bancaria IS 'CONF_INTEG_BANCARIA';

-- (a lista de colunas manda: RAZAOSOCIAL recebe a razão do PARCEIRO e RAZAO a da EMPRESA)
CREATE OR REPLACE VIEW get_agenda_prev_pagto (codigo, ativo, codparceiro, razaosocial, valor, dtvigencia, diapagto, razao, codempresa) AS
SELECT a.cod_agenda_prev_pagto, a.ativo, a.codparceiro, p.razao, a.valor, a.dtvigencia, a.diapagto, e.razao_social, a.codempresa
  FROM agenda_prev_pagto a
  LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro
  LEFT JOIN empresas e  ON e.idempresa = a.codempresa
 WHERE coalesce(a.indr, 'I') <> 'E' AND coalesce(a.codpai, 0) = 0;
COMMENT ON VIEW get_agenda_prev_pagto IS 'AGENDA_PREV_PAGTO';

CREATE OR REPLACE VIEW historico_fgf (codhistorico, campo, valor_anterior, valor_atual, tabela, data, codoperador, nomeoperador, codempresa,
                                      idproduto, codbarra) AS
SELECT h.codhistorico, h.campo, h.valor_anterior, h.valor_atual, h.tabela, h.data::date, h.codoperador, o.nome, h.codempresa, h.valor_chave,
       p.codbarra
  FROM historico_dinamico h
  LEFT JOIN operadores o ON o.codoperador = h.codoperador
  LEFT JOIN produtos p   ON p.idproduto = CASE WHEN h.valor_chave ~ '^\s*\d+\s*$' THEN trim(h.valor_chave)::bigint END
 WHERE h.chave = 'IDPRODUTO' AND h.historico LIKE '%FGF%';
COMMENT ON VIEW historico_fgf IS 'HISTORICO_FGF';

CREATE OR REPLACE VIEW get_acordo_comercial (codigo, nome, situacao_nf, centro_custo, centro_custo_reduzido, razao_parceiro) AS
SELECT a.idacordo, a.nome, s.descricao, cc.descricao, cc.desccodplc, p.razao
  FROM acordo_comercial a
  JOIN parceiros p        ON p.codparceiro = a.codparceiro
  LEFT JOIN situacao_nf s ON s.idsituacao_nf = a.cod_sit_doc
  LEFT JOIN plc cc        ON cc.codplc = a.codplc
 WHERE coalesce(a.indr, 'I') <> 'E';
COMMENT ON VIEW get_acordo_comercial IS 'ACORDO COMERCIAL';

CREATE OR REPLACE VIEW get_areceber_bx_recurso (data, valor_pago, conta_corrente) AS
SELECT m.dtemissao::date, sum(m.valor), coalesce(c.titular, 'TESOURARIA')
  FROM mov_contas_bancarias m
  LEFT JOIN contas_bancarias c ON c.codconta = m.codconta
 WHERE m.tipomovimento <> 'D' AND EXISTS (SELECT 1 FROM areceber_bx x WHERE x.idlote = m.idlote)
 GROUP BY m.dtemissao::date, coalesce(c.titular, 'TESOURARIA')
 ORDER BY 3;
COMMENT ON VIEW get_areceber_bx_recurso IS 'ARECEBER_BAIXADOS_RECURSOS';

CREATE OR REPLACE VIEW get_smart_vendas (data, hora, id_loja, caixa, cupom, idproduto, quantidade_vendida, custo_unitario, valor_total,
                                         desconto_cupom, acrescimo_cupom) AS
SELECT dtvenda::date, to_char(dtvenda, 'HH24:MI:SS'), idempresa, substr(nropedido, 1, 2), nrocupom, codproduto, qtde, vrcustorep, qtde * vrvenda,
       desc_acre_item * -1, desc_acre_item * -1
  FROM vendas;
COMMENT ON VIEW get_smart_vendas IS 'SMART VENDAS';

CREATE OR REPLACE VIEW get_n2m_familias_prod (nome, codigo, codigo_subgrupo, tipo, codempresa, codigo_dpto, codigo_grupo, codigo_setor, ativo,
                                              setor_perda_padrao) AS
SELECT descricao, codfamilia, codfamilia,
       CASE WHEN tipo = 'D' THEN 'DEPARTAMENTO' WHEN tipo = 'G' THEN 'GRUPO' WHEN tipo = 'S' THEN 'SUBGRUPO' WHEN tipo = 'P' THEN 'GRUPO DE PRECO'
            WHEN tipo = 'R' THEN 'PRODUCAO' WHEN tipo = 'O' THEN 'SECAO' WHEN tipo = 'E' THEN 'SETOR' END,
       idempresa, coddpto, codgrupo, codsetor, ativo, coalesce(codsetor_perda_padrao, 'N')
  FROM familias_prod;
COMMENT ON VIEW get_n2m_familias_prod IS 'CATEGORIAS E DEPARTAMENTOS';

CREATE OR REPLACE VIEW get_estoque_total (idproduto, idempresa, total) AS
SELECT idproduto, idempresa, sum(qtde) + sum(qtdetroca)
  FROM (SELECT e.idproduto, e.idempresa, e.qtde, coalesce(e.qtdetroca, 0) AS qtdetroca FROM estoque e
        UNION ALL
        SELECT e.idproduto, e.idempresa, e.qtde, coalesce(e.qtdetroca, 0) FROM estoque_dep e
        UNION ALL
        SELECT e.idproduto, e.idempresa, e.qtde_almoxarifado, coalesce(e.qtdetroca_almoxarifado, 0) FROM estoque e) c
 GROUP BY idproduto, idempresa;
COMMENT ON VIEW get_estoque_total IS 'ESTOQUE TOTAL';

CREATE OR REPLACE VIEW get_cheque_proprio (nrocheque, parceiro, codcheque, valor, data_emissao, data_vencimento, codigo_conta, codigo_parceiro,
                                           titular_conta, baixado, data_baixa, idempresa, idlote, historico, chq_vencido) AS
SELECT c.nrocheque, p.razao, c.codchqproprio, c.valor, c.dtemissao::date, c.dtvenc::date, c.codconta, c.codparceiro, b.titular, c.baixado,
       c.dtbaixa::date, c.idempresa, c.idlote, c.historico,
       CASE WHEN coalesce(c.baixado, 'N') = 'N' AND c.dtvenc::date < localtimestamp THEN 'S' ELSE 'N' END
  FROM chq_proprio c
  LEFT JOIN parceiros p         ON p.codparceiro = c.codparceiro
  LEFT JOIN contas_bancarias b  ON b.codconta = c.codconta;
COMMENT ON VIEW get_cheque_proprio IS 'CHEQUES PROPRIOS';

CREATE OR REPLACE VIEW get_venda_composicao (codigo_produto_pai, codigo_barra_pai, descricao_pai, codigo_filho, descricao_filho, qtde_filho,
                                             valor_filho, codbarra_filho, dtvenda, idempresa, qtd_total_vendida) AS
SELECT c.idproduto, p.codbarra, concat(p.codbarra, ' - ', p.descricao, ' - ', v.qtde, ' - ', v.vrvenda * v.qtde), c.idproduto_01,
       o.descricao, c.qtde, c.valor, o.codbarra, v.dtvenda::date, v.idempresa, v.qtde * c.qtde
  FROM composicao c
  LEFT JOIN produtos p ON p.idproduto = c.idproduto
  LEFT JOIN produtos o ON o.idproduto = c.idproduto_01
  LEFT JOIN vendas v   ON v.codproduto = p.idproduto
 WHERE p.codbarra = '6556';
COMMENT ON VIEW get_venda_composicao IS 'VENDA_COMPOSICAO';

CREATE OR REPLACE VIEW get_inventario (codbarra, descricao, codigo, qtde, vrcusto, subgrupo, aliquota, codigo_produto, idempresa, vrvenda,
                                       codgrupo, grupo) AS
SELECT i.codbarra, i.descricao, i.codinvent, i.qtde, i.vrcusto, f.descricao, i.aliquota, i.idproduto, i.idempresa, m.vrvenda, g.codfamilia,
       g.descricao
  FROM inventario i
  LEFT JOIN familias_prod f ON f.codfamilia = i.codsubgrupo
  LEFT JOIN produtos p      ON p.idproduto = i.idproduto
  LEFT JOIN multi_preco m   ON m.idproduto = i.idproduto AND m.idempresa = i.idempresa
  LEFT JOIN familias_prod g ON f.codfamilia = p.codgrupo;
COMMENT ON VIEW get_inventario IS 'INVENTARIO';

CREATE OR REPLACE VIEW get_itens_inventario (codbarra, descricao, codigo, cod_item_invent, qtde, vrcusto, subgrupo, aliquota, codigo_produto,
                                             idempresa, vrvenda, codgrupo, grupo) AS
SELECT i.codbarra, i.descricao, i.idunico, i.codinvent, i.qtde, i.vrcusto, f.descricao, i.aliquota, i.idproduto, i.idempresa, m.vrvenda,
       g.codfamilia, g.descricao
  FROM inventario i
  LEFT JOIN familias_prod f ON f.codfamilia = i.codsubgrupo
  LEFT JOIN produtos p      ON p.idproduto = i.idproduto
  LEFT JOIN multi_preco m   ON m.idproduto = i.idproduto AND m.idempresa = i.idempresa
  LEFT JOIN familias_prod g ON f.codfamilia = p.codgrupo;
COMMENT ON VIEW get_itens_inventario IS 'ITENS INVENTARIO';

CREATE OR REPLACE VIEW get_config_legislacao (codigo, descricao, codcfop, cfop, codempresa, codproduto, produto, uf, observacoes, codparceiro,
                                              parceiro) AS
SELECT l.codconfiglegislacao, l.descricao, l.codcfop, c.descricao, l.codempresa, l.codproduto, p.descricao, l.uf, l.observacoes::varchar(600),
       pr.codparceiro, pr.razao
  FROM config_legislacao l
  LEFT JOIN cfop c        ON trim(c.codcfop) = l.codcfop::text
  LEFT JOIN produtos p    ON p.idproduto = l.codproduto
  LEFT JOIN parceiros pr  ON pr.codparceiro = l.codparceiro
 WHERE coalesce(l.indr, 'I') <> 'E' AND coalesce(l.tipo, 'U') <> 'S';
COMMENT ON VIEW get_config_legislacao IS 'CONFIGURACOES_LEGISLACAO';

CREATE OR REPLACE VIEW get_class_trib (codigo, cst, descricao_cst, class_trib, nome_class_trib, descricao_class_trib, lc_redacao, lc_214_25,
                                       tipo_aliquota, pred_ibs, pred_cbs, ind_redutor_bc, ind_gtrib_regular, ind_cred_pres, ind_mono,
                                       ind_mono_reten, ind_mono_ret, ind_mono_dif, credito_para, d_ini_vig, d_fim_vig, codclass_trib) AS
SELECT ct.codclass_trib, ct.cst, cib.descricao_cst, ct.class_trib, ct.nome_class_trib, ct.descricao_class_trib, ct.lc_redacao, ct.lc_214_25,
       ct.tipo_aliquota, ct.pred_ibs, ct.pred_cbs, ct.ind_redutor_bc, ct.ind_gtrib_regular, ct.ind_cred_pres, ct.ind_mono, ct.ind_mono_reten,
       ct.ind_mono_ret, ct.ind_mono_dif, ct.credito_para, ct.d_ini_vig, ct.d_fim_vig, ct.codclass_trib
  FROM class_trib ct
  JOIN cst_ibs_cbs cib ON ct.cst = cib.cst;
COMMENT ON VIEW get_class_trib IS 'CLASSIFICACAO FISCAL IBS CBS';

CREATE OR REPLACE VIEW get_operadores_permissoes (nome, login, senha, codigo, codigo_empresa, tipoop, codigo_vendedor, vendedor, desabilitado,
                                                  formulario, opcao) AS
SELECT o.nome, o.login, NULL::varchar, o.codoperador, r.codempresa,
       CASE WHEN o.tipoop = 'OPE' THEN 'Operador(a)' WHEN o.tipoop = 'USU' THEN 'Usuario(a)' ELSE 'Supervisor(a)' END,
       p.codparceiro, p.razao, coalesce(o.desabilitado, 'N'), pe.form, pe.opcao
  FROM operadores o
  LEFT JOIN relacao_operador_empresa r ON r.codoperador = o.codoperador
  LEFT JOIN parceiros p                ON p.codparceiro = o.codparceiro
  LEFT JOIN permissoes pe              ON pe.codoperador = o.codoperador;
COMMENT ON VIEW get_operadores_permissoes IS 'OPERADORES PERMISSOES';

CREATE OR REPLACE VIEW get_relprodutos (codidproduto, codbarra, codauxiliar, descricao, custo, fornecedor, departamento) AS
SELECT pro.idproduto, pro.codbarra, a.codauxiliar, pro.descricao, p.vrcusto, f.razao, d.descricao
  FROM multi_preco p
  LEFT JOIN produtos pro      ON pro.idproduto = p.idproduto
  LEFT JOIN familias_prod d   ON d.codfamilia = pro.coddpto
  LEFT JOIN parceiros f       ON f.codparceiro = pro.codfor
  LEFT JOIN codauxiliar a     ON a.idproduto = pro.idproduto
 WHERE p.idempresa = 4 AND p.ativo = 'S';
COMMENT ON VIEW get_relprodutos IS 'RELPRODUTOS';

CREATE OR REPLACE VIEW get_venda_composicao_2 (cod_barra_pai, descricao_pai, vr_venda_pai, qtd_pai, vr_total_pai, cod_prod_filho, cod_barra_filho,
                                               descricao_filho, qtd_vendida_filho, data_venda, id_empresa) AS
SELECT k.codbarra, k.descricao, v.vrvenda, v.qtde, v.vrvenda * v.qtde, v.codproduto, p.codbarra, p.descricao, c.qtde * v.qtde, v.dtvenda::date,
       v.idempresa
  FROM composicao c
  JOIN vendas v   ON v.codproduto = c.idproduto_01
  JOIN produtos p ON p.idproduto = c.idproduto_01
  JOIN produtos k ON k.idproduto = c.idproduto;
COMMENT ON VIEW get_venda_composicao_2 IS 'VENDA_COMPOSICAO_2';

CREATE OR REPLACE VIEW get_n2m_produtos_preco (idempresa, eanprincipal, datapreco, precoproduto, dataatualizacao, quantidadeatacado, precoatacado) AS
SELECT p.idempresa, pro.codbarra, p.dtultprecoalterado,
       CASE WHEN p.promocao = 'S' AND p.vrpromo > 0 THEN p.vrpromo ELSE p.vrvenda END,
       coalesce(p.dtultprecoalterado, now()), 0, 0
  FROM multi_preco p
  JOIN produtos pro ON pro.idproduto = p.idproduto
 WHERE coalesce(p.ativo, 'S') = 'S';
COMMENT ON VIEW get_n2m_produtos_preco IS 'N2M PRODUTOS PRECO';

CREATE OR REPLACE VIEW get_alteracao_custo (codhistorico, codempresa, fantasia, descricao, codbarra, valor_chave, data, usuario, codusuario,
                                            valor_atual, valor_anterior, historico, origem) AS
SELECT h.codhistorico, e.idempresa, e.fantasia, p.descricao, p.codbarra, p.idproduto, h.data, o.nome, o.codoperador, h.valor_atual,
       h.valor_anterior, h.historico, h.origem
  FROM historico_dinamico h
  JOIN produtos p        ON p.idproduto = CASE WHEN h.valor_chave ~ '^\s*\d+\s*$' THEN trim(h.valor_chave)::bigint END
                        AND h.chave = 'IDPRODUTO' AND h.campo = 'VRCUSTO'
  LEFT JOIN empresas e   ON e.idempresa = h.codempresa
  LEFT JOIN operadores o ON o.codoperador = h.codoperador
 WHERE h.origem IS NOT NULL;
COMMENT ON VIEW get_alteracao_custo IS 'ALTERACAO CUSTO';

CREATE OR REPLACE VIEW get_loteareceberbx (codigo, data_pagamento, valor_pago, valor_documento, historico, idempresa) AS
SELECT x.idlote, x.dtpgto::date, sum(x.valorpg), sum(r.valor), x.obs, r.codempresa
  FROM areceber_bx x
  JOIN areceber r              ON r.codrcb = x.codrcb
  JOIN parceiros p             ON p.codparceiro = r.codparceiro
  LEFT JOIN parceiros_end pe   ON pe.codparceiro = r.codparceiro AND pe.endereco_padrao = 'S'
 WHERE r.quitada = 'S'
 GROUP BY x.idlote, x.dtpgto::date, x.obs, r.codempresa;
COMMENT ON VIEW get_loteareceberbx IS 'LOTE CONTAS A RECEBER BAIXADAS';
