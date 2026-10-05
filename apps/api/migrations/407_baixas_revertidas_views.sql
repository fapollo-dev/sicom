-- 407 — GET_APAGARBX_REVERTIDAS e GET_ARECEBERBX_REVERTIDAS: as baixas revertidas (INDR = 'E') como o legado as lê. A consulta de
-- baixas troca a view quando o lote é revertido (`SetRevertido`, UConsAPGbx/UconsRCBbx) e o "Recibo" imprime dela. Vivas na produção:
-- 4.669 linhas de APAGAR_BX e 613 de ARECEBER_BX revertidas. Mesmas colunas da produção (all_tab_columns), a partir das views fiéis
-- do destino (399/388) com as diferenças do texto da produção: no A Pagar o VALOR e o ACRES_DESC somam o TXJUROS do título e saem o PLC
-- e o NOME_RETORNO; no A Receber sai a forma de pagamento (sem o JOIN no movimento bancário) e as colunas de multa. Nenhuma das duas
-- exige o título quitado. O ramo ARECEBER_BX_SALDO fica fora, como na GET_ARECEBERBX do destino: a tabela está vazia na produção.
-- Sem COMMENT: na produção as duas não estão no catálogo do construtor de relatórios (o COMMENT da view é o catálogo — §283).

CREATE OR REPLACE VIEW get_apagarbx_revertidas AS
SELECT DISTINCT
       b.dtpgto::date                                                       AS data_pagamento,
       1::numeric(13)                                                       AS registros,
       r.razao                                                              AS fornecedor,
       a.duplicata,
       a.dtcompra::date                                                     AS data_compra,
       a.dtvenc::date                                                       AS data_venceu,
       b.valorpg                                                            AS valor_pago,
       (a.valor + coalesce(a.vendor, 0))::numeric(13,2) + coalesce(a.txjuros, 0) - coalesce(a.desconto, 0) AS valor_documento,
       a.valor                                                              AS valor_bruto_documento,
       upper(replace(replace(replace(b.obs, ';', ' '), chr(10), ' '), chr(13), ' ')) AS historico,
       upper(replace(replace(replace(a.obs, ';', ' '), chr(10), ' '), chr(13), ' ')) AS observacao,
       coalesce(b.acre_desc, 0) + coalesce(a.txjuros, 0) - coalesce(a.desconto, 0) AS acres_desc,
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
       coalesce(b.acre_desc, 0)                                             AS acrescimo_desconto
  FROM apagar_bx b
  LEFT JOIN apagar a          ON a.codapg = b.codapg
  LEFT JOIN nf n              ON n.codnf = a.idnf
  LEFT JOIN parceiros r       ON r.codparceiro = a.codparceiro
  LEFT JOIN operadores o      ON o.codoperador = b.codopbx
  LEFT JOIN empresas e        ON e.idempresa = a.codempresa
  LEFT JOIN plano_contas pl   ON pl.codplanocontas::text = trim(r.codcontabil_for)
 WHERE b.indr = 'E';

CREATE OR REPLACE VIEW get_areceberbx_revertidas AS
SELECT p.razao                                                              AS cliente,
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
       coalesce(pe.endereco, '') || (CASE WHEN pe.numero IS NULL OR pe.numero = '' THEN ' ' ELSE '' END)
         || (CASE WHEN pe.bairro IS NULL OR pe.bairro = '' THEN '' ELSE ' Bairro: ' || pe.bairro || ' - ' END)
         || (CASE WHEN pe.cidade IS NULL OR pe.cidade = '' THEN ' ' ELSE pe.cidade || ' - ' END)
         || coalesce(pe.uf, '')                                             AS endereco,
       pe.cnpj_cpf,
       'BAIXA COMUM'::varchar                                               AS tipo,
       r.cod_desconto_titulo                                                AS "cod_desconto_titulo ",
       r.codgrupo_desconto_titulo,
       b.tx_juros,
       b.vr_antecipacao,
       b.tx_antecipacao
  FROM areceber_bx b
  JOIN areceber r             ON r.codrcb = b.codrcb
  JOIN parceiros p            ON p.codparceiro = r.codparceiro
  LEFT JOIN parceiros_end pe  ON pe.codparceiro = r.codparceiro AND pe.endereco_padrao = 'S'
  LEFT JOIN operadores o      ON o.codoperador = b.codopbx
  LEFT JOIN operadores i      ON i.codoperador = r.codoperadorman
 WHERE b.indr = 'E';
