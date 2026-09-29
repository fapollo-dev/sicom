-- 397 — o CATÁLOGO do construtor, lote D: as 22 maiores fontes da produção que não existiam aqui (retrato de 29/09/2026, §283).
-- Lista de colunas explícita no CREATE VIEW, como no Oracle.
--
-- O que é do legado e fica:
--   · GET_AREC… (GET_ARECEBER_CONTABIL): no Oracle CURRENT_DATE traz a HORA. DIAS_ATRAZO arredonda os dias fracionários
--     (CAST(CURRENT_DATE − DTVENC AS NUMBER(10)) — muda ao meio-dia); o JURO usa os dias TRUNCADOS e a taxa diária arredondada a 2
--     casas; o TOTAL usa os dias ARREDONDADOS e a taxa SEM arredondar — TOTAL ≠ VALOR + JURO, como lá. (A GET_RCB, a GET_REL_RCB e a
--     GET_RECEBIMENTOS truncam tudo: dias inteiros.)
--   · GET_PRODUTOS_SITE / GET_PRODUTOS_SITEMERCADO: `COALESCE(DESCRICAO_RESUMIDA,'') <> ''` no Oracle ('' é NULL) nunca é verdadeiro —
--     a descrição resumida e a web saem SEMPRE iguais à DESCRICAO. E o estoque do depósito soma o saldo da LOJA (E.QTDE) quando há depósito.
--   · GET_PRODUTOS_PC: a alíquota efetiva casa só pela alíquota (sem a UF) — a linha se repete por UF cadastrada.
--   · GET_SALDO_PARCEIRO: o endereço é o padrão do parceiro, senão o primeiro; o SALDO é zero quando o crédito é zero.
--   · GET_NF_MANIFESTO: só a janela de DIAS_RETROATIVOS_FILTRO_MANIFESTO (90 se não houver), notas lançadas e não lançadas.
--   · GET_RECEBIMENTOS: as baixas de cartão e de título repetem o recebível a cada baixa (o SUM do legado conta de novo).
--   · GET_DRE_CAIXA: o rateio divide pelo total da NF (1 quando zero) ou, sem NF, pela soma do grupo de títulos.
--   · GET_PADRE_RESUMO_VENDA: CFOP 5949/6949 (paletes) fora; as devoluções entram negativas pela NF referenciada.
-- Subconsulta escalar que no Oracle derrubaria a view com mais de uma linha leva LIMIT 1 aqui, e divisão por zero sai nula (a diferença só
-- existe onde lá daria erro). Concatenação: no Oracle o nulo vira vazio (`NULL || ' '` = ' '); aqui concat()/coalesce fazem o mesmo.

CREATE OR REPLACE VIEW get_apagar_cen (nr_documento, fornecedor, valor, emissao, vencimento, data_contabil, juros, nota_fiscal, tipo_documento, banco,
                                       observacao, codigo_empresa, empresa, operador, codigo, codigo_parceiro, nr_parcela, vendor, convenio, codbco,
                                       quitada, idnf, gerado, nrodup, codoperador, idempresa, centro_custo, fantasia, descontopedido, desconto,
                                       valor_bruto, issqn, valorissqn, descricao, bloqueio, codadiantamento, codbarras, remessa_gerada) AS
SELECT p.duplicata, f.razao, (p.valor + coalesce(p.vendor, 0) - coalesce(p.desconto, 0))::numeric(13,2), p.dtcompra, p.dtvenc::date,
       coalesce(n.dtcontabil, p.dtcompra), coalesce(p.txjuros, 0), n.nronf, p.tipodoc, b.banco, p.obs, p.codempresa, e.razao_social, o.nome,
       p.codapg, p.codparceiro, p.nrparcela, p.vendor, p.convenio, b.codbco, p.quitada, p.idnf, p.gerado, p.nrodup, p.codoperador, p.codempresa,
       cen.desccodplc, f.fantasia, f.desconto_pedidos, p.desconto, p.valor, n.issqn, n.valorissqn,
       (SELECT g.descricao FROM plc g JOIN cx_apagar a ON a.codcc = g.codplc WHERE a.codgrupo = p.codgrupo ORDER BY a.codcxapagar LIMIT 1),
       p.bloqueio, p.codadiantamento, p.codbarrasblt, p.remessa_gerada
  FROM apagar p
  LEFT JOIN bancos b      ON b.codbco = p.codbco
  LEFT JOIN operadores o  ON o.codoperador = p.codoperador
  LEFT JOIN parceiros f   ON f.codparceiro = p.codparceiro
  LEFT JOIN empresas e    ON e.idempresa = p.codempresa
  LEFT JOIN nf n          ON n.codnf = p.idnf
  LEFT JOIN (SELECT c.codgrupo, l.desccodplc FROM cx_apagar c LEFT JOIN plc l ON l.codplc = c.codcc) cen ON cen.codgrupo = p.codgrupo
 WHERE p.quitada = 'N' AND coalesce(p.adcredito, 'N') = 'N' AND coalesce(p.agrupado, 'N') = 'N';
COMMENT ON VIEW get_apagar_cen IS 'CONTAS A PAGAR CENTRO DE CUSTO';

CREATE OR REPLACE VIEW get_pedido_distribuidor (nropedido, codcliente, cliente, fantasiacliente, nromapa, data, uf, cidade, qtde, total_carga,
                                                codvendedor, vendedor, total_liquido, qtde_estoque, nronf, codcliente_end, tipo, obs_entrega,
                                                codempresa, origem) AS
SELECT p.nropedido, p.codparceiro, ps.razao, ps.fantasia, p.nromapa, p.dtvenda::date, pe.uf, pe.cidade, sum(p.qtde),
       sum(coalesce(p.qtde, 0) * coalesce(p.fatoremb, 1) * (coalesce(pr.taraembalagem, 0) + coalesce(pr.peso, 0))),
       p.codvendedor, pp.fantasia,
       sum(p.qtde * coalesce(p.fatoremb, 1) * (p.vrvenda + p.desc_acre_item)) + coalesce(avg(p.desc_acre), 0),
       sum(e.qtde), n.nronf, p.codparceiro_end, p.tipo, p.obs_entrega, p.idempresa, p.origem
  FROM pedidos p
  JOIN parceiros cli          ON cli.codparceiro = p.codparceiro
  LEFT JOIN parceiros_end pe  ON pe.codend = p.codparceiro_end AND coalesce(pe.ativado, 'S') = 'S'
  LEFT JOIN produtos pr       ON pr.idproduto = p.codproduto
  LEFT JOIN parceiros pp      ON pp.codparceiro = p.codvendedor
  LEFT JOIN parceiros ps      ON ps.codparceiro = p.codparceiro
  LEFT JOIN estoque e         ON e.idproduto = pr.idproduto AND e.idempresa = p.idempresa
  LEFT JOIN pedido_nf pn      ON pn.codpedido = p.codpedidos
  LEFT JOIN nf n              ON n.codnf = pn.codnf
 WHERE coalesce(p.cancelado, 'N') = 'N'
 GROUP BY p.nropedido, p.codparceiro, ps.razao, ps.fantasia, p.nromapa, pe.uf, pe.cidade, p.dtvenda::date, p.codvendedor, pp.fantasia, n.nronf,
          p.codparceiro_end, p.tipo, p.obs_entrega, p.idempresa, p.origem;
COMMENT ON VIEW get_pedido_distribuidor IS 'PEDIDO DISTRIBUIDOR';

-- (a lista de colunas manda: STUNITARIO recebe o TIPO da nota, STCAIXA o ST unitário e TIPO o ST do item)
CREATE OR REPLACE VIEW get_nfrelat (codbarra, stunitario, stcaixa, tipo, nronf, dtemissao, dtcontabil, dtfatura, parceiro, processada, cancelada, impressa,
                                    descricao, modelo, serie, tipo_frete, idempresa, codigo_contabil, cfop_nota, chave_acesso, codnfprod, codproduto,
                                    unidade, vrcusto, vrcustoreal, quantidade, vrvenda, fator_embalagem, cfop_produto, icme, ipi, icms, total_nf,
                                    total_produtos, total_frete, total_icm, total_ipi, total_acessorias, total_icmst, total_repasse, total_outros,
                                    total_isento, total_produtosst, total_baseicm, total_desconto, total_baseicmst, total_outras_desp, total_seguro,
                                    total_desc_final, custo_unitario, qtde_total, departamento, grupo, subgrupo, codnf, desc_cancelada) AS
SELECT pro.codbarra, nf.tipo, (np.vricmst / nullif(np.quantidade * np.fatorembal, 0))::numeric(13,2), np.vricmst, nf.nronf, nf.dtemissao, nf.dtcontabil,
       nf.dtchegada, p.razao, nf.proc, nf.cancelada, nf.printsucess, np.descricao, nf.modelo, nf.serie, nf.tipofrete, nf.idempresa, nf.codcontabil,
       CASE WHEN nf.cfop ~ '^\d+$' THEN nf.cfop::numeric END, nf.chavenfe, np.codnfprod, np.codproduto, np.unidade, np.vrcusto, np.vrcustoreal,
       np.quantidade, np.vrvenda, np.fatorembal, np.cfop, np.icme, np.ipi, np.icms, nf.totalnf, nf.totalprod, nf.totalfrete, nf.totalicm, nf.totalipi,
       nf.totalacessorias, nf.totalicm_st, nf.totalrepicm, nf.totalvroutros, nf.totalisento, nf.totalprodst, nf.totalbaseicm, nf.totaldesc,
       nf.totalbaseicmt, nf.totaloutrasdesp, nf.totalseguro, nf.totaldescfinal, np.vrcusto / nullif(np.fatorembal, 0), np.quantidade * np.fatorembal,
       d.descricao, g.descricao, sg.descricao, nf.codnf, CASE nf.cancelada WHEN 'S' THEN 'CANCELADA' END
  FROM nf
  LEFT JOIN nf_prod np        ON np.codnf = nf.codnf
  LEFT JOIN produtos pro      ON pro.idproduto = np.codproduto
  LEFT JOIN familias_prod d   ON d.codfamilia = pro.coddpto
  LEFT JOIN familias_prod g   ON g.codfamilia = pro.codgrupo
  LEFT JOIN familias_prod sg  ON sg.codfamilia = pro.codsubgrupo
  LEFT JOIN parceiros p       ON p.codparceiro = nf.codparceiro;
