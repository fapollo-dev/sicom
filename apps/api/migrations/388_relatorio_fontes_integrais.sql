-- 388 — as quatro FONTES de relatório que só o construtor usa (GET_RCB, GET_CP_CEN, GET_APAGARBX, GET_ARECEBERBX) na
-- ÍNTEGRA do legado: todas as colunas, na ordem e com a semântica de ALL_VIEWS/ALL_TAB_COLUMNS da produção (só leitura,
-- 28/09/2026). A mig 203 trouxe só "as colunas que os relatórios importados usam", várias com o valor trocado; a 387 corrigiu
-- parte das baixas. Um relatório do cliente importado para o construtor lê estas colunas pelo nome — tem de ler o mesmo valor.
--
-- O que é do legado e fica, mesmo parecendo errado (é o que os relatórios dele mostram):
--   · GET_RCB: a LISTA de colunas da view manda sobre os aliases do SELECT — a coluna CODIGO_SITUACAO_DOCUMENTO recebe a
--     DESCRIÇÃO e SITUACAO_DOCUMENTO o CÓDIGO; o endereço de cobrança é o `CODEND` do cliente; a data de pagamento é a da
--     BAIXA (um título com duas baixas sai duas vezes); juro/multa/total calculados na hora, com a taxa diária arredondada
--     a 2 casas (`CAST(TXJUROS/30 AS NUMERIC(13,2))`).
--   · GET_CP_CEN: parte do TÍTULO; o centro de custo vem do rateio pelo CODGRUPO (um título com N centros sai N vezes); o
--     VALOR é o do título (valor + vendor − desconto); DATA_CONTABIL = a da nota, senão a emissão; NOTA_FISCAL = o número.
--   · GET_APAGARBX: SELECT DISTINCT; HISTORICO = a obs da BAIXA e OBSERVACAO = a do TÍTULO (maiúsculas, sem ; e quebras);
--     COD_CONTABIL_FORN = o código reduzido da conta do fornecedor; PLC = a descrição do centro de custo do grupo.
--   · GET_ARECEBERBX: o endereço composto pelo DECODE do legado — com número ou CEP preenchidos o DECODE devolve nulo e eles
--     SOMEM do texto (só "Bairro: … - CIDADE - UF" aparece).
-- As colunas que o Apollo já expunha e o legado não tem ficam no fim, com o mesmo nome.

