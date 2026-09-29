-- 391 — as FONTES do construtor que ainda não existiam aqui: 14 views do catálogo da produção (as que têm COMMENT e que os
-- relatórios do cliente usam — 20 dos 95). Colunas na ordem e com a semântica de ALL_VIEWS/ALL_TAB_COLUMNS da produção (só
-- leitura, 29/09/2026; todas VALID). O rótulo (COMMENT) é o do combo do legado: o COMMENT de lá sem o ';' do início — é o que o
-- `TABELA` dos arquivos grava ('VENDAS;' ≠ 'VENDAS'; 'PEDIDO DE COMPRA;').
--
-- Ficam de fora, com prova:
--   · GET_ARECEBER: sem COMMENT na produção — o legado não a oferece, e o arquivo GET_ARECEBER_ARECEBER.XML não aparece sob
--     nenhuma view do combo (`PercorreOrigem` procura `<VIEW>_` no nome).
--   · GET_CONTATOS_PDV: lê a PUBLICIDADE_PRE, que só o PDV grava (nenhuma unit do retaguarda a cita; 1.390 contatos, o último
--     em 04/12/2025) — PDV é fora do escopo, como a HISTORICO_PDV (plano-tabelas.json, 'excluidas').
--   · FINALIZADORAS, OURO - FLUXO DE CAIXA NIVEL-2, _OURO - PRODUTO VENDIDO, VENDAS_PEDIDOS, _OURO - VENDAS_PEDIDOS: os 8
--     relatórios que as citam apontam para views que NÃO EXISTEM na produção (já quebram lá).
--
-- O que é do legado e fica (é o que os relatórios dele mostram):
--   · GET_APAGARBXCC: VALOR_DOCUMENTO e ACRES_DESC somam a TAXA de juros do título (TXJUROS) como se fosse valor; todas as
--     baixas, estornadas incluídas; uma linha por endereço do fornecedor × rateio (DISTINCT).
--   · GET_CARTAOBX: só as vendas LIBERADAS; previsão = venda + dias da operadora (sem pular fim de semana, ao contrário da
--     GET_CARTAO).
--   · GET_VALORES_CARTAO: a GET_CARTAO com as liberadas, DATA com a hora e a previsão também com a hora da venda.
--   · GET_DRE_COMPETENCIA: DOCUMENTO/TIPO_DOCUMENTO do primeiro título do grupo; crédito/débito pelo TPCONTA do centro.
--   · GET_TIPO_CODIGO_VENDIDO: só os últimos 5 dias (hoje incluso), sem os códigos de barras ('CB').
--   · GET_VENDAS: agrupa por CODVENDAS (a linha do item) — uma linha por item, com o total arredondado (IAT 'A') ou truncado.
--   · GET_ESTOQUE_TOTALIZADO: o preço vem de TODA loja do produto (o JOIN da MULTI_PRECO não casa a loja): o saldo repete a
--     cada preço igual de outra loja.
--   · GET_PRODUTOS_ESTOQUE: só produto com saldo E depósito na loja (os dois JOIN); MAXIMO sai 0 (mas agrupa pelo máximo).
--   · NEUTRA (GET_CAIXA): a negativa da produção é 'NÃƒO' (o mesmo acidente de codificação da PRECIFICADA — mig 389): 'NÃO'.

-- ───────────────────────────────────────── GET_ADIANTAMENTO_FORN (ADIANTAMENTO A PARCEIROS) ───────────────────────────────
DROP VIEW IF EXISTS get_adiantamento_forn;
CREATE VIEW get_adiantamento_forn AS
SELECT a.codadiantamento                                                    AS codigo,
       a.dtadiantamento::date                                               AS dtadiantamento,
       a.dtvencimento::date                                                 AS vencimento,
       p.razao                                                              AS parceiro,
       a.valor,
       a.codparceiro,
       a.quitada,
       a.codcontacorrente,
       a.codmovconta,
       cb.nroconta                                                          AS nro_conta,
       cb.titular
  FROM adiantamento_forn a
  LEFT JOIN parceiros p         ON p.codparceiro = a.codparceiro
  LEFT JOIN contas_bancarias cb ON cb.codconta = a.codcontacorrente;
