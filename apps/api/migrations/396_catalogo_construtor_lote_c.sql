-- 396 — o CATÁLOGO do construtor, lote C: 25 fontes da produção que não existiam aqui (retrato de 29/09/2026, conferidas pelo §283).
-- Lista de colunas explícita no CREATE VIEW, como no Oracle. Colunas sem qualificação no legado são qualificadas aqui com a tabela que
-- as tem (no Oracle a view só compila se o nome for de uma tabela só).
--
-- O que é do legado e fica:
--   · GET_BIGCRM_PRODUTOS, GET_SMART_PRODUTOS e GET_MARKETPLUS_PRODUTOS só a empresa 1 (fixo na view); a do BigCRM leva ID_LOJA '0'.
--   · GET_VOUCHER: o valor é fixo em ±58,00 (vale-gás), negativo no cancelamento.
--   · GET_TESTE ("CECILIA") e GET_EXTRATO_PRODUTO: o preço vem de TODA loja do produto (o JOIN da MULTI_PRECO não casa a loja) — o
--     saldo repete a cada preço igual de outra loja, como na GET_ESTOQUE_TOTALIZADO.
--   · GET_CHEQUE só os não baixados; GET_CHEQUEBX os baixados e não devolvidos (devolvido nulo fica fora).
--   · GET_PROMOCAO_ACUMULATIVA: o preço é o da PRIMEIRA loja da lista de empresas (os 2 caracteres depois do ';' inicial).
--   · GET_MOV_CONTAS_BANCARIAS2: a data é a da baixa do A Pagar do mesmo lote (nula quando o lote não é de baixa).
--   · CONTAS_BANCARIAS.CODLANCCONTABIL é texto e casa com o código do plano de contas: converte-se o que é número (no Oracle é implícito).

CREATE OR REPLACE VIEW get_bigcrm_produtos (id_loja, id_produto, barra, produto, centro_receita, grupo, categoria, estoque) AS
SELECT '0'::char(1), p.idproduto, p.codbarra, p.descricao, d.descricao, g.descricao, su.descricao, e.qtde
  FROM produtos p
  JOIN multi_preco mp         ON mp.idproduto = p.idproduto
  LEFT JOIN estoque e         ON e.idempresa = mp.idempresa AND e.idproduto = mp.idproduto
  LEFT JOIN familias_prod d   ON d.codfamilia = p.coddpto
  LEFT JOIN familias_prod g   ON g.codfamilia = p.codgrupo
  LEFT JOIN familias_prod su  ON su.codfamilia = p.codsubgrupo
 WHERE mp.idempresa = 1
 ORDER BY p.idproduto;
COMMENT ON VIEW get_bigcrm_produtos IS 'SMART PRODUTOS';

-- (DTFATURAMENTO do legado é a data digitada, que aqui mora em data_faturamento — extrair.py RENOMEIA)
CREATE OR REPLACE VIEW get_pedido_compra_itens (nro_pedido, data, vencimento, faturamento, observacao, fechado, cod_fornecedor, fornecedor,
                                                empresas_pedido, empresa, qtde, fator_embalagem, qtde_total, custo, total_custo, cod_produto,
                                                cod_barras, produto) AS
SELECT p.codpedcomp, p.data, p.dt_vencimento, p.data_faturamento, p.obs, p.fechado, p.codparceiro, par.fantasia, p.empresas, pq.idempresa, pq.qtde,
       pi.fatorembalagem, pq.qtdtotal, pi.vrcusto, pq.totalcusto, pi.idproduto, prod.codbarra, prod.descricao
  FROM pedidocompra p
  LEFT JOIN pedidocompra_i pi       ON pi.codpedcomp = p.codpedcomp
  LEFT JOIN pedido_compra_qtde pq   ON pq.codpedcompi = pi.codpedcompi
  LEFT JOIN parceiros par           ON par.codparceiro = p.codparceiro
  LEFT JOIN produtos prod           ON prod.idproduto = pi.idproduto
 ORDER BY p.codpedcomp, prod.descricao, pq.idempresa;
COMMENT ON VIEW get_pedido_compra_itens IS 'ITENS DO PEDIDO DE COMPRA';