-- ─────────────────────────────────────────────── GET_RCB (A RECEBER) ───────────────────────────────────────────────────────
DROP VIEW IF EXISTS get_rcb;
CREATE VIEW get_rcb AS
WITH base AS (
  SELECT r.*, (current_date - r.dtvenc::date) AS d_atraso, c.tolerancia AS c_tol
    FROM areceber r LEFT JOIN parceiros c ON c.codparceiro = r.codparceiro
)
SELECT c.razao                                                              AS cliente,
       r.dtvenc::date                                                       AS data_vencimento,
       r.dtvenda::date                                                      AS data_venda,
       c.codref                                                             AS referencia,
       r.valor,
       r.txjuros,
       r.duplicata,
       (CASE WHEN r.d_atraso < 0 THEN 0 ELSE r.d_atraso END)::numeric(10)   AS dias_atrazo,
       coalesce(c.tolerancia, 0)::numeric(10)                               AS dias_tolerancia,
       (CASE WHEN r.d_atraso < r.c_tol THEN 0
             ELSE coalesce((r.txjuros / 30::numeric(13,8))::numeric(13,2) * (CASE WHEN r.d_atraso < 0 THEN 0 ELSE r.d_atraso END)::numeric(10) * r.valor / 100, 0)::numeric(13,2)
        END)::numeric(13,2)                                                 AS juro,
       (CASE WHEN r.d_atraso < r.c_tol THEN r.valor
             ELSE coalesce(coalesce((r.txjuros / 30::numeric(13,8))::numeric(13,2) * (CASE WHEN r.d_atraso < 0 THEN 0 ELSE r.d_atraso END)::numeric(10) * r.valor / 100, 0)::numeric(13,2), 0)
                  + r.valor
                  + (CASE WHEN r.d_atraso <= r.c_tol THEN 0
                          ELSE CASE WHEN r.valor_perc_multa = 'T' THEN r.txmulta::numeric(13,2)
                                    ELSE coalesce(r.txmulta::numeric(13,2) * r.valor / 100, 0)::numeric(13,2) END
                     END)::numeric(13,2)
        END)::numeric(13,2)                                                 AS total,
       r.codrcb                                                             AS codigo,
       r.nrocupom                                                           AS nro_cupom,
       r.docnf                                                              AS nro_nf,
       upper(replace(replace(r.obs, ';', ' '), chr(10), ' '))               AS obs,
       v.razao                                                              AS vendedor,
       co.razao                                                             AS cobrador,
       o.nome                                                               AS operador,
       l.login                                                              AS logado,
       r.nropedido                                                          AS nro_pedido,
       r.codempresa                                                         AS idempresa,
       r.gerado,
       r.tipodoc                                                            AS tipo_documento,
       c.codparceiro                                                        AS codigo_cliente,
       o.codoperador                                                        AS codigo_operador,
       co.codparceiro                                                       AS codigo_cobrador,
       v.codparceiro                                                        AS codigo_vendedor,
       r.codgrupo                                                           AS codigo_grupo,
       r.codpdv                                                             AS pdv,
       r.idpgto,
       c.codconvenio,
       x.razao                                                              AS desconvenio,
       r.lotecob                                                            AS lote_cobranca,
       r.codbco,
       r.quitada,
       r.idnf,
       r.nrodup,
       r.codoperadorman,
       r.nrodoc,
       r.parcela,
       r.codcx,
       r.antecipado,
       c.cli                                                                AS somente_cliente,
       c.fun                                                                AS somente_funcionario,
       e.endereco                                                           AS endereco_cobranca,
       e.bairro                                                             AS bairro_cobranca,
       e.cidade                                                             AS cidade_cobranca,
       e.uf                                                                 AS uf_cobranca,
       e.telefone,
       e.cnpj_cpf,
       r.datalotcob::date                                                   AS data_lote_cobranca,
       coalesce(r.registro_arq_remessa, 'N')                                AS registro_arq_remessa,
       r.nome_arq_remessa,
       r.login_arq_remessa,
       r.data_arq_remessa,
       c.ativado,
       r.codplc                                                             AS plc,
       c.credito                                                            AS limite,
       r.consiliado,
       r.agrupamento,
       r.codplc,
       plc.desccodplc                                                       AS centrodecusto,
       plc.descricao                                                        AS descricao_centro_custos,
       r.codadiantamento,
       coalesce(r.agrupado, 'N')                                            AS agrupado,
       sn.descricao                                                         AS codigo_situacao_documento,
       r.idsituacao_nf                                                      AS situacao_documento,
       rbx.dtpgto                                                           AS data_pagamento,
       c.codparceiro || ' - ' || coalesce(c.fantasia, c.razao)              AS cliente_completo,
       r.txmulta,
       (CASE WHEN r.d_atraso <= r.c_tol THEN 0
             ELSE CASE WHEN r.valor_perc_multa = 'T' THEN r.txmulta::numeric(13,2)
                       ELSE coalesce(r.txmulta::numeric(13,2) * r.valor / 100, 0)::numeric(13,2) END
        END)::numeric(13,2)                                                 AS multa,
       r.valor_perc_multa                                                   AS tipo_multa,
       r.dtagendamento::date                                                AS data_agendamento,
       -- as que o Apollo já expunha (mig 203)
       r.consiliado                                                         AS consilidado,
       r.codgrupo_agrupamento_rcb                                           AS codgrupo
  FROM base r
  LEFT JOIN parceiros v       ON v.codparceiro = r.codvendedor
  LEFT JOIN parceiros co      ON co.codparceiro = r.codcobrador
  LEFT JOIN operadores o      ON o.codoperador = r.codoperador
  LEFT JOIN parceiros c       ON c.codparceiro = r.codparceiro
  LEFT JOIN operadores l      ON l.codoperador = r.codoperadorman
  LEFT JOIN parceiros x       ON x.codparceiro = c.codconvenio
  LEFT JOIN parceiros_end e   ON e.codend = c.codend
  LEFT JOIN plc               ON plc.codplc = r.codplc
  LEFT JOIN situacao_nf sn    ON sn.idsituacao_nf = r.idsituacao_nf
  LEFT JOIN areceber_bx rbx   ON rbx.codrcb = r.codrcb AND coalesce(rbx.indr, 'I') <> 'E'
 ORDER BY r.dtvenc::date;