COMMENT ON VIEW get_adiantamento_forn IS 'ADIANTAMENTO A PARCEIROS';

-- ─────────────────────────────────────── GET_APAGARBXCC (CONTAS A PAGAR BAIXADA CC) ────────────────────────────────────────
DROP VIEW IF EXISTS get_apagarbxcc;
CREATE VIEW get_apagarbxcc AS
SELECT DISTINCT
       a.dtpgto::date                                                       AS data_pagamento,
       r.razao                                                              AS fornecedor,
       p.duplicata,
       p.dtcompra                                                           AS data_compra,
       p.dtvenc::date                                                       AS data_venceu,
       a.valorpg                                                            AS valor_pago,
       (p.valor + coalesce(p.vendor, 0))::numeric(13,2) + coalesce(p.txjuros, 0) - coalesce(p.desconto, 0) AS valor_documento,
       p.valor                                                              AS valor_bruto_documento,
       a.obs                                                                AS historico,
       p.obs                                                                AS observacao,
       coalesce(a.acre_desc, 0) + coalesce(p.txjuros, 0) - coalesce(p.desconto, 0) AS acres_desc,
       a.juros,
       o.login                                                              AS operador_baixa,
       a.idlote                                                             AS lote,
       p.codparceiro                                                        AS codigo_fornecedor,
       p.codempresa                                                         AS idempresa,
       a.codapg                                                             AS codigo_documento,
       a.codapgbx                                                           AS codigo_documentobx,
       a.codopbx                                                            AS codigo_operadorbx,
       p.nrparcela                                                          AS nr_parcela,
       n.nronf                                                              AS nr_nf,
       e.razao_social                                                       AS empresa,
       coalesce(p.tipodoc, '.')                                             AS tipo_documento,
       r.codcontabil_for                                                    AS cod_contabil_forn,
       r.codcontabil                                                        AS cod_contabil_cc,
       a.contabilizado,
       m.codconta                                                           AS codigo_conta,
       b2.titular                                                           AS nome_conta,
       b2.codlanccontabil                                                   AS cod_lanc_contabil,
       c.codcc,
       l.desccodplc                                                         AS descodplc,
       l.descricao                                                          AS descricaoplc,
       pe.cnpj_cpf
  FROM apagar_bx a
  LEFT JOIN apagar p                ON p.codapg = a.codapg
  LEFT JOIN nf n                    ON n.codnf = p.idnf
  LEFT JOIN parceiros r             ON r.codparceiro = p.codparceiro
  LEFT JOIN parceiros_end pe        ON pe.codparceiro = r.codparceiro
  LEFT JOIN operadores o            ON o.codoperador = a.codopbx
  LEFT JOIN empresas e              ON e.idempresa = p.codempresa
  LEFT JOIN mov_contas_bancarias m  ON m.idlote = a.idlote
  LEFT JOIN contas_bancarias b2     ON b2.codconta = m.codconta
  LEFT JOIN cx_apagar c             ON c.codapg = a.codapg
  LEFT JOIN plc l                   ON l.codplc = c.codcc
 WHERE p.quitada = 'S';
COMMENT ON VIEW get_apagarbxcc IS 'CONTAS A PAGAR BAIXADA CC';

-- ──────────────────────────────────────────────────── GET_CAIXA (CAIXA) ────────────────────────────────────────────────────
DROP VIEW IF EXISTS get_caixa;
CREATE VIEW get_caixa AS
SELECT cx.codcx                                                             AS codigo,
       cx.data::date                                                        AS emissao,
       cx.valor,
       cx.vrtitulo,
       o.nome                                                               AS operador,
       cx.idlote                                                            AS lote,
       cx.tiporecurso                                                       AS recurso,
       cx.obs,
       cx.idempresa,
       snf.descricao                                                        AS situacao,
       cx.idsituacao_nf                                                     AS cod_situacao,
       CASE WHEN cx.neutra = 'S' THEN 'SIM' ELSE 'NÃO' END                  AS neutra,
       p.razao                                                              AS parceiro,
       plc.desccodplc                                                       AS codigo_cc,
       plc.descricao                                                        AS centro_de_custo,
       cb.titular,
       cb.nroconta                                                          AS nro_conta,
       cx.cadastrado_manualmente
  FROM caixa cx
  LEFT JOIN operadores o        ON o.codoperador = cx.operador
  LEFT JOIN situacao_nf snf     ON snf.idsituacao_nf = cx.idsituacao_nf
  LEFT JOIN parceiros p         ON p.codparceiro = cx.codparceiro
  LEFT JOIN plc                 ON plc.codplc = cx.codplc
  LEFT JOIN contas_bancarias cb ON cb.codconta = cx.codconta;