COMMENT ON VIEW get_nfrelat IS 'NOTAS FISCAIS;';

CREATE OR REPLACE VIEW get_padre_resumo_venda (codnf, nronf, codparceiro, cliente, dtemissao, totalprodutos, desconto, totalnf, totalfuturo, codvendedor,
                                               vendedor, tipo, venda, cfop, operacao) AS
SELECT n.codnf, n.nronf, n.codparceiro, p.razao, n.dtemissao, n.totalprod, n.totaldesc, n.totalnf, n.totalfuturo, n.codvendedor, v.fantasia, n.tipo,
       c.descricao, CASE WHEN n.cfop ~ '^\d+$' THEN n.cfop::numeric END, n.operacao
  FROM (SELECT codnf, codparceiro, nronf, serie, dtemissao, codvendedor, cfop, tipo,
               CASE WHEN cfop IN ('6910', '5910', '6116', '5116') THEN 0 ELSE totalnf END AS totalnf,
               CASE WHEN cfop IN ('6910', '5910', '6116', '5116') THEN 0 ELSE totaldesc END AS totaldesc,
               CASE WHEN cfop IN ('6910', '5910', '6116', '5116') THEN 0 ELSE totalprod END AS totalprod,
               CASE WHEN cfop IN ('6116', '5116') THEN totalnf ELSE 0 END AS totalfuturo,
               cancelada, statusnfe, 'VENDA' AS operacao
          FROM nf WHERE tipo = 'S'
        UNION
        SELECT d.codnf, nr.codparceiro, nr.nronf, nr.serie, nr.dtemissao, nr.codvendedor, nr.cfop, nr.tipo, nr.totalnf * -1, nr.totaldesc * -1,
               nr.totalprod * -1, 0, nr.cancelada, nr.statusnfe, 'DEVOLUCAO'
          FROM nf d
          LEFT JOIN nf_referencia r ON r.codnf = d.codnf
          LEFT JOIN nf nr           ON nr.codnf = r.codnf_ref
         WHERE d.cfop IN (SELECT trim(codcfop) FROM cfop WHERE devolucao = 'S')) n
  LEFT JOIN parceiros p ON p.codparceiro = n.codparceiro
  LEFT JOIN parceiros v ON v.codparceiro = n.codvendedor
  LEFT JOIN cfop c      ON trim(c.codcfop) = n.cfop
 WHERE n.cancelada = 'N' AND coalesce(n.statusnfe, 'N') = 'P' AND n.cfop NOT IN ('6949', '5949');
COMMENT ON VIEW get_padre_resumo_venda IS 'PADRE - RESUMO POR VENDEDOR';

CREATE OR REPLACE VIEW get_apagar_agrupar (nr_documento, fornecedor, valor, emissao, vencimento, data_contabil, juros, nota_fiscal, tipo_documento, banco,
                                           observacao, codigo_empresa, empresa, operador, codigo, codigo_parceiro, nr_parcela, vendor, convenio, codbco,
                                           quitada, idnf, gerado, nrodup, codoperador, idempresa, codcentrocusto, fantasia, descontopedido, desconto,
                                           valor_bruto, issqn, valorissqn, descricao, idlote, adfornecedor, contabilizado, codapg_pai, dtcadastro, form,
                                           operacao_convenio_funcionario, codplcfuncionarios, codcxagrupamentocr, status_pendencia,
                                           codoperador_aceite_pendencia, data_aceite_pendencia, codconvenio, dtcompra, dtvenc, gfat, geradocartaoproprio,
                                           codapgcartao, adcredito, contabilnf, origem, codgrupo_fcx, funrural, agrupamento, agrupado) AS
SELECT p.duplicata, f.razao, (p.valor + coalesce(p.vendor, 0) - coalesce(p.desconto, 0))::numeric(13,2), p.dtcompra, p.dtvenc::date,
       coalesce(n.dtcontabil, p.dtcompra), coalesce(p.txjuros, 0), n.nronf, p.tipodoc, b.banco, p.obs, p.codempresa, e.razao_social, o.nome,
       p.codapg, p.codparceiro, p.nrparcela, p.vendor, p.convenio, b.codbco, p.quitada, p.idnf, p.gerado, p.nrodup, p.codoperador, p.codempresa,
       p.codcentrocusto, f.fantasia, f.desconto_pedidos, p.desconto, p.valor, n.issqn, n.valorissqn,
       (SELECT g.descricao FROM plc g JOIN cx_apagar a ON a.codcc = g.codplc WHERE a.codgrupo = p.codgrupo ORDER BY a.codcxapagar LIMIT 1),
       p.idlote, p.adfornecedor, p.contabilizado, p.codapg_pai, p.dtcadastro, p.form, p.operacao_convenio_funcionario, p.codplcfuncionarios,
       p.codcxagrupamentocr, p.status_pendencia, p.codoperador_aceite_pendencia, p.data_aceite_pendencia, p.codconvenio, p.dtcompra, p.dtvenc,
       p.gfat, p.geradocartaoproprio, p.codapgcartao, p.adcredito, p.contabilnf, p.origem, p.codgrupo_fcx, f.habilita_retencao_funrural_nf,
       p.agrupamento, p.agrupado
  FROM apagar p
  LEFT JOIN bancos b      ON b.codbco = p.codbco
  LEFT JOIN operadores o  ON o.codoperador = p.codoperador
  LEFT JOIN parceiros f   ON f.codparceiro = p.codparceiro
  LEFT JOIN empresas e    ON e.idempresa = p.codempresa
  LEFT JOIN nf n          ON n.codnf = p.idnf
 WHERE coalesce(p.quitada, 'N') = 'N' AND coalesce(p.agrupado, 'N') = 'N';
COMMENT ON VIEW get_apagar_agrupar IS 'CONTAS A PAGAR PARA AGRUPAMENTO';

CREATE OR REPLACE VIEW get_produtos_codigo_auxiliar (codauxiliar, codbarra, descricao, vrvenda, vrcusto, custo_total, ativo, ativo_compra, comissao,
                                                     fornecedor, departamento, grupo, subgrupo, unidade, markup, codfor, aliquota, balanca, promocao,
                                                     vrpromo, pis, tipopis, fatorkg, fatorcx, codbalanca, descmax, especificacao, composicao, codigo,
                                                     cod_grupo, cod_subgrupo, data_alteracao, vrcusto_final, data_alteracao_preco, idempresa) AS
WITH valor_config AS (
  SELECT c.codigo, coalesce(ce.valor, c.valor) AS valor
    FROM configuracoes c LEFT JOIN configuracoes_especificas ce ON ce.id = c.id
   WHERE c.codigo = 'ATIVO_PELA_MULTIPRECO'
)
SELECT ca.codauxiliar, pro.codbarra, pro.descricao, p.vrvenda, p.vrcusto, p.vrcustoreal,
       CASE WHEN vc.valor = 'S' THEN coalesce(p.ativo, 'S') ELSE coalesce(pro.ativo, 'S') END,
       CASE WHEN vc.valor = 'S' THEN coalesce(p.ativo_compra, 'S') ELSE coalesce(pro.ativo_compra, 'S') END,
       pro.comissao, f.razao, d.descricao, g.descricao, sg.descricao, pro.unidade, p.markup, pro.codfor, pro.aliquota, pro.balanca, p.promocao,
       p.vrpromo, pro.pis, pro.tipopis, pro.fatorkg, pro.fatorcx, pro.codbalanca, pro.descmax, pro.especificacao, pro.composicao, pro.idproduto,
       pro.codgrupo, pro.codsubgrupo, pro.dtultimalteracao::date, p.vrcustoreal, p.dtultprecoalterado::date, p.idempresa
  FROM multi_preco p
  LEFT JOIN produtos pro      ON pro.idproduto = p.idproduto
  LEFT JOIN familias_prod d   ON d.codfamilia = pro.coddpto
  LEFT JOIN familias_prod g   ON g.codfamilia = pro.codgrupo
  LEFT JOIN familias_prod sg  ON sg.codfamilia = pro.codsubgrupo
  LEFT JOIN parceiros f       ON f.codparceiro = pro.codfor
  JOIN codauxiliar ca         ON ca.codbarra = pro.codbarra
  LEFT JOIN valor_config vc   ON vc.codigo = 'ATIVO_PELA_MULTIPRECO';
COMMENT ON VIEW get_produtos_codigo_auxiliar IS 'CODIGO AUXILIAR';