CREATE OR REPLACE VIEW get_smart_produtos (id_loja, id_produto, barra, produto, centro_receita, grupo, categoria, estoque) AS
SELECT mp.idempresa, p.idproduto, p.codbarra, p.descricao, d.descricao, g.descricao, su.descricao, e.qtde
  FROM produtos p
  JOIN multi_preco mp         ON mp.idproduto = p.idproduto
  LEFT JOIN estoque e         ON e.idempresa = mp.idempresa AND e.idproduto = mp.idproduto
  LEFT JOIN familias_prod d   ON d.codfamilia = p.coddpto
  LEFT JOIN familias_prod g   ON g.codfamilia = p.codgrupo
  LEFT JOIN familias_prod su  ON su.codfamilia = p.codsubgrupo
 WHERE mp.idempresa = 1
 ORDER BY p.idproduto;
COMMENT ON VIEW get_smart_produtos IS 'SMART PRODUTOS';

CREATE OR REPLACE VIEW get_inventario_rotativo (lote, data_abertura, data_fechamento, codempresa, codigo_inicial, codigo_final, descricao,
                                                codigo_invetario, importado_perdas, codnf_perdas, importado_sobras, codnf_sobras) AS
SELECT r.lote,
       (SELECT min(i.data::date) FROM inventario_rotativo i WHERE i.lote = r.lote),
       r.data::date, r.idempresa,
       (SELECT min(i.codinv_rotativo) FROM inventario_rotativo i WHERE i.lote = r.lote)::numeric(10),
       (SELECT max(i.codinv_rotativo) FROM inventario_rotativo i WHERE i.lote = r.lote)::numeric(10),
       r.nomelote, r.codinv_rotativo, r.importado_perdas, r.codnf_perdas, r.importado_sobras, r.codnf_sobras
  FROM inventario_rotativo r
 WHERE r.operacao = 'FECHADO';
COMMENT ON VIEW get_inventario_rotativo IS 'INVENTARIO ROTATIVO';

CREATE OR REPLACE VIEW get_chequebx (cliente, titular, bom_para, data_emissao, data_baixa, nro_cheque, valor, baixado, operador, operador_baixa, banco,
                                     nro_pedido, observacao, idempresa, codigo, idlote, liberado, agencia, idpgo, pdv, consiliado, data_operacao,
                                     contabilizado) AS
SELECT p.razao, c.titular, c.bompara::date, c.dtemissao::date, c.databaixa::date, c.nrocheque, c.valor, c.baixado, o.nome, op.nome, b.banco,
       c.nropedido, c.observacao, c.idempresa, c.codchq, c.idlote, c.liberado, b.agencia, c.idpgto, c.codpdv, c.consiliado, c.data_operacao,
       c.contabilizado
  FROM cheque c
  LEFT JOIN bancos b      ON b.codbco = c.codbco
  LEFT JOIN parceiros p   ON p.codparceiro = c.codparceiro
  LEFT JOIN operadores o  ON o.codoperador = c.operador
  LEFT JOIN operadores op ON op.codoperador = c.codopbx
 WHERE c.baixado = 'S' AND c.devolvido = 'N' AND c.devolvido IS NOT NULL;
COMMENT ON VIEW get_chequebx IS 'CHEQUES BAIXADOS';

CREATE OR REPLACE VIEW get_voucher (operacao, codhistvoucher, idempresa, dtvenda, valor, codpdv, codoperador, codoperadora, operadora, nsu, nsuhost,
                                    autorizacao, modalidadeoperadora, nomeprodutositef, qtdeprodutositef, nomefornecedorsitef, chave, nome, login) AS
SELECT CASE WHEN hv.tipomodalidade = 99 THEN 'CANCELAMENTO' ELSE 'VENDA' END, hv.codhistvoucher, hv.idempresa, hv.dtvenda,
       CASE WHEN hv.tipomodalidade = 99 THEN -58.00 ELSE 58.00 END, hv.codpdv, hv.codoperador, hv.codoperadora, hv.operadora, hv.nsu, hv.nsuhost,
       hv.autorizacao, hv.modalidadeoperadora, hv.nomeprodutositef, hv.qtdeprodutositef, hv.nomefornecedorsitef, hv.chave, o.nome, o.login
  FROM hist_voucher hv
  LEFT JOIN caixa_pdv cp  ON cp.chave = hv.chave
  LEFT JOIN operadores o  ON o.codoperador = cp.codoperadora
 WHERE coalesce(hv.stregistro, 'A') <> 'E'
 ORDER BY hv.dtvenda;
COMMENT ON VIEW get_voucher IS 'VALE GAS';