COMMENT ON VIEW get_caixa IS 'CAIXA';

-- ───────────────────────────────────────────── GET_CARTAOBX (CARTOES BAIXADOS) ─────────────────────────────────────────────
DROP VIEW IF EXISTS get_cartaobx;
CREATE VIEW get_cartaobx AS
SELECT o.operadora,
       c.valor,
       c.nrocupom,
       c.nropedido,
       c.dtvenda::date                                                      AS data,
       c.dtvenda                                                            AS data_hora,
       c.codoperadora                                                       AS codigo_operadora,
       c.codvendcartao                                                      AS codigo,
       c.dtvenda::date + coalesce(o.diascomp, 0)                            AS previsao_compensacao,
       c.idlote                                                             AS lote,
       c.dtbaixa::date                                                      AS data_baixa,
       c.idempresa                                                          AS codigo_empresa,
       op.nome                                                              AS operador_baixa,
       coalesce(c.valorliq, c.valor - (c.valor * coalesce(o.txadm, 0) / 100)) AS valor_com_taxa,
       c.consiliado,
       c.data_operacao::date                                                AS data_operacao,
       c.contabilizado,
       c.nsu,
       c.nsuhost                                                            AS nsu_host,
       c.autorizacao,
       bx.valorpg
  FROM cartao c
  LEFT JOIN cartao_bx bx  ON bx.codvendcartao = c.codvendcartao AND (bx.indr IS NULL OR bx.indr <> 'E')
  LEFT JOIN operadoras o  ON o.codoperadoras = c.codoperadora
  LEFT JOIN operadores op ON op.codoperador = c.codopbx
 WHERE c.liberado = 'S';
COMMENT ON VIEW get_cartaobx IS 'CARTOES BAIXADOS';

-- ─────────────────────────────────────────────── GET_CP (CONTAS A PAGAR 2) ─────────────────────────────────────────────────
DROP VIEW IF EXISTS get_cp;
CREATE VIEW get_cp AS
SELECT p.duplicata                                                          AS nr_documento,
       f.razao                                                              AS fornecedor,
       (p.valor + coalesce(p.vendor, 0) - coalesce(p.desconto, 0))::numeric(13,2) AS valor,
       p.dtcompra                                                           AS emissao,
       p.dtvenc::date                                                       AS vencimento,
       coalesce(n.dtcontabil, p.dtcompra)                                   AS data_contabil,
       coalesce(p.txjuros, 0)                                               AS juros,
       n.nronf                                                              AS nota_fiscal,
       p.tipodoc                                                            AS tipo_documento,
       b.banco,
       p.obs                                                                AS observacao,
       p.codempresa                                                         AS codigo_empresa,
       e.razao_social                                                       AS empresa,
       o.nome                                                               AS operador,
       p.codapg                                                             AS codigo,
       p.codparceiro                                                        AS codigo_parceiro,
       p.nrparcela                                                          AS nr_parcela,
       p.vendor,
       p.convenio,
       b.codbco,
       p.quitada,
       p.idnf,
       p.gerado,
       p.nrodup,
       p.codoperador,
       p.codempresa                                                         AS idempresa,
       p.codcentrocusto,
       f.fantasia,
       f.desconto_pedidos                                                   AS descontopedido,
       p.desconto,
       p.valor                                                              AS valor_bruto,
       n.issqn,
       n.valorissqn,
       p.bloqueio,
       p.adcredito,
       p.codadiantamento,
       p.codbarrasblt                                                       AS codbarras,
       p.remessa_gerada,
       coalesce(p.agrupamento, 'N')                                         AS agrupamento,
       coalesce(p.agrupado, 'N')                                            AS agrupado,
       abx.codopbx                                                          AS cod_operador_bx,
       obx.nome                                                             AS operador_bx,
       abx.dtpgto::date                                                     AS data_bx
  FROM apagar p
  LEFT JOIN bancos b       ON b.codbco = p.codbco
  LEFT JOIN operadores o   ON o.codoperador = p.codoperador
  LEFT JOIN parceiros f    ON f.codparceiro = p.codparceiro
  LEFT JOIN empresas e     ON e.idempresa = p.codempresa
  LEFT JOIN nf n           ON n.codnf = p.idnf
  LEFT JOIN apagar_bx abx  ON abx.codapg = p.codapg AND coalesce(abx.indr, 'I') = 'I'
  LEFT JOIN operadores obx ON obx.codoperador = abx.codopbx;