CREATE OR REPLACE VIEW get_produtos_atualizacao (codbarra, descricao, grupo, subgrupo, depto, fornecedor, idproduto, codgrupo, codfor, codsubgrupo,
                                                 codsecao, aliquotasaida, unidade, balanca, vr_custoreal, vrcustorep, vr_custo, markup, vr_venda,
                                                 promocao, vr_promo, pis, tipopis, coddpto, fatorkg, fatorcx, codbalanca, descmax, especificacao,
                                                 composicao, icme, frete, seguro, despacessorio, icmst, ipi, dtultimalteracao, codoperador, comissao,
                                                 ativo, validade, usultalteracao, idpiscofins, empresa, codfigurafiscal, ncmsh, naturezaicms, markupfixo,
                                                 codgrupopreco, lucroliqp, compqtde, compfator, estoque_maximo, estoque_minimo, cest, cest_obrigatorio,
                                                 descfigurafiscal, ativo_compra, atacado, codsetorarmazen, cod_benef_fiscal, codfcp, qtde_almoxarifado,
                                                 qtde_dep, qtde, codclass_trib, fator_filho, idproduto_pai) AS
SELECT pr.codbarra, pr.descricao, g.descricao, s.descricao, d.descricao, pa.razao, pr.idproduto, pr.codgrupo, pr.codfor, pr.codsubgrupo, pr.codsecao,
       p.aliquotasaida, pr.unidade, pr.balanca, p.vrcustoreal, p.vrcustorep, p.vrcusto, p.markup, p.vrvenda, p.promocao, p.vrpromo, pr.pis, p.tipopis,
       pr.coddpto, pr.fatorkg, pr.fatorcx, pr.codbalanca, pr.descmax, pr.especificacao, pr.composicao, p.icme, p.frete, p.seguro, p.despacessorio,
       p.icmst, p.ipi, pr.dtultimalteracao::date, pr.codoperador, pr.comissao, p.ativo, pr.validade, pr.usultalteracao, p.idpiscofins, p.idempresa,
       p.codfigurafiscal, pr.ncmsh, p.idtabela, p.markupfixo, pr.codgrupopreco, p.lucroliqp, pr.compqtde, pr.compfator, e.maximo, e.minimo, pr.cest,
       pr.cest_obrigatorio, ff.descfigurafiscal, p.ativo_compra, pr.atacado, pr.codsetorarmazen, pr.cod_benef_fiscal, pr.codfcp, e.qtde_almoxarifado,
       ed.qtde, e.qtde, pr.codclass_trib, pr.fator_filho, pr.idproduto_pai
  FROM produtos pr
  LEFT JOIN multi_preco p     ON p.idproduto = pr.idproduto
  LEFT JOIN parceiros pa      ON pa.codparceiro = pr.codfor
  LEFT JOIN familias_prod g   ON g.codfamilia = pr.codgrupo
  LEFT JOIN familias_prod s   ON s.codfamilia = pr.codsubgrupo
  LEFT JOIN familias_prod d   ON d.codfamilia = pr.coddpto
  LEFT JOIN estoque e         ON e.idproduto = pr.idproduto AND e.idempresa = p.idempresa
  LEFT JOIN estoque_dep ed    ON ed.idproduto = pr.idproduto AND ed.idempresa = p.idempresa
  LEFT JOIN figura_fiscal ff  ON ff.codfigurafiscal = pr.codfigurafiscal;
COMMENT ON VIEW get_produtos_atualizacao IS 'Produtos Atualizacao';

-- (HORA é o dia truncado, como no legado)
CREATE OR REPLACE VIEW get_pedidosrelat (nropedido, cliente, cod_barra, vr_custo, vr_venda, quantidade, promocao, descricao, unidade, aliquota,
                                         codigo_operador, operador, iditem, departamento, grupo, sub_grupo, comissao, vendedor, desc_acre, pis, idempresa,
                                         codvendas, data_hora, data, hora, desc_item, nro_cupom, tipo, codigo_vendedor, cancelado, codigo_produto,
                                         codigo_fornecedor, razao_fornecedor, liquidado, dt_primeiro_faturamento, total) AS
SELECT v.nropedido, v.cliente, p.codbarra, coalesce(v.vrcusto, 0), coalesce(v.vrvenda, 0), coalesce(v.qtde, 0), v.promocao, v.descricao, v.unidade,
       v.aliquota, o.codoperador, o.nome, v.nroitem, d.descricao, g.descricao, sg.descricao, v.comissao, ve.razao, coalesce(v.desc_acre, 0), v.pis,
       v.idempresa, v.codpedidos, v.dtvenda, v.dtvenda::date, v.dtvenda::date, coalesce(v.desc_acre_item, 0), 0, v.tipo, v.codvendedor, v.cancelado,
       p.idproduto, f.codparceiro, f.razao, v.processo_liquidado, v.dt_fatu,
       sum(v.qtde * (v.vrvenda + v.desc_acre_item)) + avg(v.desc_acre)
  FROM pedidos v
  LEFT JOIN parceiros c      ON c.codparceiro = v.codparceiro
  LEFT JOIN parceiros ve     ON ve.codparceiro = v.codvendedor
  LEFT JOIN operadores o     ON o.codoperador = v.operador
  LEFT JOIN produtos p       ON p.idproduto = v.codproduto
  LEFT JOIN parceiros f      ON f.codparceiro = p.codfor
  LEFT JOIN familias_prod d  ON d.codfamilia = v.coddpto
  LEFT JOIN familias_prod g  ON g.codfamilia = v.codgrupo
  LEFT JOIN familias_prod sg ON sg.codfamilia = v.codsubgrupo
 GROUP BY v.nropedido, v.cliente, p.codbarra, coalesce(v.vrcusto, 0), coalesce(v.vrvenda, 0), coalesce(v.qtde, 0), v.promocao, v.descricao, v.unidade,
          v.aliquota, o.codoperador, o.nome, v.nroitem, d.descricao, g.descricao, sg.descricao, v.comissao, ve.razao, coalesce(v.desc_acre, 0), v.pis,
          v.idempresa, v.codpedidos, v.dtvenda, coalesce(v.desc_acre_item, 0), v.tipo, v.codvendedor, v.cancelado, p.idproduto, f.codparceiro,
          f.razao, v.processo_liquidado, v.dt_fatu;
COMMENT ON VIEW get_pedidosrelat IS 'PEDIDOS;';

CREATE OR REPLACE VIEW get_produtos_site (idproduto, idempresa, codbarra, descricao, descricao_resumida, descricao_web, comeco_descricao_web, vrvenda,
                                          promocao, vrpromocao, vrdescpreco2, tpdescpreco2, unidade, qtde_estoque, ativo, secao, departamento, grupo,
                                          subgrupo, cod_secao, cod_departamento, cod_grupo, cod_subgrupo) AS
SELECT pro.idproduto, p.idempresa, pro.codbarra, pro.descricao, pro.descricao, pro.descricao, substr(pro.descricao, 1, 1), p.vrvenda, p.promocao,
       p.vrpromo, p.vrdescpreco2, pro.tpdescpreco2, pro.unidade, coalesce(e.qtde, 0) + coalesce(ed.qtde, 0),
       CASE WHEN (SELECT coalesce(ce.valor, c.valor) FROM configuracoes c LEFT JOIN configuracoes_especificas ce ON ce.id = c.id
                   WHERE c.codigo = 'ATIVO_PELA_MULTIPRECO' LIMIT 1) = 'S' THEN coalesce(p.ativo, 'S') ELSE coalesce(pro.ativo, 'S') END,
       sc.descricao, d.descricao, g.descricao, sg.descricao, pro.codsecao, pro.coddpto, pro.codgrupo, pro.codsubgrupo
  FROM multi_preco p
  JOIN produtos pro           ON pro.idproduto = p.idproduto
  LEFT JOIN familias_prod d   ON d.codfamilia = pro.coddpto
  LEFT JOIN familias_prod g   ON g.codfamilia = pro.codgrupo
  LEFT JOIN familias_prod sg  ON sg.codfamilia = pro.codsubgrupo
  LEFT JOIN familias_prod sc  ON sc.codfamilia = pro.codsecao
  LEFT JOIN estoque e         ON e.idproduto = pro.idproduto AND e.idempresa = p.idempresa
  LEFT JOIN estoque_dep ed    ON ed.idproduto = pro.idproduto AND ed.idempresa = p.idempresa
 WHERE p.idempresa IN (4, 5, 6) AND coalesce(pro.vende_site, 'N') = 'S';
COMMENT ON VIEW get_produtos_site IS 'PRODUTOS SITE';

CREATE OR REPLACE VIEW get_inventario_rotativo_itens (lote, descricao, codproduto, produto, codbarra, codempresa, destino, quantidade_anterior,
                                                      quantidade_atual, quantidade_diferenca, quantidade_estoque, quantidade_estoque_dep, vrcusto,
                                                      vrvenda, depto, grupo, subgrupo, cod_dpto, cod_grupo, cod_subgrupo, ativo, ativo_compra) AS