CREATE OR REPLACE VIEW get_teste (idproduto, codbarra, descricao, unidade, qtde, vrcusto, vrvenda, idempresa, dpto, codfor, fornecedor) AS
SELECT t.idproduto, t.codbarra, t.descricao, t.unidade, sum(t.qtde), t.vrcusto, t.vrvenda, t.idempresa, t.dpto, t.codfor, t.fornecedor
  FROM (SELECT e.idproduto, p.codbarra, p.descricao, p.unidade, e.qtde, m.vrcusto, m.vrvenda, e.idempresa, j.descricao AS dpto, p.codfor,
               pa.razao AS fornecedor
          FROM estoque e
          LEFT JOIN produtos p      ON p.idproduto = e.idproduto
          LEFT JOIN familias_prod j ON j.codfamilia = p.coddpto
          JOIN multi_preco m        ON m.idproduto = p.idproduto
          JOIN parceiros pa         ON pa.codparceiro = p.codfor) t
 GROUP BY t.idproduto, t.codbarra, t.descricao, t.unidade, t.vrcusto, t.vrvenda, t.idempresa, t.dpto, t.codfor, t.fornecedor;
COMMENT ON VIEW get_teste IS 'CECILIA';

CREATE OR REPLACE VIEW get_estoque_dep (idproduto, descricao, idempresa, vrvenda, qtde, vrcusto, servico, unidade, codbarra, ativo) AS
WITH valor_config AS (
  SELECT c.codigo, coalesce(ce.valor, c.valor) AS valor
    FROM configuracoes c LEFT JOIN configuracoes_especificas ce ON ce.id = c.id
   WHERE c.codigo = 'ATIVO_PELA_MULTIPRECO'
)
SELECT d.idproduto, p.descricao, d.idempresa, m.vrvenda, d.qtde, m.vrcusto, p.servico, p.unidade, p.codbarra,
       CASE WHEN vc.valor = 'S' THEN coalesce(m.ativo, 'S') ELSE coalesce(p.ativo, 'S') END
  FROM estoque_dep d
  LEFT JOIN produtos p      ON p.idproduto = d.idproduto
  JOIN multi_preco m        ON m.idproduto = d.idproduto AND m.idempresa = d.idempresa
  LEFT JOIN valor_config vc ON vc.codigo = 'ATIVO_PELA_MULTIPRECO';
COMMENT ON VIEW get_estoque_dep IS 'ESTOQUE DEPOSITO';

CREATE OR REPLACE VIEW get_produtos_izio (codigo, codbarra, descricao, subgrupo, codsubgrupo, grupo, codgrupo, secao, codsecao, departamento, coddpto) AS
SELECT DISTINCT pro.idproduto, pro.codbarra, pro.descricao, sg.descricao, pro.codsubgrupo, g.descricao, pro.codgrupo, sc.descricao, pro.codsecao,
       d.descricao, pro.coddpto
  FROM multi_preco p
  LEFT JOIN produtos pro      ON pro.idproduto = p.idproduto
  LEFT JOIN familias_prod d   ON d.codfamilia = pro.coddpto
  LEFT JOIN familias_prod g   ON g.codfamilia = pro.codgrupo
  LEFT JOIN familias_prod sg  ON sg.codfamilia = pro.codsubgrupo
  LEFT JOIN familias_prod sc  ON sc.codfamilia = pro.codsecao
 WHERE p.ativo = 'S';
COMMENT ON VIEW get_produtos_izio IS 'PRODUTOS IZIO';

CREATE OR REPLACE VIEW get_n2m_estoque (idproduto, idempresa, estoque, qtde_pendencia) AS
SELECT t.idproduto, t.idempresa, sum(t.qtde), 0.00
  FROM (SELECT e.idproduto, e.idempresa, CASE WHEN coalesce(e.qtde, 0) < 0 THEN 0 ELSE e.qtde END AS qtde
          FROM multi_preco p JOIN estoque e ON e.idproduto = p.idproduto AND e.idempresa = p.idempresa
         WHERE coalesce(p.ativo, 'S') = 'S'
        UNION ALL
        SELECT e.idproduto, e.idempresa, CASE WHEN coalesce(e.qtde, 0) < 0 THEN 0 ELSE e.qtde END
          FROM multi_preco p JOIN estoque_dep e ON e.idproduto = p.idproduto AND e.idempresa = p.idempresa
         WHERE coalesce(p.ativo, 'S') = 'S') t
 GROUP BY t.idempresa, t.idproduto;
COMMENT ON VIEW get_n2m_estoque IS 'N2M ESTOQUE';

CREATE OR REPLACE VIEW get_n2m_produtos_ean (eanprincipal, codauxiliar, idproduto, embalagem, quantidade, dataatualizaczo, descricaoean, pesavel,
                                             fracionado, qtdeapartirde) AS