COMMENT ON VIEW get_cp IS 'CONTAS A PAGAR 2';

-- ──────────────────────────────────────────────────── GET_CX (CAIXAS) ──────────────────────────────────────────────────────
-- (o operador casa pelo código da OPERADORA — `o.codoperador = cv.codoperadora` — como no legado)
DROP VIEW IF EXISTS get_cx;
CREATE VIEW get_cx AS
SELECT cv.nropdv                                                            AS nro_caixa,
       o.nome                                                               AS operador,
       cv.operacao,
       cv.valor,
       cv.debito_credito,
       cv.nropedido,
       cv.codoperadora                                                      AS codigo_operadora,
       cv.codcxvendas                                                       AS codigo_caixa_vendas,
       cv.idempresa
  FROM cx_vendas cv
  JOIN operadores o ON o.codoperador = cv.codoperadora;
COMMENT ON VIEW get_cx IS 'CAIXAS';

-- ──────────────────────────────────────────── GET_DRE_COMPETENCIA (DRE COMPETENCIA) ────────────────────────────────────────
DROP VIEW IF EXISTS get_dre_competencia;
CREATE VIEW get_dre_competencia AS
SELECT c.idempresa,
       coalesce(nf.dtcontabil, c.data::date)                                AS data,
       (SELECT ap.codapg FROM apagar ap WHERE ap.codgrupo = c.codgrupo ORDER BY ap.codapg LIMIT 1)::varchar(30) AS documento,
       c.codplc                                                             AS codigo_centro_custo,
       c.tiporecurso                                                        AS tipo_recurso,
       c.obs,
       pa.razao                                                             AS parceiro,
       p.desccodplc                                                         AS centro_custo,
       p.descricao                                                          AS descricao_centro_custo,
       coalesce(CASE WHEN p.tpconta = 0 THEN c.valor WHEN p.tpconta = 1 THEN 0 WHEN p.tpconta = 2 THEN 0 END, 0)::numeric(18,2) AS credito,
       coalesce(CASE WHEN p.tpconta = 0 THEN 0 WHEN p.tpconta = 1 THEN c.valor WHEN p.tpconta = 2 THEN 0 END, 0)::numeric(18,2) AS debito,
       (SELECT pl.desccodplc FROM plc pl WHERE pl.codplc = p.codpai)        AS nivel2_centro_custo,
       (SELECT pl.descricao FROM plc pl WHERE pl.codplc = p.codpai)         AS descricao_nivel2_centro_custo,
       (coalesce(substr(p.desccodplc, 1, 1), '') || '.')::varchar(150)      AS nivel1_centro_custo,
       (SELECT pl.descricao FROM plc pl WHERE pl.desccodplc = coalesce(substr(p.desccodplc, 1, 1), '') || '.' ORDER BY pl.codplc LIMIT 1) AS descricao_nivel1_centro_custo,
       o.nome                                                               AS operador,
       p.descplccontabil                                                    AS codigo_contabil_plc,
       pa.codcontabil_for                                                   AS codigo_contabil_parceiro,
       (SELECT ap.tipodoc FROM apagar ap WHERE ap.codgrupo = c.codgrupo ORDER BY ap.codapg LIMIT 1) AS tipo_documento
  FROM caixa c
  LEFT JOIN plc p         ON p.codplc = c.codplc
  LEFT JOIN operadores o  ON o.codoperador = c.operador
  LEFT JOIN parceiros pa  ON pa.codparceiro = c.codparceiro
  LEFT JOIN nf            ON nf.codnf = c.codnf
 WHERE NOT (c.obs LIKE '%DUPLICATA GERADA REFERENTE A BAIXA PARCIAL%') OR c.obs IS NULL;