SELECT c2.lote, c2.nomelote, c2.idproduto, c2.descricao, c2.codbarra, c2.idempresa, c2.destino, c2.qtd_ant, c2.qtd_atual, c2.qtd_atual - c2.qtd_ant,
       b.qtde, de.qtde, m.vrcusto, m.vrvenda, d.descricao, g.descricao, sg.descricao, p.coddpto, p.codgrupo, p.codsubgrupo, p.ativo, p.ativo_compra
  FROM (SELECT curr.*,
               (SELECT ii.qtd_anterior FROM inventario_rotativo ii
                 WHERE ii.codinv_rotativo = (SELECT min(iii.codinv_rotativo) FROM inventario_rotativo iii
                                              WHERE iii.idproduto = curr.idproduto AND iii.lote = curr.lote AND iii.operacao = 'SUBSTITUIR')) AS qtd_ant,
               (SELECT ii.qtd_atual FROM inventario_rotativo ii
                 WHERE ii.codinv_rotativo = (SELECT max(iii.codinv_rotativo) FROM inventario_rotativo iii
                                              WHERE iii.idproduto = curr.idproduto AND iii.lote = curr.lote
                                                AND iii.operacao IN ('SUBSTITUIR', 'AUMENTAR'))) AS qtd_atual
          FROM (SELECT i.lote, i.nomelote, i.idproduto, pr.descricao, pr.codbarra, i.idempresa, i.destino
                  FROM inventario_rotativo i JOIN produtos pr ON pr.idproduto = i.idproduto
                 WHERE i.operacao <> 'FECHADO'
                 GROUP BY i.lote, i.nomelote, i.data::date, i.idempresa, i.idproduto, pr.descricao, pr.codbarra, i.destino) curr) c2
  LEFT JOIN multi_preco m     ON m.idproduto = c2.idproduto AND m.idempresa = c2.idempresa
  LEFT JOIN estoque b         ON b.idproduto = c2.idproduto AND b.idempresa = c2.idempresa
  LEFT JOIN estoque_dep de    ON de.idproduto = c2.idproduto AND de.idempresa = c2.idempresa
  LEFT JOIN produtos p        ON p.idproduto = c2.idproduto
  LEFT JOIN familias_prod d   ON d.codfamilia = p.coddpto
  LEFT JOIN familias_prod g   ON g.codfamilia = p.codgrupo
  LEFT JOIN familias_prod sg  ON sg.codfamilia = p.codsubgrupo;
COMMENT ON VIEW get_inventario_rotativo_itens IS 'INVENTARIO ROTATIVO ITENS';

CREATE OR REPLACE VIEW get_produtos_sitemercado (id_loja, departamento, categoria, subcategoria, marca, unidade, volume, codigo_barra, nome, dt_cadastro,
                                                 dt_ultima_alteracao, vlr_produto, vlr_promocao, qtd_estoque_atual, qtd_estoque_minimo, descricao, ativo,
                                                 plu, vlr_compra, validade_proxima) AS
SELECT p.idempresa, d.descricao, g.descricao, sg.descricao, mr.descricao, pro.unidade, pro.quantidade, pro.codbarra, pro.descricao, pro.dtcadastro,
       pro.dtultimalteracao, p.vrvenda, CASE WHEN p.promocao = 'S' THEN coalesce(p.vrpromo, 0) ELSE 0 END,
       CASE WHEN coalesce(e.qtde, 0) > 0 THEN e.qtde ELSE 0 END + CASE WHEN coalesce(ed.qtde, 0) > 0 THEN e.qtde ELSE 0 END,
       coalesce(e.minimo, 0) + coalesce(ed.minimo, 0), pro.descricao,
       CASE WHEN (SELECT coalesce(ce.valor, c.valor) FROM configuracoes c LEFT JOIN configuracoes_especificas ce ON ce.id = c.id
                   WHERE c.codigo = 'ATIVO_PELA_MULTIPRECO' LIMIT 1) = 'S' THEN coalesce(p.ativo, 'S') ELSE coalesce(pro.ativo, 'S') END,
       p.idproduto, p.vrcustorep, 'N'::char(1)
  FROM multi_preco p
  JOIN produtos pro           ON pro.idproduto = p.idproduto
  LEFT JOIN familias_prod d   ON d.codfamilia = pro.coddpto
  LEFT JOIN familias_prod g   ON g.codfamilia = pro.codgrupo
  LEFT JOIN familias_prod sg  ON sg.codfamilia = pro.codsubgrupo
  LEFT JOIN marcas mr         ON mr.idmarca = pro.idmarca
  LEFT JOIN estoque e         ON e.idproduto = pro.idproduto AND e.idempresa = p.idempresa
  LEFT JOIN estoque_dep ed    ON ed.idproduto = pro.idproduto AND ed.idempresa = p.idempresa
 WHERE coalesce(pro.vende_site, 'N') = 'S';
COMMENT ON VIEW get_produtos_sitemercado IS 'PRODUTOS SITE MERCADO';

CREATE OR REPLACE VIEW get_saldo_empresa (emissao, vencimento, codparceiro, razao, baixado, valor, valor_pago, idempresa, movimentacao) AS
SELECT emissao, vencimento, codparceiro, razao, baixado, valor, CASE baixado WHEN 'S' THEN valor_pago ELSE 0 END, idempresa, movimentacao
  FROM (SELECT r.dtvenda::date AS emissao, r.dtvenc::date AS vencimento, p.codparceiro, p.razao, r.quitada::varchar AS baixado, r.valor,
               coalesce(bx.valorpg, 0) AS valor_pago, r.codempresa AS idempresa, 'A RECEBER'::varchar(30) AS movimentacao
          FROM areceber r LEFT JOIN areceber_bx bx ON bx.codrcb = r.codrcb LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro
        UNION ALL
        SELECT c.dtemissao::date, c.bompara::date, p.codparceiro, p.razao, c.baixado, c.valor, c.valor, c.idempresa, 'CHEQUE A RECEBER'::varchar(30)
          FROM cheque c LEFT JOIN parceiros p ON p.codparceiro = c.codparceiro
        UNION ALL
        SELECT cp.dtemissao::date, cp.dtvenc::date, p.codparceiro, p.razao, cp.baixado, abs(cp.valor) * -1, abs(cp.valor) * -1, cp.idempresa,
               'CHEQUE PROPRIO'::varchar(30)
          FROM chq_proprio cp LEFT JOIN parceiros p ON p.codparceiro = cp.codparceiro
        UNION ALL
        SELECT a.dtcompra, a.dtvenc::date, pe.codparceiro, pe.razao, a.quitada, abs(a.valor) * -1, coalesce(abs(abx.valorpg) * -1, 0), a.codempresa,
               'A PAGAR'::varchar(30)
          FROM apagar a LEFT JOIN apagar_bx abx ON abx.codapg = a.codapg LEFT JOIN parceiros pe ON pe.codparceiro = a.codparceiro
        UNION ALL
        SELECT ca.dtvenda::date, (ca.dtvenda + make_interval(days => (coalesce(o.diascomp, 0) * coalesce(ca.nroparcela, 1))::int))::date, 0::numeric(10),
               NULL, ca.liberado, ca.valor - (ca.valor * coalesce(o.txadm, 0.1) / 100), ca.valor - (ca.valor * coalesce(o.txadm, 0.1) / 100),
               ca.idempresa, 'CARTAO'::varchar(30)
          FROM cartao ca LEFT JOIN operadoras o ON o.codoperadoras = ca.codoperadora) t;
COMMENT ON VIEW get_saldo_empresa IS 'SALDO DA EMPRESA';

CREATE OR REPLACE VIEW get_contas_baixadas (emissao, pagamento, valor, titular, lote, documento, empresa, historico, tipo, ordem, tipo_extenso,
                                            codlanccontabil, codcontabil_for, acre_desc, juros) AS
SELECT m.dtemissao::date, m.dtemissao::date, m.valor, coalesce(cb.titular, pc.descricao), m.idlote, m.nrodocumento, cb.idempresa, m.historico, 1, 1,
       'MOV. BAIXA RECEBER', cb.codlanccontabil, NULL::varchar, 0, 0
  FROM mov_contas_bancarias m
  JOIN contas_bancarias cb   ON cb.codconta = m.codconta
  LEFT JOIN plano_contas pc  ON pc.codplanocontas = CASE WHEN cb.codlanccontabil ~ '^\s*\d+\s*$' THEN trim(cb.codlanccontabil)::integer END
 WHERE m.idlote IN (SELECT idlote FROM areceber_bx)
UNION ALL
SELECT r.dtvenda::date, bx.dtpgto::date, bx.valorpg, p.razao, bx.idlote, r.duplicata, r.codempresa, trim(r.obs), 1, 2, 'CONTAS A RECEBER', NULL,
       p.codcontabil_for, bx.acre_desc, bx.juros
  FROM areceber r JOIN parceiros p ON p.codparceiro = r.codparceiro JOIN areceber_bx bx ON bx.codrcb = r.codrcb
UNION ALL
SELECT m.dtemissao::date, m.dtemissao::date, m.valor, coalesce(cb.titular, pc.descricao), m.idlote, m.nrodocumento, cb.idempresa, m.historico, 2, 1,
       'MOV. BAIXA PAGAR', cb.codlanccontabil, NULL, 0, 0
  FROM mov_contas_bancarias m
  JOIN contas_bancarias cb   ON cb.codconta = m.codconta
  LEFT JOIN plano_contas pc  ON pc.codplanocontas = CASE WHEN cb.codlanccontabil ~ '^\s*\d+\s*$' THEN trim(cb.codlanccontabil)::integer END
 WHERE m.idlote IN (SELECT idlote FROM apagar_bx)
UNION ALL
SELECT pa.dtcompra, pbx.dtpgto::date, pbx.valorpg, pe.razao, pbx.idlote, pa.duplicata, pa.codempresa, trim(pa.obs), 2, 2, 'CONTAS A PAGAR', NULL,
       pe.codcontabil_for, pbx.acre_desc, pbx.juros
  FROM apagar pa JOIN parceiros pe ON pe.codparceiro = pa.codparceiro JOIN apagar_bx pbx ON pbx.codapg = pa.codapg
 ORDER BY 9, 2, 5, 10;
COMMENT ON VIEW get_contas_baixadas IS 'CONTAS BAIXADAS';