SELECT DISTINCT pro.codbarra, ca.codauxiliar, pro.idproduto, pro.unidade, coalesce(pro.quantidade, 1), coalesce(pro.dtultimalteracao, now()),
       pro.descricao,
       CASE WHEN pro.balanca = 'S' AND pro.unidade = 'KG' THEN 1 ELSE 0 END,
       CASE WHEN pro.balanca = 'S' AND pro.unidade = 'KG' THEN 1 ELSE 0 END, 0
  FROM multi_preco p
  JOIN produtos pro    ON pro.idproduto = p.idproduto
  JOIN codauxiliar ca  ON ca.codbarra = pro.codbarra
 WHERE coalesce(p.ativo, 'S') = 'S';
COMMENT ON VIEW get_n2m_produtos_ean IS 'N2M PRODUTOS EAN';

CREATE OR REPLACE VIEW get_diario (coddiario, datalan, contadebito, contacredito, valor, documento, tipodoc, codhist, deschist, complemento,
                                   desc_conta_credito, codiexpandido_cre, desc_conta_debito, codiexpandido_deb, origem, operacao, codcc, codempresa,
                                   cod_interno_debito, cod_interno_credito, codorigem) AS
SELECT d.coddiario, d.datalan, pc.codireduzido, p.codireduzido, d.valor, d.documento, d.tipodoc, d.codhist, d.deschist, d.complemento, p.descricao,
       p.codiexpandido, pc.descricao, pc.codiexpandido, o.descorigem, d.codoperacao, d.codcc, d.codempresa, pc.codplanocontas, p.codplanocontas,
       d.codorigem
  FROM diario d
  LEFT JOIN plano_contas p     ON p.codplanocontas = d.contacredito
  LEFT JOIN plano_contas pc    ON pc.codplanocontas = d.contadebito
  LEFT JOIN origem_contabil o  ON o.codorigem = d.codorigem;
COMMENT ON VIEW get_diario IS 'LANÇAMENTO DIÁRIO CONTÁBIL';

CREATE OR REPLACE VIEW get_rel_nf_devolucao (cod_devol, nro_devol, fina_devol, canc_devol, cfop_devol, descfop_devol, dtemisao_devol, total_devol,
                                             codpar_devol, parc_devol, cnpj_devol, cod_orig, nro_orig, fina_orig, canc_orig, cfop_orig, descfop_orig,
                                             dtemisao_orig, total_orig, codpar_orig, parc_orig, cnpj_orig) AS
SELECT n.codnf, n.nronf, n.finalidade, n.cancelada, CASE WHEN n.cfop ~ '^\d+$' THEN n.cfop::numeric END, cn.descricao, n.dtemissao, n.totalnf,
       n.codparceiro, pn.razao, en.cnpj_cpf,
       r.codnf, r.nronf, r.finalidade, r.cancelada, CASE WHEN r.cfop ~ '^\d+$' THEN r.cfop::numeric END, cr.descricao, r.dtemissao, r.totalnf,
       r.codparceiro, pr.razao, er.cnpj_cpf
  FROM nf_referencia t
  LEFT JOIN nf n              ON n.codnf = t.codnf
  LEFT JOIN cfop cn           ON cn.codcfop = n.cfop
  LEFT JOIN parceiros pn      ON pn.codparceiro = n.codparceiro
  LEFT JOIN parceiros_end en  ON en.codparceiro = n.codparceiro
  LEFT JOIN nf r              ON r.codnf = t.codnf_ref
  LEFT JOIN cfop cr           ON cr.codcfop = r.cfop
  LEFT JOIN parceiros pr      ON pr.codparceiro = r.codparceiro
  LEFT JOIN parceiros_end er  ON er.codparceiro = r.codparceiro;
COMMENT ON VIEW get_rel_nf_devolucao IS 'REL - NF DEVOLUCAO';

CREATE OR REPLACE VIEW get_n2m_produtos_promocao (idroduto, datainicial, datafinal, idempresa, tipopromocao, precopromocao, quantidadelimitada,
                                                  quantidademinima, quantidademaxima, quantidadeleve, quantidadepague, valordesconto) AS
SELECT m.idproduto, a.dtiniciopromocao, a.dtfimpromocao, m.idempresa, 1, m.vrpromo, 0, 0, 0, 0, 0, 0
  FROM multi_preco m
  JOIN agenda_promocao a ON a.codagenda = m.codagenda
 WHERE m.ativo = 'S' AND m.promocao = 'S' AND m.vrpromo > 0;
COMMENT ON VIEW get_n2m_produtos_promocao IS 'N2M PRODUTOS PROMOCAO';