COMMENT ON VIEW get_dre_competencia IS 'DRE COMPETENCIA';

-- ─────────────────────────────────────────── GET_NOTAS_SEM_PEDIDO (NOTAS_SEM_PEDIDO) ───────────────────────────────────────
DROP VIEW IF EXISTS get_notas_sem_pedido;
CREATE VIEW get_notas_sem_pedido AS
SELECT n.codnf,
       nnc.chavenfe,
       CASE WHEN n.cfop ~ '^\d+$' THEN n.cfop::numeric END                  AS cfop,
       c.descricao                                                          AS descricao_cfop,
       p.razao,
       p.fantasia,
       n.nronf,
       n.totalnf,
       n.dtcontabil
  FROM nfe_nao_cadastradas nnc
  LEFT JOIN nf n                             ON n.chavenfe = nnc.chavenfe
  LEFT JOIN parceiros p                      ON p.codparceiro = n.codparceiro
  LEFT JOIN cfop c                           ON c.codcfop = n.cfop
  LEFT JOIN analise_pedido_nf_nf apnn        ON apnn.apnn_ref_nf = nnc.codnfe_naocad
  LEFT JOIN analise_pedido_nf_pedido apnp    ON apnp.apn_id = apnn.apn_id
 WHERE apnp.codpedcomp IS NULL;
COMMENT ON VIEW get_notas_sem_pedido IS 'NOTAS_SEM_PEDIDO';

-- ───────────────────────────────────────── GET_TIPO_CODIGO_VENDIDO (RASTREIA_CODIGOS) ──────────────────────────────────────
DROP VIEW IF EXISTS get_tipo_codigo_vendido;
CREATE VIEW get_tipo_codigo_vendido AS
SELECT v.codigo_informado, v.codproduto, v.descricao, v.codigo_tipo
  FROM vendas v
 WHERE v.dtvenda >= current_date - 5 AND v.dtvenda < current_date + 1
   AND v.codigo_tipo <> 'CB' AND v.codigo_tipo IS NOT NULL
 GROUP BY v.codigo_informado, v.codproduto, v.descricao, v.codigo_tipo;
COMMENT ON VIEW get_tipo_codigo_vendido IS 'RASTREIA_CODIGOS';

-- ────────────────────────────────────────────── GET_VALORES_CARTAO (VALORES CARTAO) ────────────────────────────────────────
DROP VIEW IF EXISTS get_valores_cartao;
CREATE VIEW get_valores_cartao AS
SELECT ot.operadora,
       c.valor,
       coalesce(c.valorliq, (c.valor + coalesce(c.valor_ajuste_baixa, 0)) - (c.valor * tx.txadm / 100))::numeric(15,2) AS valor_com_taxa,
       c.dtvenda                                                            AS data,
       CASE extract(dow FROM tx.base) WHEN 0 THEN tx.base + interval '1 day' WHEN 6 THEN tx.base + interval '2 days' ELSE tx.base END AS previsao_compensacao,
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
            ELSE 'OUTROS TIPO DE CARTAO' END                                AS tipocartao,
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
       c.dtcadastro                                                         AS data_cadastro
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
           c.dtvenda + make_interval(days => (CASE WHEN coalesce(otx.diafechamento, 0) > 0 THEN coalesce(otx.diafechamento, 0) ELSE coalesce(ot.diascomp, 0) END
                                             * coalesce(c.nroparcela, 1))::int) AS base
  ) tx;
COMMENT ON VIEW get_valores_cartao IS 'VALORES CARTAO';

