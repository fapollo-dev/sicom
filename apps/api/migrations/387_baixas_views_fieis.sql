-- 387 — as views das baixas (GET_APAGARBX / GET_ARECEBERBX) com a semântica do legado. Elas alimentam os relatórios do
-- construtor (4 cada, mig 203) e o RECIBO das baixas (recibopagar.fr3 / recibo.fr3 — `SELECT * FROM GET_…BX WHERE LOTE`).
-- A mig 203 trouxe os nomes certos com valores trocados; conferido contra ALL_VIEWS da produção (só leitura, 28/09/2026):
--   A PAGAR:   VALOR_DOCUMENTO = VALOR + VENDOR − DESCONTO (a 203 punha o VALOR puro — que o legado chama VALOR_BRUTO_DOCUMENTO);
--              ACRES_DESC = ACRE_DESC − DESCONTO (o cru é ACRESCIMO_DESCONTO); NR_PARCELA = NRPARCELA; NR_NF = o NÚMERO da nota
--              (N.NRONF, não o IDNF); TX_JUROS o da baixa; OPERADOR_BAIXA = o LOGIN; só título QUITADO e baixa não excluída.
--   A RECEBER: VALOR_LIQUIDO = VALOR + JUROS + ACRE_DESC (a 203 somava o valor PAGO); a forma de pagamento é a do LOTE (MOV do
--              lote → FORMAS_PGTO), não a do título; OPERADOR_BAIXA = o LOGIN e OPERADOR = quem lançou o título; NRO_PEDIDO =
--              NROPEDIDO; só título QUITADO e baixa não excluída. (O ramo ARECEBER_BX_SALDO da view do legado tem 0 linhas.)
DROP VIEW IF EXISTS get_apagarbx;
CREATE VIEW get_apagarbx AS
SELECT b.codapgbx                                  AS codigo_documentobx,
       a.codapg                                    AS codigo_documento,
       p.razao                                     AS fornecedor,
       a.codparceiro                               AS codigo_fornecedor,
       e.cnpj_cpf,
       a.duplicata,
       a.dtcompra::date                            AS data_compra,
       a.dtvenc::date                              AS data_venceu,
       b.dtpgto::date                              AS data_pagamento,
       b.valorpg                                   AS valor_pago,
       (a.valor + coalesce(a.vendor, 0) - coalesce(a.desconto, 0)) AS valor_documento,
       a.valor                                     AS valor_bruto_documento,
       coalesce(b.acre_desc, 0) - coalesce(a.desconto, 0) AS acres_desc,
       coalesce(b.juros, 0)                        AS juros,
       coalesce(b.multa, 0)                        AS multa,
       b.obs                                       AS observacao,
       o.login                                     AS operador_baixa,
       b.codopbx                                   AS codigo_operadorbx,
       b.idlote                                    AS lote,
       a.nrparcela                                 AS nr_parcela,
       n.nronf                                     AS nr_nf,
       coalesce(a.tipodoc, '.')                    AS tipo_documento,
       p.codcontabil_for                           AS cod_contabil_forn,
       b.contabilizado,
       a.cod_desconto_titulo,
       b.tx_juros,
       a.codplc                                    AS plc,
       a.codempresa                                AS idempresa,
       b.indr,
       coalesce(b.acre_desc, 0)                    AS acrescimo_desconto,
       a.codgrupo_desconto_titulo,
       b.nome_retorno
  FROM apagar_bx b
  JOIN apagar a             ON a.codapg = b.codapg
  LEFT JOIN nf n            ON n.codnf = a.idnf
  LEFT JOIN parceiros p     ON p.codparceiro = a.codparceiro
  LEFT JOIN LATERAL (SELECT e1.cnpj_cpf FROM parceiros_end e1 WHERE e1.codparceiro = a.codparceiro AND coalesce(e1.ativado, 'S') = 'S'
                      ORDER BY e1.codend LIMIT 1) e ON true
  LEFT JOIN operadores o    ON o.codoperador = b.codopbx
 WHERE a.quitada = 'S' AND coalesce(b.indr, 'I') = 'I';
COMMENT ON VIEW get_apagarbx IS 'CONTAS A PAGAR BAIXADAS';

DROP VIEW IF EXISTS get_areceberbx;
CREATE VIEW get_areceberbx AS
SELECT b.codrcbbx                                  AS codigo_documentobx,
       r.codrcb                                    AS codigo_documento,
       p.razao                                     AS cliente,
       r.codparceiro                               AS codigo_cliente,
       e.cnpj_cpf,
       e.endereco,
       f.modalidade                                AS forma_pgto,
       r.duplicata,
       r.dtvenda::date                             AS data_venda,
       r.dtvenc::date                              AS data_venceu,
       b.dtpgto::date                              AS data_pagamento,
       b.data_operacao::date                       AS data_operacao,
       b.valorpg                                   AS valor_pago,
       r.valor                                     AS valor_documento,
       (r.valor + coalesce(b.juros, 0) + coalesce(b.acre_desc, 0)) AS valor_liquido,
       coalesce(b.acre_desc, 0)                    AS acres_desc,
       coalesce(b.juros, 0)                        AS juros,
       coalesce(b.multa, 0)                        AS multa,
       b.obs                                       AS historico,
       o.login                                     AS operador_baixa,
       b.codopbx                                   AS codigo_operadorbx,
       b.idlote                                    AS lote,
       r.nrocupom                                  AS nro_cupom,
       r.docnf                                     AS nro_nf,
       r.nropedido                                 AS nro_pedido,
       b.obs,
       p.codref                                    AS codref,
       p.codconvenio,
       p.codcontabil,
       'BAIXA COMUM'::varchar                      AS tipo,
       r.consiliado                                AS consilidado,
       b.contabilizado,
       r.cod_desconto_titulo,
       b.tx_juros,
       r.codempresa                                AS idempresa,
       b.indr,
       i.login                                     AS operador,
       b.obs_editavel,
       r.codgrupo_desconto_titulo,
       b.vr_antecipacao,
       b.tx_antecipacao,
       b.txmulta,
       b.valor_perc_multa
  FROM areceber_bx b
  JOIN areceber r           ON r.codrcb = b.codrcb
  JOIN parceiros p          ON p.codparceiro = r.codparceiro
  LEFT JOIN parceiros_end e ON e.codparceiro = r.codparceiro AND e.endereco_padrao = 'S'
  LEFT JOIN operadores o    ON o.codoperador = b.codopbx
  LEFT JOIN operadores i    ON i.codoperador = r.codoperadorman
  LEFT JOIN mov_contas_bancarias mov ON mov.idlote = b.idlote
  LEFT JOIN formas_pgto f   ON f.idpgto = mov.idpgto
 WHERE r.quitada = 'S' AND coalesce(b.indr, 'I') <> 'E';
COMMENT ON VIEW get_areceberbx IS 'CONTAS A RECEBER BAIXADAS';