CREATE OR REPLACE VIEW get_movimentacao_diaria (codigo_conta, titular, numero_conta, data, credito, debito) AS
SELECT m.codconta, cb.titular, cb.nroconta, m.dtemissao, sum(m.credito), sum(m.debito)
  FROM (SELECT codconta, dtemissao::date AS dtemissao, sum(valor) AS credito, 0 AS debito FROM mov_contas_bancarias
         WHERE tipomovimento = 'C' AND coalesce(revertido, 'N') = 'N' AND idlote_reversao IS NULL GROUP BY codconta, dtemissao::date
        UNION ALL
        SELECT codconta, dtemissao::date, 0, sum(valor) FROM mov_contas_bancarias
         WHERE tipomovimento = 'D' AND coalesce(revertido, 'N') = 'N' AND idlote_reversao IS NULL GROUP BY codconta, dtemissao::date) m
  JOIN contas_bancarias cb ON cb.codconta = m.codconta
 GROUP BY m.codconta, cb.titular, cb.nroconta, m.dtemissao
 ORDER BY m.codconta, m.dtemissao;
COMMENT ON VIEW get_movimentacao_diaria IS 'MOVIMENTAÇÃO DIÁRIA';

CREATE OR REPLACE VIEW get_pedidosrelat_recursos (nropedido, cliente, codigo_operador, operador, idempresa, data_hora, data, hora, cancelado, valor,
                                                  operacao, tipo, total_vend, cod_vendedor, vendedor, faturado, dt_processamento, total_forma,
                                                  comissao_forma, data_faturamento) AS
SELECT x.nropedido, v.cliente, o.codoperador, o.nome, v.idempresa, x.data, x.data::date, x.data::time(0), v.cancelado, x.valor, x.operacao, v.tipo,
       0::numeric(13,2), v.codvendedor, p.razao, x.faturado, x.dt_processamento,
       (coalesce((SELECT f.comissao FROM formas_pgto f WHERE f.modalidade = x.operacao LIMIT 1), 0) * x.valor / 100)::numeric(13,2),
       coalesce((SELECT f.comissao FROM formas_pgto f WHERE f.modalidade = x.operacao LIMIT 1), 0),
       v.dt_fatu::date
  FROM cx_pedidos x
  LEFT JOIN pedidos v     ON v.nropedido = x.nropedido
  LEFT JOIN parceiros c   ON c.codparceiro = v.codparceiro
  LEFT JOIN parceiros p   ON p.codparceiro = v.codvendedor
  LEFT JOIN operadores o  ON o.codoperador = v.operador
 WHERE x.operacao NOT IN ('DESCONTO', 'ACRESCIMO');
COMMENT ON VIEW get_pedidosrelat_recursos IS 'PEDIDOS POR RECURSO;';

CREATE OR REPLACE VIEW get_apagar_contabil (nr_documento, fornecedor, valor, emissao, vencimento, data_contabil, juros, nota_fiscal, tipo_documento, banco,
                                            observacao, codigo_empresa, empresa, operador, codigo, codigo_parceiro, nr_parcela, vendor, convenio,
                                            codbco, quitada, idnf, gerado, nrodup, codoperador, idempresa, codcentrocusto, fantasia) AS
SELECT p.duplicata, f.razao, (p.valor + coalesce(p.vendor, 0))::numeric(13,2), p.dtcompra, p.dtvenc::date, coalesce(n.dtcontabil, p.dtcompra),
       coalesce(p.txjuros, 0), n.nronf, p.tipodoc, b.banco, p.obs, p.codempresa, e.razao_social, o.nome, p.codapg, p.codparceiro, p.nrparcela,
       p.vendor, p.convenio, b.codbco, p.quitada, p.idnf, p.gerado, p.nrodup, p.codoperador, p.codempresa, p.codcentrocusto, f.fantasia
  FROM apagar p
  LEFT JOIN bancos b      ON b.codbco = p.codbco
  LEFT JOIN operadores o  ON o.codoperador = p.codoperador
  LEFT JOIN parceiros f   ON f.codparceiro = p.codparceiro
  LEFT JOIN empresas e    ON e.idempresa = p.codempresa
  LEFT JOIN nf n          ON n.codnf = p.idnf;
COMMENT ON VIEW get_apagar_contabil IS 'CONTAS A PAGAR CONTABIL';

CREATE OR REPLACE VIEW get_mov_contas_bancarias2 (data_emissao, data_vencimento, nro_cheque, valor_cheque, nro_documento, valor, liberado, historico,
                                                  titular, debito_credito, nro_conta, codigo, codigo_conta, tipo, codchqproprio, idlote,
                                                  codlanccontabil, idempresa) AS