COMMENT ON VIEW get_rcb IS 'A RECEBER';

-- ─────────────────────────────────────── GET_CP_CEN (CONTAS A PAGAR 2 CENTRO DE CUSTO) ─────────────────────────────────────
DROP VIEW IF EXISTS get_cp_cen;
CREATE VIEW get_cp_cen AS
SELECT a.duplicata                                                          AS nr_documento,
       f.razao                                                              AS fornecedor,
       (a.valor + coalesce(a.vendor, 0) - coalesce(a.desconto, 0))::numeric(13,2) AS valor,
       a.dtcompra::date                                                     AS emissao,
       a.dtvenc::date                                                       AS vencimento,
       coalesce(n.dtcontabil::date, a.dtcompra::date)                       AS data_contabil,
       coalesce(a.txjuros, 0)                                               AS juros,
       n.nronf                                                              AS nota_fiscal,
       a.tipodoc                                                            AS tipo_documento,
       b.banco,
       a.obs                                                                AS observacao,
       a.codempresa                                                         AS codigo_empresa,
       e.razao_social                                                       AS empresa,
       o.nome                                                               AS operador,
       a.codapg                                                             AS codigo,
       a.codparceiro                                                        AS codigo_parceiro,
       a.nrparcela                                                          AS nr_parcela,
       a.vendor,
       a.convenio,
       b.codbco,
       a.quitada,
       a.idnf,
       a.gerado,
       a.nrodup,
       a.codoperador,
       a.codempresa                                                         AS idempresa,
       cen.desccodplc                                                       AS centro_custo,
       f.fantasia,
       f.desconto_pedidos                                                   AS descontopedido,
       a.desconto,
       a.valor                                                              AS valor_bruto,
       n.issqn,
       n.valorissqn,
       a.bloqueio,
       a.adcredito,
       a.codadiantamento,
       a.codbarrasblt                                                       AS codbarras,
       a.remessa_gerada,
       coalesce(a.agrupamento, 'N')                                         AS agrupamento,
       coalesce(a.agrupado, 'N')                                            AS agrupado,
       abx.dtpgto::date                                                     AS data_bx,
       -- as que o Apollo já expunha (mig 203): o centro do rateio
       cen.codcc                                                            AS codplc,
       cen.descricao                                                        AS descricao,
       cen.desccodplc                                                       AS codigo_centro_custo
  FROM apagar a
  LEFT JOIN bancos b          ON b.codbco = a.codbco
  LEFT JOIN operadores o      ON o.codoperador = a.codoperador
  LEFT JOIN parceiros f       ON f.codparceiro = a.codparceiro
  LEFT JOIN empresas e        ON e.idempresa = a.codempresa
  LEFT JOIN nf n              ON n.codnf = a.idnf
  LEFT JOIN apagar_bx abx     ON abx.codapg = a.codapg AND coalesce(abx.indr, 'I') = 'I'
  LEFT JOIN (SELECT c.codgrupo, c.codcc, p.desccodplc, p.descricao FROM cx_apagar c LEFT JOIN plc p ON p.codplc = c.codcc) cen
                              ON cen.codgrupo = a.codgrupo;
COMMENT ON VIEW get_cp_cen IS 'CONTAS A PAGAR 2 CENTRO DE CUSTO';

