-- 203 — CONSTRUTOR DE RELATÓRIOS corte-3: as QUATRO fontes que destravam 24 dos 45 relatórios do cliente que
-- ainda não tinham de onde ler. Dossiê: `uRelatorio-construtor.md`.
--
-- Medido: dos 95 relatórios que o cliente montou, 42 já tinham fonte no Apollo. Dos 45 que faltavam,
-- `GET_RCB` sozinha responde por **13**, `GET_APAGARBX` por 4, `GET_ARECEBERBX` por 4 e `GET_CP_CEN` por 3.
--
-- ⚠️ **estas views não são a cópia integral das do legado** e é de propósito. A `GET_RCB` do cliente tem 73
-- colunas e 5 KB de DDL (com o cálculo de juros e multa embutido três vezes); os relatórios dele usam **25**.
-- Aqui entram as colunas que os relatórios usam, com **os nomes que o legado lhes dá** — que é o que faz as
-- definições importadas funcionarem. O cálculo de juros/multa fica de fora por enquanto: ele merece o próprio
-- confronto com produção (a `get_areceber` já tem uma versão), e nenhum dos 13 relatórios usa a coluna JURO.
--
-- O rótulo (o `COMMENT`) é o do cliente, como nas 28 da mig 202 — é ele que põe a fonte no catálogo.

-- ── A RECEBER (GET_RCB) — 13 relatórios ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW get_rcb AS
SELECT r.codrcb                                    AS codigo,
       p.razao                                     AS cliente,
       coalesce(p.razao, '') || ' (' || r.codparceiro || ')' AS cliente_completo,
       r.codparceiro                               AS codigo_cliente,
       e.cnpj_cpf,
       e.endereco                                  AS endereco_cobranca,
       e.bairro                                    AS bairro_cobranca,
       e.cidade                                    AS cidade_cobranca,
       e.uf                                        AS uf_cobranca,
       e.telefone,
       r.dtvenc::date                              AS data_vencimento,
       r.dtvenda::date                             AS data_venda,
       r.dtpgto::date                              AS data_pagamento,
       r.valor,
       r.txjuros,
       r.duplicata,
       r.nrocupom                                  AS nro_cupom,
       r.docnf                                     AS nro_nf,
       r.nroped                                    AS nro_pedido,
       r.obs,
       r.tipodoc                                   AS tipo_documento,
       r.quitada,
       r.gerado,
       r.codempresa                                AS idempresa,
       r.codbco,
       r.idnf,
       r.nrodup,
       r.nrodup                                    AS parcela,
       r.codvendedor                               AS codigo_vendedor,
       r.codcobrador                               AS codigo_cobrador,
       r.codplc,
       p.codconvenio,
       cv.razao                                    AS desconvenio,
       p.ativado,
       r.consiliado                                AS consilidado,
       r.agrupamento,
       r.agrupado,
       r.idsituacao_nf                             AS codigo_situacao_documento,
       s.descricao                                 AS situacao_documento,
       r.codadiantamento,
       r.txmulta,
       r.idpgto,
       r.codgrupo_agrupamento_rcb                  AS codgrupo
  FROM areceber r
  LEFT JOIN parceiros p     ON p.codparceiro = r.codparceiro
  LEFT JOIN parceiros_end e ON e.codparceiro = r.codparceiro AND coalesce(e.endereco_padrao, 'S') = 'S'
  LEFT JOIN parceiros cv    ON cv.codparceiro = p.codconvenio
  LEFT JOIN situacao_nf s   ON s.idsituacao_nf = r.idsituacao_nf;
COMMENT ON VIEW get_rcb IS 'A RECEBER';

-- ── CONTAS A PAGAR BAIXADAS (GET_APAGARBX) — 4 relatórios ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW get_apagarbx AS
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
       a.valor                                     AS valor_documento,
       (a.valor + coalesce(a.vendor,0) - coalesce(a.desconto,0)) AS valor_bruto_documento,
       coalesce(b.acre_desc,0)                     AS acres_desc,
       coalesce(b.juros,0)                         AS juros,
       coalesce(b.multa,0)                         AS multa,
       b.obs                                       AS observacao,
       o.nome                                      AS operador_baixa,
       b.codopbx                                   AS codigo_operadorbx,
       b.idlote                                    AS lote,
       a.nrodup                                    AS nr_parcela,
       a.idnf                                      AS nr_nf,
       a.tipodoc                                   AS tipo_documento,
       p.codcontabil_for                           AS cod_contabil_forn,
       b.contabilizado,
       a.cod_desconto_titulo,
       a.txjuros                                   AS tx_juros,
       a.codplc                                    AS plc,
       a.codempresa                                AS idempresa,
       b.indr
  FROM apagar_bx b
  JOIN apagar a             ON a.codapg = b.codapg
  LEFT JOIN parceiros p     ON p.codparceiro = a.codparceiro
  LEFT JOIN parceiros_end e ON e.codparceiro = a.codparceiro AND coalesce(e.endereco_padrao, 'S') = 'S'
  LEFT JOIN operadores o    ON o.codoperador = b.codopbx;