SELECT bx.dtpgto::date, CASE WHEN ch.dtvenc::date = b.dtvenc::date THEN b.dtvenc::date ELSE ch.dtvenc::date END, ch.nrocheque, ch.valor,
       b.nrodocumento, b.valor, CASE b.liberado WHEN 'S' THEN 'SIM' ELSE 'NAO' END, b.historico, c.titular,
       CASE b.tipomovimento WHEN 'C' THEN 'CREDITO' ELSE 'DEBITO' END, c.nroconta, b.codmovconta, b.codconta,
       CASE WHEN b.tipo = 'A' THEN 'ANTECIPACAO' WHEN b.tipo = 'C' THEN 'CONSIGNACAO' END, ch.codchqproprio, b.idlote::varchar(20),
       c.codlanccontabil, c.idempresa
  FROM mov_contas_bancarias b
  JOIN contas_bancarias c          ON c.codconta = b.codconta
  LEFT JOIN relacao_chq_prop r     ON r.codmovconta = b.codmovconta
  LEFT JOIN chq_proprio ch         ON ch.codchqproprio = r.codchqproprio
  LEFT JOIN apagar_bx bx           ON bx.idlote = b.idlote;
COMMENT ON VIEW get_mov_contas_bancarias2 IS 'MOVIMENTACOES BANCARIAS2';

CREATE OR REPLACE VIEW get_cheque (codigo_cliente, cliente, nro_cheque, valor, bom_para, titular, data_emissao, data_devolucao, operador, banco,
                                   nro_pedido, devolvido, observacao, idempresa, codigo, pdv, codigo_operador, idpgto, lote_rcb, custodia,
                                   banco_custodia, data_custodia, conta_transferencia, data_transferencia, lote_transferencia, consiliado,
                                   codigo_conta, codigo_cobrador, cobrador, identificador, contabilizado) AS
SELECT p.codparceiro, p.razao, c.nrocheque, c.valor, c.bompara::date, c.titular, c.dtemissao::date, c.datadevolucao::date, o.nome, b1.banco,
       c.nropedido, c.devolvido, c.observacao, c.idempresa, c.codchq, c.codpdv, c.operador, c.idpgto, c.idlotebxrcb, c.custodia, b.titular,
       c.datacustodia::date, c.codconta, c.datatransf, c.lotetransf, c.consiliado, c.codconta, c.codcobrador, p_cob.razao, c.identificador,
       c.contabilizado
  FROM cheque c
  LEFT JOIN contas_bancarias b   ON b.codconta = c.codconta
  LEFT JOIN bancos b1            ON b1.codbco = b.codbco
  LEFT JOIN contas_bancarias b2  ON b2.codconta = c.codbcocustodia
  LEFT JOIN parceiros p          ON p.codparceiro = c.codparceiro
  LEFT JOIN parceiros p_cob      ON p_cob.codparceiro = c.codcobrador
  LEFT JOIN operadores o         ON o.codoperador = c.operador
 WHERE c.baixado = 'N';
COMMENT ON VIEW get_cheque IS 'CHEQUE';

CREATE OR REPLACE VIEW get_promocao_acumulativa (codigo, codigo_produto, codbarra, descricao, empresas, qtde, desconto, inicio, fim, data_inclusao,
                                                 nome_operador_inclusao, nome_operador_alteracao, codoperador_inclusao, codoperador_edicao, vrvenda,
                                                 totalvenda, vrvenda_desc, totalvenda_desc, dataalteracao, idempresa_multi_preco, promocao, vrpromo,
                                                 vrcusto, atacarejo) AS
SELECT p.idproacumulativa, p.idproduto, pro.codbarra, pro.descricao, p.idempresa, p.qtde, p.desconto, p.dtini::date, p.dtfim::date,
       p.dtcadastro::date, o.login, u.login, p.usuinclusao, p.usultalteracao, g.vrvenda, p.qtde * g.vrvenda,
       CASE WHEN coalesce(p.atacarejo, 'N') = 'S' THEN g.vrvenda - p.desconto ELSE g.vrvenda - (p.desconto / p.qtde) END,
       p.qtde * (g.vrvenda - (p.desconto / p.qtde)), p.dtultimalteracao, g.idempresa, 'S'::char(1), p.qtde * (g.vrvenda - (p.desconto / p.qtde)),
       g.vrcustorep, p.atacarejo
  FROM promocao_acumulativa p
  LEFT JOIN produtos pro    ON pro.idproduto = p.idproduto
  LEFT JOIN operadores o    ON o.codoperador = p.usuinclusao
  LEFT JOIN operadores u    ON u.codoperador = p.usultalteracao
  LEFT JOIN multi_preco g   ON g.idproduto = p.idproduto
                           AND g.idempresa = CASE WHEN replace(substr(p.idempresa, 2, 2), ';', '') ~ '^\d+$'
                                                  THEN replace(substr(p.idempresa, 2, 2), ';', '')::numeric(10) END;