-- ───────────────────────────────────────── GET_APAGARBX (CONTAS A PAGAR BAIXADAS) ──────────────────────────────────────────
DROP VIEW IF EXISTS get_apagarbx;
CREATE VIEW get_apagarbx AS
SELECT DISTINCT
       b.dtpgto::date                                                       AS data_pagamento,
       1::numeric(13)                                                       AS registros,
       r.razao                                                              AS fornecedor,
       a.duplicata,
       a.dtcompra::date                                                     AS data_compra,
       a.dtvenc::date                                                       AS data_venceu,
       b.valorpg                                                            AS valor_pago,
       (a.valor + coalesce(a.vendor, 0))::numeric(13,2) - coalesce(a.desconto, 0) AS valor_documento,
       a.valor                                                              AS valor_bruto_documento,
       upper(replace(replace(replace(b.obs, ';', ' '), chr(10), ' '), chr(13), ' ')) AS historico,
       upper(replace(replace(replace(a.obs, ';', ' '), chr(10), ' '), chr(13), ' ')) AS observacao,
       coalesce(b.acre_desc, 0) - coalesce(a.desconto, 0)                   AS acres_desc,
       b.juros,
       o.login                                                              AS operador_baixa,
       b.idlote                                                             AS lote,
       a.codparceiro                                                        AS codigo_fornecedor,
       a.codempresa                                                         AS idempresa,
       b.codapg                                                             AS codigo_documento,
       b.codapgbx                                                           AS codigo_documentobx,
       b.codopbx                                                            AS codigo_operadorbx,
       a.nrparcela                                                          AS nr_parcela,
       n.nronf                                                              AS nr_nf,
       e.razao_social                                                       AS empresa,
       coalesce(a.tipodoc, '.')                                             AS tipo_documento,
       pl.codireduzido                                                      AS cod_contabil_forn,
       r.codcontabil                                                        AS cod_contabil_cc,
       b.contabilizado,
       (SELECT string_agg('Conta: ' || c.codconta || ' - ' || c.titular || ' ', ',') FROM contas_bancarias c
          LEFT JOIN mov_contas_bancarias m ON m.codconta = c.codconta WHERE m.idlote = b.idlote) AS titular,
       e.fantasia                                                           AS fantasiaempresa,
       ' '::varchar                                                         AS espaco,
       (SELECT pt.cnpj_cpf FROM parceiros_end pt WHERE pt.codparceiro = a.codparceiro AND coalesce(pt.ativado, 'S') = 'S'
         ORDER BY pt.codend LIMIT 1)                                        AS cnpj_cpf,
       a.cod_desconto_titulo,
       a.codgrupo_desconto_titulo,
       b.tx_juros,
       (SELECT g.descricao FROM plc g JOIN cx_apagar x ON x.codcc = g.codplc WHERE x.codgrupo = a.codgrupo LIMIT 1) AS plc,
       coalesce(b.acre_desc, 0)                                             AS acrescimo_desconto,
       b.nome_retorno,
       -- as que o Apollo já expunha
       coalesce(b.multa, 0)                                                 AS multa,
       b.indr
  FROM apagar_bx b
  LEFT JOIN apagar a          ON a.codapg = b.codapg
  LEFT JOIN nf n              ON n.codnf = a.idnf
  LEFT JOIN parceiros r       ON r.codparceiro = a.codparceiro
  LEFT JOIN operadores o      ON o.codoperador = b.codopbx
  LEFT JOIN empresas e        ON e.idempresa = a.codempresa
  LEFT JOIN plano_contas pl   ON pl.codplanocontas::text = trim(r.codcontabil_for)
 WHERE a.quitada = 'S' AND coalesce(b.indr, 'I') = 'I';
COMMENT ON VIEW get_apagarbx IS 'CONTAS A PAGAR BAIXADAS';