COMMENT ON VIEW get_apagarbx IS 'CONTAS A PAGAR BAIXADAS';

-- ── CONTAS A RECEBER BAIXADAS (GET_ARECEBERBX) — 4 relatórios ──────────────────────────────────────────────
CREATE OR REPLACE VIEW get_areceberbx AS
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
       (b.valorpg + coalesce(b.acre_desc,0))       AS valor_liquido,
       coalesce(b.acre_desc,0)                     AS acres_desc,
       coalesce(b.juros,0)                         AS juros,
       coalesce(b.multa,0)                         AS multa,
       b.obs                                       AS historico,
       o.nome                                      AS operador_baixa,
       b.codopbx                                   AS codigo_operadorbx,
       b.idlote                                    AS lote,
       r.nrocupom                                  AS nro_cupom,
       r.docnf                                     AS nro_nf,
       r.nroped                                    AS nro_pedido,
       r.obs,
       p.codref                                    AS codref,
       p.codconvenio,
       p.codcontabil,
       r.tipodoc                                   AS tipo,
       r.consiliado                                AS consilidado,
       b.contabilizado,
       r.cod_desconto_titulo,
       r.txjuros                                   AS tx_juros,
       r.codempresa                                AS idempresa,
       b.indr
  FROM areceber_bx b
  JOIN areceber r           ON r.codrcb = b.codrcb
  LEFT JOIN parceiros p     ON p.codparceiro = r.codparceiro
  LEFT JOIN parceiros_end e ON e.codparceiro = r.codparceiro AND coalesce(e.endereco_padrao, 'S') = 'S'
  LEFT JOIN formas_pgto f   ON f.idpgto = r.idpgto
  LEFT JOIN operadores o    ON o.codoperador = b.codopbx;
COMMENT ON VIEW get_areceberbx IS 'CONTAS A RECEBER BAIXADAS';

-- ── CONTAS A PAGAR POR CENTRO DE CUSTO (GET_CP_CEN) — 3 relatórios ─────────────────────────────────────────
-- Uma linha por RATEIO do título (`CX_APAGAR`), não por título — é o que faz dela uma fonte diferente da
-- `get_apagar`: o mesmo documento aparece uma vez por centro de custo, com o valor daquele centro.
CREATE OR REPLACE VIEW get_cp_cen AS
SELECT a.codapg                                    AS codigo,
       a.duplicata                                 AS nr_documento,
       p.razao                                     AS fornecedor,
       a.codparceiro                               AS codigo_parceiro,
       cx.valor                                    AS valor,
       a.valor                                     AS valor_bruto,
       a.dtcompra::date                            AS emissao,
       a.dtvenc::date                              AS vencimento,
       a.dtpgto::date                              AS data_bx,
       a.dtvenda::date                             AS data_contabil,
       coalesce(a.desconto,0)                      AS desconto,
       a.idnf                                      AS nota_fiscal,
       a.tipodoc                                   AS tipo_documento,
       a.codbco,
       a.obs                                       AS observacao,
       a.codempresa                                AS codigo_empresa,
       a.nrodup                                    AS nr_parcela,
       a.vendor,
       a.quitada,
       a.gerado,
       a.agrupamento,
       a.agrupado,
       a.codadiantamento,
       cx.codcc                                    AS codplc,
       plc.descricao                               AS centro_custo,
       plc.descricao                               AS descricao,
       plc.desccodplc                              AS codigo_centro_custo
  FROM cx_apagar cx
  JOIN apagar a         ON a.codapg = cx.codapg
  LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro
  LEFT JOIN plc         ON plc.codplc = cx.codcc;
COMMENT ON VIEW get_cp_cen IS 'CONTAS A PAGAR 2 CENTRO DE CUSTO';