CREATE OR REPLACE VIEW get_produtos_pc (codbarra, descricao, vrcusto, custo_reposicao, vrvenda, referencia, ativo, ativo_compra, comissao, fornecedor,
                                        departamento, grupo, subgrupo, unidade, markup, codfor, aliquota, balanca, promocao, vrpromo, pis, tipopis,
                                        fatorkg, fatorcx, codbalanca, descmax, especificacao, composicao, codigo, cod_grupo, cod_subgrupo,
                                        data_alteracao, custo_total, data_alteracao_preco, ncm, comeco_descricao, idempresa, data_cadastro,
                                        margem_calculada, grupo_preco, idpiscofins, despis, naturezapis, codauxiliar, icm_efetivo, creditopiscofins,
                                        icme, creditoicm, debitoicm, debitopiscofins, vendaliq, lucrobrutov, lucrobrutop, despopv, lucroliqv,
                                        lucroliqp, imprend, contsocial, margeml2v, margeml2, ipi, frete, despacessorio, seguro, icmst, uf,
                                        ativo_compra_mp, fcp_saida, cod_perfil_produto, perfil_produto, cod_perfil_departamento, perfil_departamento) AS
SELECT pro.codbarra, pro.descricao, p.vrcusto, p.vrcustorep, p.vrvenda, c.codref, pro.ativo, pro.ativo_compra, pro.comissao, f.razao, d.descricao,
       g.descricao, sg.descricao, pro.unidade, p.markup, pro.codfor, pro.aliquota, pro.balanca, p.promocao, p.vrpromo, pro.pis, pro.tipopis,
       pro.fatorkg, CASE WHEN coalesce(pro.fator_pedidocompra, 0) = 0 THEN pro.fatorcx ELSE pro.fator_pedidocompra END, pro.codbalanca, pro.descmax,
       pro.especificacao, pro.composicao, pro.idproduto, pro.codgrupo, pro.codsubgrupo, pro.dtultimalteracao::date, p.vrcustoreal,
       p.dtultprecoalterado::date, pro.ncmsh, substr(pro.descricao, 1, 1), p.idempresa, pro.dtcadastro::date,
       (CASE WHEN p.vrcusto > 0 THEN ((coalesce(p.vrvenda, 0) / coalesce(p.vrcusto, 0)) - 1) * 100 ELSE 0 END)::numeric(13,2),
       gp.descricao, pro.idpiscofins, i.descricao, t.descricao, a.codauxiliar, dt.icm_efetivo, p.creditopiscofins, p.icme, p.creditoicm, p.debitoicm,
       p.debitopiscofins, p.vendaliq, p.lucrobrutov, p.lucrobrutop, p.despopv, p.lucroliqv, p.lucroliqp, p.imprend, p.contsocial, p.margeml2v,
       p.margeml2, p.ipi, p.frete, p.despacessorio, p.seguro, p.icmst, dt.uf, p.ativo_compra, p.fcp_saida, pprod.codperfil, pprod.perfil,
       pdep.codperfil, pdep.perfil
  FROM multi_preco p
  JOIN produtos pro                   ON pro.idproduto = p.idproduto
  LEFT JOIN familias_prod d           ON d.codfamilia = pro.coddpto
  LEFT JOIN familias_prod g           ON g.codfamilia = pro.codgrupo
  LEFT JOIN familias_prod sg          ON sg.codfamilia = pro.codsubgrupo
  LEFT JOIN familias_prod gp          ON gp.codfamilia = pro.codgrupopreco
  LEFT JOIN parceiros f               ON f.codparceiro = pro.codfor
  LEFT JOIN codreferencia_for c       ON c.idproduto = pro.idproduto AND c.codfor = pro.codfor
  LEFT JOIN codauxiliar a             ON a.idproduto = p.idproduto
  LEFT JOIN piscofins i               ON i.idpiscofins = pro.idpiscofins
  LEFT JOIN pc_tipocreditoisento t    ON t.idtabela = pro.idtabela
  LEFT JOIN det_aliquota dt           ON dt.aliquota = pro.aliquota
  LEFT JOIN perfil pprod              ON pprod.codperfil = pro.codperfil_compra
  LEFT JOIN perfil pdep               ON pdep.codperfil = d.codperfil_compra;
COMMENT ON VIEW get_produtos_pc IS 'PRODUTOS PEDIDO DE COMPRA';

-- (os dias como no Oracle: FRAC = agora − vencimento em dias com fração; DIAS = hoje − dia do vencimento, inteiro)
CREATE OR REPLACE VIEW get_areceber_contabil (cliente, data_vencimento, data_venda, referencia, valor, txjuros, duplicata, dias_atrazo, dias_tolerancia,
                                              juro, total, codigo, nro_cupom, nro_nf, obs, vendedor, cobrador, operador, logado, nro_pedido, idempresa,
                                              gerado, tipo_documento, codigo_cliente, codigo_operador, codigo_cobrador, codigo_vendedor, codigo_grupo,
                                              pdv, idpgto, codconvenio, desconvenio, lote_cobranca, codbco, quitada, idnf, nrodup, codoperadorman, nrodoc,
                                              parcela, codcx, antecipado, somente_cliente, somente_funcionario, endereco_cobranca, bairro_cobranca,
                                              cidade_cobranca, uf_cobranca, telefone, data_lote_cobranca, registro_arq_remessa, nome_arq_remessa,
                                              login_arq_remessa, data_arq_remessa, ativado, conta_transferencia, data_transferencia, lote_transferencia,
                                              status_boleto, consiliado, dias_intervalo) AS
SELECT c.razao, r.dtvenc::date, r.dtvenda::date, c.codref, r.valor, r.txjuros, r.duplicata,
       (CASE WHEN d.frac < 0 THEN 0 ELSE round(d.frac) END)::numeric(10),
       coalesce(c.tolerancia, 0)::numeric(10),
       (CASE WHEN d.dias < c.tolerancia THEN 0
             ELSE coalesce((r.txjuros / 30::numeric(13,8))::numeric(13,2) * (CASE WHEN d.dias < 0 THEN 0 ELSE d.dias END)::numeric(10) * r.valor / 100, 0)::numeric(13,2)
        END)::numeric(13,2),
       (CASE WHEN d.frac < c.tolerancia THEN r.valor
             ELSE coalesce(r.txjuros / 30::numeric(13,8), 0) * coalesce((CASE WHEN d.frac < 0 THEN 0 ELSE round(d.frac) END)::numeric(10) * r.valor / 100, 0) + r.valor
        END)::numeric(13,2),
       r.codrcb, r.nrocupom, r.docnf, r.obs, v.razao, co.razao, o.nome, l.login, r.nropedido, r.codempresa, r.gerado, r.tipodoc, c.codparceiro,
       o.codoperador, co.codparceiro, v.codparceiro, r.codgrupo, r.codpdv, r.idpgto, c.codconvenio, x.razao, r.lotecob, r.codbco, r.quitada, r.idnf,
       r.nrodup, r.codoperadorman, r.nrodoc, r.parcela, r.codcx, r.antecipado, c.cli, c.fun, e.endereco, e.bairro, e.cidade, e.uf, e.telefone,
       r.datalotcob::date, r.registro_arq_remessa, r.nome_arq_remessa, r.login_arq_remessa, r.data_arq_remessa, c.ativado, r.codconta, r.datatransf,
       r.lotetransf, r.status_boleto, r.consiliado, r.dtvenda::date - r.dtvenc::date
  FROM areceber r
  CROSS JOIN LATERAL (SELECT extract(epoch FROM (localtimestamp - r.dtvenc::timestamp)) / 86400 AS frac,
                             (current_date - r.dtvenc::date) AS dias) d
  LEFT JOIN parceiros v       ON v.codparceiro = r.codvendedor
  LEFT JOIN parceiros co      ON co.codparceiro = r.codcobrador
  LEFT JOIN operadores o      ON o.codoperador = r.codoperador
  LEFT JOIN parceiros c       ON c.codparceiro = r.codparceiro
  LEFT JOIN operadores l      ON l.codoperador = r.codoperadorman
  LEFT JOIN parceiros x       ON x.codparceiro = c.codconvenio
  LEFT JOIN parceiros_end e   ON e.codend = c.codend;
COMMENT ON VIEW get_areceber_contabil IS 'A RECEBER CONTABIL';

CREATE OR REPLACE VIEW get_produtos_ref (codreferencia, codbarra, descricao, vrcusto, custo_reposicao, vrvenda, ativo, ativo_compra, comissao, fornecedor,
                                         departamento, grupo, subgrupo, secao, unidade, markup, codfor, aliquota, balanca, promocao, vrpromo, pis, tipopis,
                                         fatorkg, fatorcx, codbalanca, descmax, especificacao, composicao, codigo, cod_grupo, cod_subgrupo, cest,
                                         data_alteracao, custo_total, data_alteracao_preco, ncm, comeco_descricao, idempresa, data_cadastro,
                                         margem_calculada, grupo_preco, idpiscofins, despis, imprimircomp, cod_grupopreco, atacado, vrdescpreco2_mp,
                                         vrdescpreco2_pro, tpdescpreco2, qtde_estoque, qtde_deposito, qtde_total, produto_pai, descricao_resumida,
                                         descricao_web, quantidade) AS
