-- 399 — a concatenação com nulo à moda do Oracle em duas fontes da mig 388: lá `NULL || ' - '` dá ' - ' (o nulo vira vazio); aqui o
-- `||` com nulo dá NULL. CLIENTE_COMPLETO (GET_RCB) sumia sem fantasia nem razão; na GET_APAGARBX a conta de TITULAR nulo saía da lista
-- (o string_agg pula nulo; o STRING_AGG do legado recebe 'Conta: 5 -  '). O resto das duas views é o da 388, sem mudança.

CREATE OR REPLACE VIEW get_rcb AS
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
       concat(c.codparceiro, ' - ', coalesce(c.fantasia, c.razao))         AS cliente_completo,
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

CREATE OR REPLACE VIEW get_apagarbx AS
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
       (SELECT string_agg(concat('Conta: ', c.codconta, ' - ', c.titular, ' '), ',') FROM contas_bancarias c
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