COMMENT ON VIEW get_promocao_acumulativa IS 'PROMOCAOACUMULATIVA';

CREATE OR REPLACE VIEW get_mov_contas_bancarias (data_emissao, data_vencimento, nro_cheque, valor_cheque, nro_documento, valor, liberado, historico,
                                                 titular, debito_credito, nro_conta, codigo, codigo_conta, tipo, codchqproprio, idlote, codcontabil,
                                                 data_liberacao) AS
SELECT b.dtemissao::date, CASE WHEN ch.dtvenc::date = b.dtvenc::date THEN b.dtvenc::date ELSE ch.dtvenc::date END, ch.nrocheque, ch.valor,
       b.nrodocumento, b.valor, CASE b.liberado WHEN 'S' THEN 'SIM' ELSE 'NAO' END, b.historico, c.titular,
       CASE b.tipomovimento WHEN 'C' THEN 'CREDITO' ELSE 'DEBITO' END, c.nroconta, b.codmovconta, b.codconta,
       CASE WHEN b.tipo = 'A' THEN 'ANTECIPACAO' WHEN b.tipo = 'C' THEN 'CONSIGNACAO' END, ch.codchqproprio, b.idlote::varchar(20),
       p.codireduzido, b.dtliberacao::date
  FROM mov_contas_bancarias b
  JOIN contas_bancarias c          ON c.codconta = b.codconta
  LEFT JOIN relacao_chq_prop r     ON r.codmovconta = b.codmovconta
  LEFT JOIN chq_proprio ch         ON ch.codchqproprio = r.codchqproprio
  LEFT JOIN plano_contas p         ON p.codplanocontas = CASE WHEN c.codlanccontabil ~ '^\s*\d+\s*$' THEN trim(c.codlanccontabil)::integer END;
COMMENT ON VIEW get_mov_contas_bancarias IS 'MOVIMENTACOES BANCARIAS';

CREATE OR REPLACE VIEW get_rel_vendas (idempresa, codproduto, cancelado, data, datahora, qtde, vrvenda, total_acrescimo, total_desconto, total_venda, custo) AS
SELECT v.idempresa, v.codproduto, v.cancelado, v.dtvenda::date, v.dtvenda, v.qtde, v.vrvenda,
       ((CASE WHEN coalesce(v.desc_acre_medio, 0) > 0 THEN coalesce(v.desc_acre_medio, 0) ELSE 0 END)
        + (CASE WHEN coalesce(v.desc_acre_item, 0) > 0 THEN coalesce(v.desc_acre_item, 0) ELSE 0 END))::numeric(18,2),
       (coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
        + (CASE WHEN coalesce(v.desc_acre_medio, 0) < 0 THEN coalesce(v.desc_acre_medio, 0) * -1 ELSE 0 END)
        + (CASE WHEN coalesce(v.desc_acre_item, 0) < 0 THEN coalesce(v.desc_acre_item, 0) * -1 ELSE 0 END))::numeric(18,2),
       (CASE WHEN v.iat = 'A' THEN (v.qtde * v.vrvenda)::numeric(18,2) ELSE trunc(v.qtde * v.vrvenda * 100)::numeric(18,2) / 100 END)::numeric(18,2),
       (v.qtde * v.vrcusto)::numeric(13,2)
  FROM vendas v;
COMMENT ON VIEW get_rel_vendas IS 'PEDIDO';

CREATE OR REPLACE VIEW get_marketplus_produtos (id, gtin, nome, departamento_pai, departamento, marca, estoque, estoque_minimo, preco, preco_com_desconto,
                                                limite_item_carrinho, ativo) AS