-- ──────────────────────────────────────────────────── GET_VENDAS (VENDAS) ──────────────────────────────────────────────────
DROP VIEW IF EXISTS get_vendas;
CREATE VIEW get_vendas AS
SELECT v.nropedido,
       c.razao                                                              AS cliente,
       v.nrocupom                                                           AS nro_cupom,
       o.nome                                                               AS operador,
       sum(CASE WHEN v.iat = 'A' THEN round(v.qtde * v.vrvenda, 2) ELSE trunc(v.qtde * v.vrvenda * 100) / 100 END) AS total,
       v.idempresa,
       v.codvendas,
       v.dtvenda::date                                                      AS data,
       c.codparceiro                                                        AS codcliente,
       sum(coalesce(v.desc_acre_medio, 0) + coalesce(v.desc_acre_item, 0) + coalesce(v.desc_departamento, 0) * -1
           + coalesce(v.desc_promocao, 0) * -1)::numeric(15,4)              AS desc_acre,
       coalesce(v.importado, 'N')                                           AS importado,
       v.cancelado,
       v.venda_nfc                                                          AS nfc
  FROM vendas v
  LEFT JOIN parceiros c  ON c.codparceiro = v.codparceiro
  LEFT JOIN operadores o ON o.codoperador = v.operador
 GROUP BY v.nropedido, c.razao, v.nrocupom, o.nome, v.idempresa, v.codvendas, v.dtvenda::date, c.codparceiro, v.importado,
          v.cancelado, v.venda_nfc;
COMMENT ON VIEW get_vendas IS 'VENDAS';

-- ───────────────────────────────────────────────── GET_VENDASRELAT (VENDAS;) ───────────────────────────────────────────────
DROP VIEW IF EXISTS get_vendasrelat;
CREATE VIEW get_vendasrelat AS
SELECT v.nropedido,
       c.codparceiro                                                        AS codigo_parceiro,
       c.razao                                                              AS cliente,
       v.nrocupom                                                           AS nro_cupom,
       p.codbarra                                                           AS cod_barra,
       v.vrcusto                                                            AS vr_custo,
       v.vrvenda                                                            AS vr_venda,
       v.qtde                                                               AS quantidade,
       v.promocao,
       v.descricao,
       v.unidade,
       v.aliquota,
       o.codoperador                                                        AS codigo_operador,
       o.nome                                                               AS operador,
       v.nroitem                                                            AS iditem,
       d.descricao                                                          AS departamento,
       g.descricao                                                          AS grupo,
       sg.descricao                                                         AS sub_grupo,
       v.comissao,
       ve.razao                                                             AS vendedor,
       v.desc_acre,
       v.pis,
       v.idempresa,
       v.codvendas,
       v.dtvenda                                                            AS data_hora,
       v.dtvenda::date                                                      AS data,
       to_char(v.dtvenda, 'HH24:MI:SS')::varchar(20)                        AS hora,
       0.00::numeric(13,2)                                                  AS desc_item,
       NULL::varchar(3)                                                     AS tipo,
       v.codvendedor                                                        AS codigo_vendedor,
       v.cancelado,
       p.idproduto                                                          AS codigo_produto,
       f.codparceiro                                                        AS codigo_fornecedor,
       f.razao                                                              AS razao_fornecedor,
       p.tipopis,
       (sum(v.qtde * v.vrvenda) + avg(v.desc_acre))::numeric(13,2)          AS total
  FROM vendas v
  LEFT JOIN parceiros c      ON c.codparceiro = v.codparceiro
  LEFT JOIN parceiros ve     ON ve.codparceiro = v.codvendedor
  LEFT JOIN operadores o     ON o.codoperador = v.operador
  LEFT JOIN produtos p       ON p.idproduto = v.codproduto
  LEFT JOIN parceiros f      ON f.codparceiro = p.codfor
  LEFT JOIN familias_prod d  ON d.codfamilia = v.coddpto
  LEFT JOIN familias_prod g  ON g.codfamilia = v.codgrupo
  LEFT JOIN familias_prod sg ON sg.codfamilia = v.codsubgrupo
 GROUP BY v.nropedido, c.codparceiro, c.razao, v.nrocupom, p.codbarra, v.vrcusto, v.vrvenda, v.qtde, v.promocao, v.descricao,
          v.unidade, v.aliquota, o.codoperador, o.nome, v.nroitem, d.descricao, g.descricao, sg.descricao, v.comissao, ve.razao,
          v.desc_acre, v.pis, v.idempresa, v.codvendas, v.dtvenda, v.codvendedor, v.cancelado, p.idproduto, f.codparceiro,
          f.razao, p.tipopis;