-- ──────────────────────────────────────── GET_ARECEBERBX (CONTAS A RECEBER BAIXADAS) ───────────────────────────────────────
DROP VIEW IF EXISTS get_areceberbx;
CREATE VIEW get_areceberbx AS
SELECT f.modalidade                                                         AS forma_pgto,
       p.razao                                                              AS cliente,
       b.dtpgto::date                                                       AS data_pagamento,
       r.dtvenda::date                                                      AS data_venda,
       r.dtvenc::date                                                       AS data_venceu,
       b.valorpg                                                            AS valor_pago,
       r.valor                                                              AS valor_documento,
       r.duplicata,
       b.obs                                                                AS historico,
       b.acre_desc                                                          AS acres_desc,
       r.valor + b.juros + b.acre_desc                                      AS valor_liquido,
       b.juros,
       o.login                                                              AS operador_baixa,
       i.login                                                              AS operador,
       b.idlote                                                             AS lote,
       r.codparceiro                                                        AS codigo_cliente,
       r.codempresa                                                         AS idempresa,
       b.codrcb                                                             AS codigo_documento,
       b.codrcbbx                                                           AS codigo_documentobx,
       b.codopbx                                                            AS codigo_operadorbx,
       p.codref,
       r.nrocupom                                                           AS nro_cupom,
       r.docnf                                                              AS nro_nf,
       r.nropedido                                                          AS nro_pedido,
       b.obs,
       (CASE WHEN (current_date - r.dtvenc::date) < p.tolerancia THEN 0
             ELSE coalesce(CASE WHEN r.txjuros > 0 AND r.txjuros < 20 THEN (r.txjuros / 30::numeric(13,8))::numeric(13,2) ELSE 9 / 30::numeric(13,8) END
                           * (CASE WHEN (current_date - r.dtvenc::date) < 0 THEN 0 ELSE (current_date - r.dtvenc::date) END)::numeric(10) * r.valor / 100, 0)::numeric(13,2)
        END)::numeric(13,2)                                                 AS juro_calculado,
       r.consiliado,
       b.contabilizado,
       b.obs_editavel,
       p.codcontabil,
       b.data_operacao::date                                                AS data_operacao,
       -- o DECODE do legado: número e CEP preenchidos somem (o DECODE sem default devolve nulo)
       coalesce(pe.endereco, '') || (CASE WHEN pe.numero IS NULL OR pe.numero = '' THEN ' ' ELSE '' END)
         || (CASE WHEN pe.bairro IS NULL OR pe.bairro = '' THEN '' ELSE ' Bairro: ' || pe.bairro || ' - ' END)
         || (CASE WHEN pe.cidade IS NULL OR pe.cidade = '' THEN ' ' ELSE pe.cidade || ' - ' END)
         || coalesce(pe.uf, '')                                             AS endereco,
       pe.cnpj_cpf,
       'BAIXA COMUM'::varchar                                               AS tipo,
       r.cod_desconto_titulo,
       r.codgrupo_desconto_titulo,
       b.tx_juros,
       b.vr_antecipacao,
       b.tx_antecipacao,
       b.txmulta,
       b.valor_perc_multa,
       b.multa,
       to_char(b.data_operacao, 'DD/MM/YYYY HH24:MI')                       AS data_operacao_min,
       p.codconvenio,
       -- as que o Apollo já expunha
       r.consiliado                                                         AS consilidado,
       b.indr
  FROM areceber_bx b
  JOIN areceber r             ON r.codrcb = b.codrcb
  JOIN parceiros p            ON p.codparceiro = r.codparceiro
  LEFT JOIN parceiros_end pe  ON pe.codparceiro = r.codparceiro AND pe.endereco_padrao = 'S'
  LEFT JOIN operadores o      ON o.codoperador = b.codopbx
  LEFT JOIN operadores i      ON i.codoperador = r.codoperadorman
  LEFT JOIN mov_contas_bancarias mov ON mov.idlote = b.idlote
  LEFT JOIN formas_pgto f     ON f.idpgto = mov.idpgto
 WHERE r.quitada = 'S' AND coalesce(b.indr, 'I') <> 'E';
COMMENT ON VIEW get_areceberbx IS 'CONTAS A RECEBER BAIXADAS';