SELECT p.idproduto, p.codbarra, p.descricao, d.descricao, g.descricao, m.descricao,
       CASE WHEN coalesce(e.qtde, 0) > 0 THEN e.qtde ELSE 0 END, e.minimo, mp.vrvenda,
       CASE WHEN mp.promocao = 'S' AND coalesce(mp.vrpromo, 0) > 0 AND coalesce(mp.vrpromo, 0) < mp.vrvenda THEN mp.vrpromo ELSE mp.vrvenda END,
       0, CASE WHEN mp.ativo = 'N' THEN 0 ELSE 1 END
  FROM produtos p
  JOIN multi_preco mp        ON mp.idproduto = p.idproduto
  LEFT JOIN estoque e        ON e.idempresa = mp.idempresa AND e.idproduto = mp.idproduto
  LEFT JOIN marcas m         ON m.idmarca = p.idmarca
  LEFT JOIN familias_prod d  ON d.codfamilia = p.coddpto
  LEFT JOIN familias_prod g  ON g.codfamilia = p.codgrupo
 WHERE coalesce(p.vende_site, 'N') = 'S' AND mp.idempresa = 1
 ORDER BY p.idproduto;
COMMENT ON VIEW get_marketplus_produtos IS 'MARKETPLUS PRODUTOS';

CREATE OR REPLACE VIEW get_itens_nf (emissao, data_contabil, descricao, codbarra, vrcusto, markup, vrcustoreal, quantidade, cfop, grupo, subgrupo,
                                     departamento, fornecedor, codproduto, idempresa, tipo, codnf, nronf, cod_contabil, situacao_nf, aliqpise, aliqpiss,
                                     creditopiscofins, cstpiscofins, debitopiscofins, descricao_piscofins, valor_piscofins, ncm, icms, base_calculo) AS
SELECT n.dtemissao, n.dtcontabil, p.descricao, p.codbarra, np.vrcusto, np.markup, np.vrcustoreal, np.quantidade, np.cfop, g.descricao, sg.descricao,
       d.descricao, pa.razao, np.codproduto, n.idempresa, n.tipo, n.codnf, n.nronf, pa.codcontabil, n.idsituacao_nf, np.aliqpise, np.aliqpiss,
       np.creditopiscofins, np.cstpiscofins, np.debitopiscofins, np.descricao,
       ((np.vrcustoreal - np.vrdescprod) * ((np.aliqpise + np.aliqcofinse) / 100))::numeric(13,2), p.ncmsh, np.vricm, np.vrbasecalculo
  FROM nf_prod np
  LEFT JOIN nf n              ON n.codnf = np.codnf
  LEFT JOIN parceiros pa      ON pa.codparceiro = n.codparceiro
  LEFT JOIN produtos p        ON p.idproduto = np.codproduto
  LEFT JOIN familias_prod g   ON g.codfamilia = p.codgrupo
  LEFT JOIN familias_prod sg  ON sg.codfamilia = p.codsubgrupo
  LEFT JOIN familias_prod d   ON d.codfamilia = p.coddpto
  LEFT JOIN piscofins pis     ON pis.idpiscofins = np.idpiscofins;
COMMENT ON VIEW get_itens_nf IS 'ITENS DA NOTA FISCAL';

CREATE OR REPLACE VIEW get_extrato_produto (idproduto, codbarra, descricao, unidade, total_qtde, vrcusto, vrvenda, idempresa, dpto, codfor, fornecedor) AS
SELECT t.idproduto, t.codbarra, t.descricao, t.unidade, sum(t.qtde), t.vrcusto, t.vrvenda, t.idempresa, t.dpto, t.codfor, t.fornecedor
  FROM (SELECT e.idproduto, p.codbarra, p.descricao, p.unidade, e.qtde, m.vrcusto, m.vrvenda, e.idempresa, j.descricao AS dpto, p.codfor,
               pa.razao AS fornecedor
          FROM estoque e
          LEFT JOIN produtos p      ON p.idproduto = e.idproduto
          LEFT JOIN familias_prod j ON j.codfamilia = p.coddpto
          JOIN multi_preco m        ON m.idproduto = p.idproduto
          JOIN parceiros pa         ON pa.codparceiro = p.codfor
        UNION ALL
        SELECT d.idproduto, p.codbarra, p.descricao, p.unidade, d.qtde, m.vrcusto, m.vrvenda, d.idempresa, j.descricao, p.codfor, pa.razao
          FROM estoque_dep d
          LEFT JOIN produtos p      ON p.idproduto = d.idproduto
          LEFT JOIN familias_prod j ON j.codfamilia = p.coddpto
          JOIN multi_preco m        ON m.idproduto = p.idproduto
          JOIN parceiros pa         ON pa.codparceiro = p.codfor) t
 GROUP BY t.idproduto, t.codbarra, t.descricao, t.unidade, t.vrcusto, t.vrvenda, t.idempresa, t.dpto, t.codfor, t.fornecedor;
COMMENT ON VIEW get_extrato_produto IS 'EXTRATO_PRODUTO';