COMMENT ON VIEW get_vendasrelat IS 'VENDAS;';

-- ───────────────────────────────────────── GET_ESTOQUE_TOTALIZADO (ESTOQUE TOTALIZADO) ─────────────────────────────────────
DROP VIEW IF EXISTS get_estoque_totalizado;
CREATE VIEW get_estoque_totalizado AS
SELECT t.idproduto, t.descricao, t.idempresa, t.vrvenda, t.vrcusto, t.servico, sum(t.qtde) AS total_qtde, t.dpto AS departamento,
       t.unidade, t.codbarra
  FROM (SELECT e.idproduto, p.descricao, e.idempresa, m.vrvenda, e.qtde, m.vrcusto, p.servico, j.descricao AS dpto, p.unidade, p.codbarra
          FROM estoque e
          LEFT JOIN produtos p      ON p.idproduto = e.idproduto
          LEFT JOIN familias_prod j ON j.codfamilia = p.coddpto
          JOIN multi_preco m        ON m.idproduto = p.idproduto
        UNION ALL
        SELECT d.idproduto, p.descricao, d.idempresa, m.vrvenda, d.qtde, m.vrcusto, p.servico, j.descricao AS dpto, p.unidade, p.codbarra
          FROM estoque_dep d
          LEFT JOIN produtos p      ON p.idproduto = d.idproduto
          LEFT JOIN familias_prod j ON j.codfamilia = p.coddpto
          JOIN multi_preco m        ON m.idproduto = p.idproduto) t
 GROUP BY t.idproduto, t.idempresa, t.descricao, t.vrvenda, t.vrcusto, t.servico, t.dpto, t.unidade, t.codbarra;
COMMENT ON VIEW get_estoque_totalizado IS 'ESTOQUE TOTALIZADO';