WITH valor_config AS (
  SELECT c.codigo, coalesce(ce.valor, c.valor) AS valor
    FROM configuracoes c LEFT JOIN configuracoes_especificas ce ON ce.id = c.id
   WHERE c.codigo = 'ATIVO_PELA_MULTIPRECO'
)
SELECT a.codref, pro.codbarra, pro.descricao, p.vrcusto, p.vrcustorep, p.vrvenda,
       CASE WHEN vc.valor = 'S' THEN coalesce(p.ativo, 'S') ELSE coalesce(pro.ativo, 'S') END,
       CASE WHEN vc.valor = 'S' THEN coalesce(p.ativo_compra, 'S') ELSE coalesce(pro.ativo_compra, 'S') END,
       pro.comissao, f.razao, d.descricao, g.descricao, sg.descricao, sc.descricao, pro.unidade, p.markup, a.codfor, pro.aliquota, pro.balanca,
       p.promocao, p.vrpromo, pro.pis, pro.tipopis, pro.fatorkg, pro.fatorcx, pro.codbalanca, pro.descmax, pro.especificacao, pro.composicao,
       pro.idproduto, pro.codgrupo, pro.codsubgrupo, pro.cest, pro.dtultimalteracao::date, p.vrcustoreal, p.dtultprecoalterado::date, pro.ncmsh,
       substr(pro.descricao, 1, 1), p.idempresa, pro.dtcadastro::date,
       (CASE WHEN p.vrcusto > 0 THEN ((coalesce(p.vrvenda, 0) / coalesce(p.vrcusto, 0)) - 1) * 100 ELSE 0 END)::numeric(13,2),
       gp.descricao, pro.idpiscofins, i.descricao, coalesce(pro.imprimircomp, 'N'), pro.codgrupopreco, pro.atacado, p.vrdescpreco2, pro.vrdescpreco2,
       pro.tpdescpreco2, coalesce(e.qtde, 0), coalesce(ed.qtde, 0), coalesce(e.qtde, 0) + coalesce(ed.qtde, 0), pro.idproduto_pai,
       pro.descricao_resumida, pro.descricao_web, pro.quantidade
  FROM multi_preco p
  LEFT JOIN produtos pro          ON pro.idproduto = p.idproduto
  LEFT JOIN familias_prod d       ON d.codfamilia = pro.coddpto
  LEFT JOIN familias_prod g       ON g.codfamilia = pro.codgrupo
  LEFT JOIN familias_prod sg      ON sg.codfamilia = pro.codsubgrupo
  LEFT JOIN familias_prod gp      ON gp.codfamilia = pro.codgrupopreco
  LEFT JOIN familias_prod sc      ON sc.codfamilia = pro.codsecao
  JOIN codreferencia_for a        ON a.idproduto = p.idproduto
  JOIN parceiros f                ON f.codparceiro = a.codfor
  LEFT JOIN piscofins i           ON i.idpiscofins = pro.idpiscofins
  LEFT JOIN estoque e             ON e.idproduto = pro.idproduto AND e.idempresa = p.idempresa
  LEFT JOIN estoque_dep ed        ON ed.idproduto = pro.idproduto AND ed.idempresa = p.idempresa
  LEFT JOIN valor_config vc       ON vc.codigo = 'ATIVO_PELA_MULTIPRECO';
COMMENT ON VIEW get_produtos_ref IS 'PRODUTOS REF.';

CREATE OR REPLACE VIEW get_dre_caixa (lote, codigo_apagar, documento, idempresa, data, centro_custo, descricao_centro_custo, valor, nivel2_centro_custo,
                                      descricao_nivel2_centro_custo, nivel1_centro_custo, descricao_nivel1_centro_custo, obs, codparceiro, fornecedor) AS
SELECT a.idlote, g.codapg, g.duplicata, g.codempresa, a.dtpgto::date, p.desccodplc, p.descricao,
       abs((((a.valorpg * (c.valor * 100) / dv.divisor)) / 100) - ((coalesce(a.juros, 0) * ((c.valor * 100) / dv.divisor)) / 100)
           - ((coalesce(a.acre_desc, 0) * ((c.valor * 100) / dv.divisor)) / 100))::numeric(13,2),
       (SELECT pl.desccodplc FROM plc pl WHERE pl.codplc = p.codpai), (SELECT pl.descricao FROM plc pl WHERE pl.codplc = p.codpai),
       (coalesce(substr(p.desccodplc, 1, 1), '') || '.')::varchar(150),
       (SELECT pl.descricao FROM plc pl WHERE pl.desccodplc = coalesce(substr(p.desccodplc, 1, 1), '') || '.' ORDER BY pl.codplc LIMIT 1),
       coalesce(a.obs, '') || ' ' || coalesce(g.obs, ''), g.codparceiro, par.razao
  FROM apagar_bx a
  LEFT JOIN apagar g       ON g.codapg = a.codapg
  LEFT JOIN cx_apagar c    ON c.codgrupo = g.codgrupo
  LEFT JOIN plc p          ON p.codplc = c.codcc
  LEFT JOIN parceiros par  ON par.codparceiro = g.codparceiro
  CROSS JOIN LATERAL (SELECT CASE WHEN g.idnf > 0 THEN (SELECT CASE WHEN totalnf = 0 THEN 1 ELSE totalnf END FROM nf WHERE nf.codnf = g.idnf)
                                  ELSE (SELECT sum(w.valor) + sum(coalesce(w.vendor, 0)) FROM apagar w WHERE w.codgrupo = g.codgrupo) END AS divisor) dv
 WHERE p.desccodplc IS NOT NULL AND (g.obs LIKE '%%' OR p.descricao LIKE '%%')
UNION ALL
SELECT i.idlote, i.codcx, NULL, i.idempresa, i.data::date, p.desccodplc, p.descricao, abs(i.valor),
       (SELECT pl.desccodplc FROM plc pl WHERE pl.codplc = p.codpai), (SELECT pl.descricao FROM plc pl WHERE pl.codplc = p.codpai),
       (coalesce(substr(p.desccodplc, 1, 1), '') || '.')::varchar(150),
       (SELECT pl.descricao FROM plc pl WHERE pl.desccodplc = coalesce(substr(p.desccodplc, 1, 1), '') || '.' ORDER BY pl.codplc LIMIT 1),
       i.obs, i.codparceiro, par.razao
  FROM caixa i
  LEFT JOIN plc p          ON p.codplc = i.codplc
  LEFT JOIN parceiros par  ON par.codparceiro = i.codparceiro
 WHERE (i.obs LIKE 'REFERENTA A BAIXA A PAGAR DO LOTE%' OR i.obs LIKE 'REFERENTA A BAIXA DE CARTAO DO LOTE%' OR i.obs LIKE 'REF. JUROS PGTO LOTE%'
        OR i.obs LIKE 'REF. A BX CARTAO LOTE%' OR i.obs LIKE '%REFERENTE A PRODUCAO%')
   AND p.desccodplc IS NOT NULL;
COMMENT ON VIEW get_dre_caixa IS 'DRE CAIXA';

CREATE OR REPLACE VIEW get_produtos_estoque_comp (codbarra, descricao, vrcusto, custo_total, vrvenda, custo_reposicao, qtde, qtde_dep, ativo, departamento,
                                                  grupo, subgrupo, fornecedor, unidade, markup, codfor, aliquota, balanca, promocao, vrpromo, pis, tipopis,
                                                  fatorkg, fatorcx, codbalanca, descmax, especificacao, composicao, codigo, totalcusto, totalvenda, empresa,
                                                  empresa_estoque, empresa_estoque_dep, minimo, minimo_dep, cod_departamento, cod_grupo, cod_subgrupo,
                                                  local, servico, ativo_venda, ativo_compra, ativo_compra_mp, maximo, ncm, empresa_preco, icm_efetivo,
                                                  creditopiscofins, icme, creditoicm, debitoicm, debitopiscofins, vendaliq, lucrobrutov, lucrobrutop,
                                                  despopv, lucroliqv, lucroliqp, imprend, contsocial, margeml2v, margeml2, ipi, frete, despacessorio,
                                                  seguro, icmst, empresa01, empresa02, empresa03, empresa04, altera_descricao_cotacao, cod_perfil_produto,
                                                  perfil_produto, cod_perfil_departamento, perfil_departamento, imobilizado, uso_consumo,
                                                  digitos_codbarra, fatorcx_producao) AS
SELECT codbarra, descricao, vrcusto, custo_total, vrvenda, custo_reposicao, qtde, qtde_dep, ativo, departamento, grupo, subgrupo, fornecedor, unidade,
       markup, codfor, aliquota, balanca, promocao, vrpromo, pis, tipopis, fatorkg, fatorcx, codbalanca, descmax, especificacao, composicao, codigo,
       totalcusto, totalvenda, empresa, empresa_estoque, empresa_estoque_dep, minimo, minimo_dep, cod_departamento, cod_grupo, cod_subgrupo, local,
       servico, ativo_venda, ativo_compra, ativo_compra_mp, maximo, ncm, empresa_preco, icm_efetivo, creditopiscofins, icme, creditoicm, debitoicm,
       debitopiscofins, vendaliq, lucrobrutov, lucrobrutop, despopv, lucroliqv, lucroliqp, imprend, contsocial, margeml2v, margeml2, ipi, frete,
       despacessorio, seguro, icmst, empresa01, empresa02, empresa03, empresa04, altera_descricao_cotacao, cod_perfil_produto, perfil_produto,
       cod_perfil_departamento, perfil_departamento, imobilizado, uso_consumo, digitos_codbarra, fatorcx_producao
  FROM get_produtos_estoque;
COMMENT ON VIEW get_produtos_estoque_comp IS 'PRODUTOS E ESTOQUE COMPOSICAO';

CREATE OR REPLACE VIEW get_rel_rcb (cliente, data_vencimento, data_venda, referencia, valor, txjuros, duplicata, dias_atrazo, dias_tolerancia, juro, total,
                                    codigo, nro_cupom, nro_nf, obs, vendedor, cobrador, operador, logado, nro_pedido, idempresa, gerado, tipo_documento,
                                    codigo_cliente, codigo_operador, codigo_cobrador, codigo_vendedor, codigo_grupo, pdv, idpgto, codconvenio,
                                    desconvenio, lote_cobranca, codbco, quitada, idnf, nrodup, codoperadorman, nrodoc, parcela, codcx, antecipado,
                                    somente_cliente, somente_funcionario, endereco_cobranca, bairro_cobranca, cidade_cobranca, uf_cobranca, telefone,
                                    cnpj_cpf, data_lote_cobranca, registro_arq_remessa, nome_arq_remessa, login_arq_remessa, data_arq_remessa, ativado,
                                    plc, limite, consiliado, agrupamento, codplc, centrodecusto, descricao_centro_custos, codadiantamento, agrupado,
                                    codigo_situacao_documento, situacao_documento, data_pagamento, cliente_completo, txmulta, multa, tipo_multa) AS
SELECT c.razao, r.dtvenc::date, r.dtvenda::date, c.codref, r.valor, r.txjuros, r.duplicata,
       (CASE WHEN d.dias < 0 THEN 0 ELSE d.dias END)::numeric(10), coalesce(c.tolerancia, 0)::numeric(10),
       (CASE WHEN d.dias < c.tolerancia THEN 0 ELSE coalesce(d.taxa * (CASE WHEN d.dias < 0 THEN 0 ELSE d.dias END)::numeric(10) * r.valor / 100, 0)::numeric(13,2) END)::numeric(13,2),
       (CASE WHEN d.dias < c.tolerancia THEN r.valor
             ELSE coalesce(coalesce(d.taxa * (CASE WHEN d.dias < 0 THEN 0 ELSE d.dias END)::numeric(10) * r.valor / 100, 0)::numeric(13,2), 0) + r.valor + d.multa
        END)::numeric(13,2),
       r.codrcb, r.nrocupom, r.docnf, upper(replace(replace(r.obs, ';', ' '), chr(10), ' ')), v.razao, co.razao, o.nome, l.login, r.nropedido,
       r.codempresa, r.gerado, r.tipodoc, c.codparceiro, o.codoperador, co.codparceiro, v.codparceiro, r.codgrupo, r.codpdv, r.idpgto, c.codconvenio,
       x.razao, r.lotecob, r.codbco, r.quitada, r.idnf, r.nrodup, r.codoperadorman, r.nrodoc, r.parcela, r.codcx, r.antecipado, c.cli, c.fun,
       e.endereco, e.bairro, e.cidade, e.uf, e.telefone, e.cnpj_cpf, r.datalotcob::date, r.registro_arq_remessa, r.nome_arq_remessa,
       r.login_arq_remessa, r.data_arq_remessa, c.ativado, r.codplc, c.credito, r.consiliado, r.agrupamento, r.codplc, plc.desccodplc, plc.descricao,
       r.codadiantamento, coalesce(r.agrupado, 'N'), sn.descricao, r.idsituacao_nf, rbx.dtpgto::date,
       concat(c.codparceiro, ' - ', coalesce(c.fantasia, c.razao)), r.txmulta, d.multa, r.valor_perc_multa
  FROM areceber r
  LEFT JOIN parceiros v       ON v.codparceiro = r.codvendedor
  LEFT JOIN parceiros co      ON co.codparceiro = r.codcobrador
  LEFT JOIN operadores o      ON o.codoperador = r.codoperador
  LEFT JOIN parceiros c       ON c.codparceiro = r.codparceiro
  LEFT JOIN operadores l      ON l.codoperador = r.codoperadorman
  LEFT JOIN parceiros x       ON x.codparceiro = c.codconvenio
  LEFT JOIN parceiros_end e   ON e.codend = c.codend
  LEFT JOIN plc plc           ON plc.codplc = r.codplc
  LEFT JOIN situacao_nf sn    ON sn.idsituacao_nf = r.idsituacao_nf
  LEFT JOIN areceber_bx rbx   ON rbx.codrcb = r.codrcb AND coalesce(rbx.indr, 'I') <> 'E'
  CROSS JOIN LATERAL (SELECT (current_date - r.dtvenc::date) AS dias,
                             (r.txjuros / 30::numeric(13,8))::numeric(13,2) AS taxa,
                             (CASE WHEN (current_date - r.dtvenc::date) <= c.tolerancia THEN 0
                                   ELSE CASE WHEN r.valor_perc_multa = 'T' THEN r.txmulta::numeric(13,2)
                                             ELSE coalesce(r.txmulta::numeric(13,2) * r.valor / 100, 0)::numeric(13,2) END END)::numeric(13,2) AS multa) d
 WHERE r.quitada = 'N'
 ORDER BY c.codparceiro;
COMMENT ON VIEW get_rel_rcb IS 'A RECEBER ATRAZADA';

CREATE OR REPLACE VIEW get_saldo_parceiro (razao, fantasia, endereco, bairro, cidade, uf, telefone, celular, fax, cnpj_cpf, rg_insc, codparceiro,
                                           movimentacao, credito, saldo, bloqueado, codconvenio) AS
WITH base AS (
  SELECT p.codparceiro, p.razao, p.fantasia, p.bloqued, p.codconvenio, coalesce(p.credito, 0) AS credito, pe.endereco, pe.bairro, pe.cidade, pe.uf,
         pe.telefone, pe.celular, pe.fax, pe.cnpj_cpf, pe.rg_insc
    FROM parceiros p
    LEFT JOIN parceiros_end pe ON pe.codparceiro = p.codparceiro
   WHERE pe.codend = CASE coalesce(p.codend, 0)
                       WHEN 0 THEN (SELECT w.codend FROM parceiros_end w WHERE w.codparceiro = p.codparceiro ORDER BY w.codend LIMIT 1)
                       ELSE (SELECT w.codend FROM parceiros_end w WHERE w.codend = p.codend) END
)
SELECT razao, fantasia, endereco, bairro, cidade, uf, telefone, celular, fax, cnpj_cpf, rg_insc, codparceiro, sum(valor), credito,
       CASE credito WHEN 0 THEN 0 ELSE credito + sum(valor) END, bloqued, codconvenio
  FROM (SELECT b.*, coalesce((re.valor * -1)::numeric(13,2), 0) AS valor FROM areceber re JOIN base b ON b.codparceiro = re.codparceiro WHERE re.quitada <> 'S'
        UNION ALL
        SELECT b.*, coalesce((re.valor * -1)::numeric(13,2), 0) FROM apagar re JOIN base b ON b.codparceiro = re.codparceiro WHERE re.quitada <> 'S'
        UNION ALL
        SELECT b.*, coalesce((re.valor * -1)::numeric(13,2), 0) FROM cheque re JOIN base b ON b.codparceiro = re.codparceiro WHERE re.baixado <> 'S'
        UNION ALL
        SELECT b.*, CASE re.tipo WHEN 'D' THEN coalesce((re.valor * -1)::numeric(13,2), 0) ELSE coalesce(re.valor::numeric(13,2), 0) END
          FROM adiantamento_forn re JOIN base b ON b.codparceiro = re.codparceiro WHERE re.quitada <> 'S'
        UNION ALL
        SELECT b.*, 0::numeric(13,2) FROM base b) t
 GROUP BY razao, fantasia, endereco, bairro, cidade, uf, telefone, celular, fax, cnpj_cpf, rg_insc, codparceiro, credito, bloqued, codconvenio;
COMMENT ON VIEW get_saldo_parceiro IS 'SALDO DO PARCEIRO';

CREATE OR REPLACE VIEW get_nf_manifesto (numero_nf, data_emissao, total_nf, chave, cadastrada, codigo, cnpj_cpf, razao, importacao, processada, tipo,
                                         confirmacao, ciencia, naorealizada, desconhecimento, cancelamento, outros_eventos, idempresa, status_nfe, obs_nf,
                                         cnpj_emitente, processo_atual, contingencia, cfop, serie, vincula_ent_dev, cod_vincula_ent_dev, tipoemissao,
                                         data_contabil) AS