-- ─────────────────────────────────────────── GET_PRODUTOS_ESTOQUE (PRODUTOS E ESTOQUE) ─────────────────────────────────────
DROP VIEW IF EXISTS get_produtos_estoque;
CREATE VIEW get_produtos_estoque AS
SELECT p.codbarra,
       p.descricao,
       m.vrcusto,
       m.vrcustoreal                                                        AS custo_total,
       m.vrvenda,
       m.vrcustorep                                                         AS custo_reposicao,
       e.qtde,
       ed.qtde                                                              AS qtde_dep,
       p.ativo,
       d.descricao                                                          AS departamento,
       g.descricao                                                          AS grupo,
       sg.descricao                                                         AS subgrupo,
       f.razao                                                              AS fornecedor,
       p.unidade,
       m.markup,
       p.codfor,
       p.aliquota,
       p.balanca,
       m.promocao,
       m.vrpromo,
       p.pis,
       p.tipopis,
       p.fatorkg,
       p.fatorcx,
       p.codbalanca,
       p.descmax,
       p.especificacao,
       p.composicao,
       p.idproduto                                                          AS codigo,
       e.qtde * m.vrcusto                                                   AS totalcusto,
       e.qtde * m.vrvenda                                                   AS totalvenda,
       em.idempresa                                                         AS empresa,
       e.idempresa                                                          AS empresa_estoque,
       ed.idempresa                                                         AS empresa_estoque_dep,
       e.minimo,
       ed.minimo                                                            AS minimo_dep,
       p.coddpto                                                            AS cod_departamento,
       p.codgrupo                                                           AS cod_grupo,
       p.codsubgrupo                                                        AS cod_subgrupo,
       e.local,
       p.servico,
       m.ativo                                                              AS ativo_venda,
       p.ativo_compra,
       m.ativo_compra                                                       AS ativo_compra_mp,
       0                                                                    AS maximo,
       p.ncmsh                                                              AS ncm,
       m.idempresa                                                          AS empresa_preco,
       dt.icm_efetivo,
       m.creditopiscofins, m.icme, m.creditoicm, m.debitoicm, m.debitopiscofins, m.vendaliq, m.lucrobrutov, m.lucrobrutop,
       m.despopv, m.lucroliqv, m.lucroliqp, m.imprend, m.contsocial, m.margeml2v, m.margeml2, m.ipi, m.frete, m.despacessorio,
       m.seguro, m.icmst,
       CASE e.idempresa WHEN 1 THEN coalesce(e.qtde, 0) ELSE 0 END          AS empresa01,
       CASE e.idempresa WHEN 2 THEN coalesce(e.qtde, 0) ELSE 0 END          AS empresa02,
       CASE e.idempresa WHEN 3 THEN coalesce(e.qtde, 0) ELSE 0 END          AS empresa03,
       CASE e.idempresa WHEN 4 THEN coalesce(e.qtde, 0) ELSE 0 END          AS empresa04,
       p.altera_descricao_cotacao,
       pprod.codperfil                                                      AS cod_perfil_produto,
       pprod.perfil                                                         AS perfil_produto,
       pdep.codperfil                                                       AS cod_perfil_departamento,
       pdep.perfil                                                          AS perfil_departamento,
       p.imobilizado,
       p.uso_consumo,
       length(p.codbarra)                                                   AS digitos_codbarra,
       coalesce(p.fatorcx_prod, 1)                                          AS fatorcx_producao
  FROM produtos p
  LEFT JOIN familias_prod d  ON d.codfamilia = p.coddpto
  LEFT JOIN familias_prod g  ON g.codfamilia = p.codgrupo
  LEFT JOIN familias_prod sg ON sg.codfamilia = p.codsubgrupo
  LEFT JOIN parceiros f      ON f.codparceiro = p.codfor
  LEFT JOIN empresas em      ON em.idempresa > 0
  JOIN estoque e             ON e.idproduto = p.idproduto AND e.idempresa = em.idempresa
  JOIN estoque_dep ed        ON ed.idproduto = p.idproduto AND ed.idempresa = em.idempresa
  LEFT JOIN multi_preco m    ON m.idproduto = p.idproduto AND m.idempresa = em.idempresa
  LEFT JOIN det_aliquota dt  ON dt.aliquota = p.aliquota AND dt.uf = em.uf
  LEFT JOIN perfil pprod     ON pprod.codperfil = p.codperfil_compra
  LEFT JOIN perfil pdep      ON pdep.codperfil = d.codperfil_compra
 GROUP BY p.codbarra, p.descricao, m.vrcusto, m.vrcustoreal, m.vrcustorep, m.vrvenda, e.qtde, ed.qtde, p.ativo, d.descricao,
          g.descricao, sg.descricao, f.razao, p.unidade, m.markup, p.codfor, p.aliquota, p.balanca, m.promocao, m.vrpromo, p.pis,
          p.tipopis, p.fatorkg, p.fatorcx, p.codbalanca, p.descmax, p.especificacao, p.composicao, p.idproduto, em.idempresa,
          e.idempresa, ed.idempresa, e.minimo, ed.minimo, p.coddpto, p.codgrupo, p.codsubgrupo, e.local, p.servico, m.ativo,
          p.ativo_compra, m.ativo_compra, e.maximo, p.ncmsh, m.idempresa, dt.icm_efetivo, m.creditopiscofins, m.icme,
          m.creditoicm, m.debitoicm, m.debitopiscofins, m.vendaliq, m.lucrobrutov, m.lucrobrutop, m.despopv, m.lucroliqv,
          m.lucroliqp, m.imprend, m.contsocial, m.margeml2v, m.margeml2, m.ipi, m.frete, m.despacessorio, m.seguro, m.icmst,
          p.altera_descricao_cotacao, pprod.codperfil, pprod.perfil, pdep.codperfil, pdep.perfil, p.imobilizado, p.uso_consumo,
          p.fatorcx_prod;
COMMENT ON VIEW get_produtos_estoque IS 'PRODUTOS E ESTOQUE';