WITH janela AS (
  SELECT current_date - coalesce((SELECT ce.valor FROM configuracoes_especificas ce
                                   WHERE ce.id = (SELECT c.id FROM configuracoes c WHERE c.codigo = 'DIAS_RETROATIVOS_FILTRO_MANIFESTO' LIMIT 1)
                                   LIMIT 1), '90')::integer AS de,
         current_date AS ate
),
ev AS (
  SELECT chavenfe,
         bool_or(tipo_evento = 210200) AS confirmacao, bool_or(tipo_evento = 210210) AS ciencia, bool_or(tipo_evento = 210240) AS naorealizada,
         bool_or(tipo_evento = 210220) AS desconhecimento, bool_or(tipo_evento = 110111) AS cancelamento,
         bool_or(tipo_evento NOT IN (210200, 210210, 210240, 210220, 110111)) AS outros
    FROM nfe_evento GROUP BY chavenfe
)
SELECT n.nronf, n.dtemissao, n.totalnf, n.chavenfe, 'SIM'::char(3), n.codnf::numeric(10), e.cnpj_cpf, upper(p.razao), n.nf_importacao_nfe,
       CASE WHEN n.proc = 'S' THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END, CASE WHEN n.tipo = 'E' THEN 'ENTRADA' ELSE 'SAIDA' END,
       CASE WHEN ev.confirmacao THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END, CASE WHEN ev.ciencia THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END,
       CASE WHEN ev.naorealizada THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END, CASE WHEN ev.desconhecimento THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END,
       CASE WHEN ev.cancelamento THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END, CASE WHEN ev.outros THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END,
       n.idempresa::numeric(10),
       CASE WHEN n.statusnfe = 'P' AND n.tpemissao = 1 THEN 'NFE ENVIADA A RECEITA'
            WHEN n.statusnfe = 'P' AND n.tpemissao IN (6, 7) THEN 'NFE ENVIADA EM CONTINGENCIA'
            WHEN n.statusnfe = 'C' AND n.tpemissao = 1 THEN 'NFE CANCELADA NA RECEITA'
            WHEN n.statusnfe = 'C' AND n.tpemissao IN (6, 7) THEN 'NFE CANCELADA EM CONTINGENCIA'
            WHEN n.statusnfe = 'D' THEN 'NFE DENEGADA NA RECEITA' ELSE n.statusnfe::varchar END,
       nullif(n.obsnf, ''), em.cnpj,
       CASE WHEN n.codnfstatuspro IS NULL THEN ' - '
            ELSE (SELECT concat(nsp.processo_desc, ' - ', CASE nsp.status WHEN 'P' THEN 'Pendente' WHEN 'A' THEN 'Andamento' WHEN 'R' THEN 'Realizado' END)
                    FROM nf_status_processo nsp WHERE nsp.codnfstatuspro = n.codnfstatuspro) END,
       CASE WHEN n.statusnfe = 'P' AND n.tpemissao IN (6, 7) THEN 'SIM' ELSE 'NAO' END,
       CASE WHEN n.cfop ~ '^\d+$' THEN n.cfop::numeric END, n.serie,
       CASE WHEN nr.chavenfe_dev IS NOT NULL THEN 'SIM' ELSE 'NAO' END, nr.chavenfe_dev,
       CASE WHEN n.tipoemissao ~ '^\d+$' THEN n.tipoemissao::numeric END, n.dtcontabil
  FROM nf n
  CROSS JOIN janela j
  LEFT JOIN parceiros p                  ON p.codparceiro = n.codparceiro
  LEFT JOIN parceiros_end e              ON e.codparceiro = p.codparceiro AND e.ativado = 'S'
                                        AND e.codend = (SELECT max(b.codend) FROM parceiros_end b WHERE b.codparceiro = p.codparceiro)
  LEFT JOIN empresas em                  ON em.idempresa = n.idempresa
  LEFT JOIN nfe_ref_dev_ent_vinculo nr   ON nr.chavenfe = n.chavenfe
  LEFT JOIN ev                           ON ev.chavenfe = n.chavenfe
 WHERE n.chavenfe IS NOT NULL AND n.dtemissao BETWEEN j.de AND j.ate
UNION ALL
SELECT n.nronf, n.dtemissao, n.totalnf, n.chavenfe, 'NAO'::char(3), n.codnfe_naocad::numeric(10), n.cnpj, n.razao, 'N'::char(1), 'NAO'::char(3),
       CASE WHEN n.tipo = 'E' THEN 'ENTRADA' ELSE 'SAIDA' END,
       CASE WHEN ev.confirmacao THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END, CASE WHEN ev.ciencia THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END,
       CASE WHEN ev.naorealizada THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END, CASE WHEN ev.desconhecimento THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END,
       CASE WHEN ev.cancelamento THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END, CASE WHEN ev.outros THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END,
       n.idempresa::numeric(10),
       CASE n.situacao WHEN 1 THEN 'NFE ENVIADA A RECEITA' WHEN 2 THEN 'NFE DENEGADA NA RECEITA' WHEN 3 THEN 'NFE CANCELADA NA RECEITA' ELSE 'DESCONHECIDO' END,
       NULL::varchar(4000), coalesce(n.cnpj_destinatario, n.cnpj),
       CASE WHEN n.codnfstatuspro IS NULL THEN ' - '
            ELSE (SELECT concat(nsp.processo_desc, ' - ', CASE nsp.status WHEN 'P' THEN 'Pendente' WHEN 'A' THEN 'Andamento' WHEN 'R' THEN 'Realizado' END)
                    FROM nf_status_processo nsp WHERE nsp.codnfstatuspro = n.codnfstatuspro) END,
       CASE WHEN coalesce(n.importacao_manual, 'N') = 'S' THEN 'SIM' ELSE 'NAO' END, 0, substr(n.chavenfe, 23, 3),
       CASE WHEN nr.chavenfe_dev IS NOT NULL THEN 'SIM' ELSE 'NAO' END, nr.chavenfe_dev, 0, n.dtemissao::date
  FROM nfe_nao_cadastradas n
  CROSS JOIN janela j
  LEFT JOIN nfe_ref_dev_ent_vinculo nr   ON nr.chavenfe = n.chavenfe
  LEFT JOIN ev                           ON ev.chavenfe = n.chavenfe
 WHERE coalesce(n.nfe_importada_sistema, 'N') = 'N' AND n.dtemissao::date BETWEEN j.de AND j.ate;
COMMENT ON VIEW get_nf_manifesto IS 'NFE MANIFESTO DEST.';

CREATE OR REPLACE VIEW get_recebimentos (origem, loja, recebivel, total, total_com_taxa, descricao, taxa, desconto, juros, multa, recebido, liq_recebido,
                                         emissao, vencimento, consiliado, quitado, situacao) AS
SELECT origem, idempresa, codoperadora, sum(valor), sum(valor_com_taxa), descricao, sum(valor) - sum(valor_com_taxa), 0, 0, 0, coalesce(sum(valorpg), 0),
       0, dtvenda, data_compensacao, consiliado, quitado, CASE WHEN coalesce(quitado, 'N') = 'N' THEN 'ABERTO' ELSE 'QUITADO' END
  FROM (SELECT 'CRT'::char(3) AS origem,
               CASE WHEN coalesce(o.codoperadorabase, 0) > 0 THEN o.codoperadorabase ELSE o.codoperadoras END AS codoperadora,
               ot.operadora AS descricao, c.valor, bx.valorpg,
               coalesce(c.valorliq, (c.valor + coalesce(c.valor_ajuste_baixa, 0)) - (c.valor * tx.txadm / 100))::numeric(15,2) AS valor_com_taxa,
               c.dtvenda::date AS dtvenda,
               CASE extract(dow FROM tx.base) WHEN 0 THEN tx.base + 1 WHEN 6 THEN tx.base + 2 ELSE tx.base END AS data_compensacao,
               c.idempresa, coalesce(c.consiliado, 'N') AS consiliado, coalesce(c.liberado, 'N') AS quitado
          FROM cartao c
          LEFT JOIN cartao_bx bx        ON bx.codvendcartao = c.codvendcartao AND coalesce(bx.indr, 'I') <> 'E'
          LEFT JOIN operadoras o        ON o.codoperadoras = c.codoperadora
          LEFT JOIN operadoras ot       ON ot.codoperadoras = CASE WHEN coalesce(o.codoperadorabase, 0) > 0 THEN o.codoperadorabase ELSE o.codoperadoras END
          LEFT JOIN operadoras_taxa otx ON otx.codoperadoras = ot.codoperadoras AND otx.idempresa = c.idempresa
          CROSS JOIN LATERAL (
            SELECT CASE WHEN coalesce(otx.txadm, 0) > 0 THEN coalesce(otx.txadm, 0) ELSE coalesce(ot.txadm, 0) END AS txadm,
                   c.dtvenda::date + (CASE WHEN coalesce(otx.diafechamento, 0) > 0 THEN coalesce(otx.diafechamento, 0) ELSE coalesce(ot.diascomp, 0) END
                                      * coalesce(c.nroparcela, 1)) AS base
          ) tx) x
 GROUP BY origem, idempresa, codoperadora, descricao, dtvenda, data_compensacao, consiliado, quitado
UNION ALL
SELECT origem, codempresa, idpgto, sum(valor), sum(total), modalidade, 0, 0, sum(juro), 0, 0, 0, dtvenda, dtvenc, consiliado, quitado,
       CASE WHEN coalesce(quitado, 'N') = 'N' THEN 'ABERTO' ELSE 'QUITADO' END
  FROM (SELECT 'RCB'::char(3) AS origem, r.dtvenc::date AS dtvenc, r.dtvenda::date AS dtvenda, r.valor,
               (CASE WHEN d.dias < c.tolerancia THEN 0 ELSE coalesce(d.taxa * (CASE WHEN d.dias < 0 THEN 0 ELSE d.dias END)::numeric(10) * r.valor / 100, 0)::numeric(13,2) END)::numeric(13,2) AS juro,
               (CASE WHEN d.dias < c.tolerancia THEN r.valor
                     ELSE coalesce(coalesce(d.taxa * (CASE WHEN d.dias < 0 THEN 0 ELSE d.dias END)::numeric(10) * r.valor / 100, 0)::numeric(13,2), 0) + r.valor + d.multa
                END)::numeric(13,2) AS total,
               r.codempresa, r.idpgto, r.quitada AS quitado, coalesce(r.consiliado, 'N') AS consiliado, pg.modalidade
          FROM areceber r
          LEFT JOIN parceiros c        ON c.codparceiro = r.codparceiro
          LEFT JOIN formas_pgto pg     ON pg.idpgto = r.idpgto
          LEFT JOIN areceber_bx rbx    ON rbx.codrcb = r.codrcb AND coalesce(rbx.indr, 'I') <> 'E'
          CROSS JOIN LATERAL (SELECT (current_date - r.dtvenc::date) AS dias,
                                     (r.txjuros / 30::numeric(13,8))::numeric(13,2) AS taxa,
                                     (CASE WHEN (current_date - r.dtvenc::date) <= c.tolerancia THEN 0
                                           ELSE CASE WHEN r.valor_perc_multa = 'T' THEN r.txmulta::numeric(13,2)
                                                     ELSE coalesce(r.txmulta::numeric(13,2) * r.valor / 100, 0)::numeric(13,2) END END)::numeric(13,2) AS multa) d) x
 GROUP BY origem, codempresa, idpgto, modalidade, dtvenda, dtvenc, consiliado, quitado
 ORDER BY 13, 14, 2, 1, 3;
COMMENT ON VIEW get_recebimentos IS 'RECEBIMENTOS';
