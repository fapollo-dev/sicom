-- 389 — a versão INTEGRAL do legado das fontes do construtor que também servem a uma TELA (`rel_<fonte>`).
--
-- `get_apagar` e `get_nf` são do catálogo do construtor (o COMMENT da mig 202) e são também a consulta das telas de contas a
-- pagar e de NF — com as colunas que a tela usa (`codapg`, `dtvenc`, `juro`…), não as do legado. Os relatórios do cliente
-- (14 sobre GET_APAGAR, 10 sobre GET_NF, dos 95 da produção) leem as colunas do legado pelo NOME (`NR_DOCUMENTO`,
-- `VENCIMENTO`, `STATUS_NFE`…) e ficavam pendentes na importação. Mexer na view da tela quebraria a tela; por isso a versão
-- do legado vive ao lado, com o prefixo `rel_`, e o construtor lê dela quando ela existe (`relacaoDaFonte`). A `rel_` NÃO leva
-- COMMENT: não entra no catálogo — o cliente continua vendo "CONTAS A PAGAR" e "NF", como no legado.
--
-- Colunas na ordem e com a semântica de ALL_VIEWS/ALL_TAB_COLUMNS da produção (só leitura, 29/09/2026). No fim, com o mesmo
-- nome, as colunas da view da tela que o legado não tem (é o que mantém de pé o que já foi montado aqui sobre a fonte).
--
-- O que é do legado e fica, mesmo parecendo errado (é o que os relatórios dele mostram):
--   · GET_APAGAR: só os títulos EM ABERTO (QUITADA='N', sem adiantamento de crédito, não agrupados) — 7.932 na produção, um por
--     título; VALOR = valor + vendor − desconto e VALOR_BRUTO = o valor do título; JUROS = a TAXA (não o juro calculado);
--     EMISSAO = a emissão da NOTA (nulo em título sem nota); o CNPJ_CPF (e o do cedente) é o do endereço ATIVO que NÃO é o
--     primeiro do parceiro (`ROWID > MIN(ROWID)`, aqui `CODEND > MIN(CODEND)` — iguais em 18.984 dos 18.986 parceiros): como
--     18.962 parceiros têm um endereço só, a coluna sai VAZIA em 100% dos títulos da produção; a DESCRICAO é o centro de custo
--     do primeiro rateio do grupo; TIPO_SERVICO e FORMA_PAGTO decodificam o código de barras do boleto.
--   · GET_NF: só NF com parceiro (INNER JOIN); o CNPJ é o do endereço da NOTA (CODPARCEIRO_END); TIPO_EMISSAO 'P' só quando
--     TIPOEMISSAO = 0 (nulo sai 'T'); ALIQUOTA_FUNRURAL fixa em 0,015; OBS_NF/OBS_NF_AUXILIAR com o COALESCE(x,'') do Oracle
--     (onde '' é nulo — a observação vazia continua nula); PRECIFICADA/USUARIO/DATA do primeiro item precificado.
-- Uma diferença deliberada: a PRECIFICADA negativa na produção é 'NÃƒO' (4 caracteres, U+00C3 U+0192 — o 'NÃO' em UTF-8 lido
-- como cp1252 quando a view foi criada; 49.845 das 49.851 NF). É acidente de codificação, não regra: aqui sai 'NÃO'. Nenhum dos
-- relatórios do cliente filtra por ela.

-- ────────────────────────────────────────────── GET_APAGAR (CONTAS A PAGAR) ────────────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_apagar;
CREATE VIEW rel_get_apagar AS
SELECT p.duplicata                                                          AS nr_documento,
       f.razao                                                              AS fornecedor,
       (p.valor + coalesce(p.vendor, 0) - coalesce(p.desconto, 0))::numeric(13,2) AS valor,
       n.dtemissao                                                          AS emissao,
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
       (SELECT g.descricao FROM plc g JOIN cx_apagar a ON a.codcc = g.codplc
         WHERE a.codgrupo = p.codgrupo ORDER BY a.codcxapagar LIMIT 1)       AS descricao,
       p.bloqueio,
       p.codadiantamento,
       p.codbarrasblt                                                       AS codbarras,
       p.remessa_gerada,
       q.cnpj_cpf,
       p.codparceirocedente                                                 AS codigo_parceiro_cedente,
       ce.razao                                                             AS fornecedor_cedente,
       cee.cnpj_cpf                                                         AS cnpj_cpf_cedente,
       CASE WHEN coalesce(p.codbarrasblt, '') = '' THEN 'INDEFINIDO'
            WHEN substr(p.codbarrasblt, 1, 1) = '8' AND substr(p.codbarrasblt, 2, 1) IN ('5', '1') THEN 'TRIBUTOS'
            ELSE 'FORNECEDOR' END                                           AS tipo_servico,
       f.habilita_retencao_funrural_nf                                      AS funrural,
       CASE WHEN coalesce(p.codbarrasblt, '') = '' THEN 'INDEFINIDO'
            WHEN substr(p.codbarrasblt, 1, 1) = '8' AND substr(p.codbarrasblt, 2, 1) = '1' THEN 'IPTU'
            WHEN substr(p.codbarrasblt, 1, 1) = '8' AND substr(p.codbarrasblt, 2, 1) = '5' THEN
              CASE substr(p.codbarrasblt, 17, 4)
                WHEN '0239' THEN 'FGTS' WHEN '0179' THEN 'FGTS' WHEN '0328' THEN 'DARF SIMPLES' WHEN '0064' THEN 'DARF'
                WHEN '0924' THEN 'DPVAT' WHEN '0213' THEN 'LICENCIAMENTO' WHEN '0063' THEN 'IPVA'
                ELSE 'OUTROS TRIBUTOS' END
            WHEN substr(p.codbarrasblt, 1, 1) = '8' THEN 'CONCESSIONARIA'
            WHEN substr(p.codbarrasblt, 1, 3) = '341' THEN 'ITAU'
            ELSE 'OUTROS BANCOS' END                                        AS forma_pagto,
       CASE WHEN EXISTS (SELECT 1 FROM areceber rcb WHERE coalesce(rcb.quitada, 'N') = 'N' AND rcb.codparceiro = p.codparceiro)
            THEN 'S' ELSE 'N' END                                           AS fornecedor_possui_debito,
       p.baixa_auto_paga,
       p.baixa_autorizada,
       p.baixa_auto_trans,
       p.baixa_autentica_trans,
       p.retorno_op,
       p.chavenfe,
       n.obs                                                                AS obs_nota,
       -- as da view da tela (get_apagar) que o legado não tem
       g.codapg, g.codparceiro, g.codempresa, g.consiliado, g.razao, g.duplicata, g.dtvenda, g.dtvenc, g.txjuros,
       g.dias_atrazo, g.dias_tolerancia, g.juro, g.total, g.agrupado, g.contabilizado, g.tipodoc, g.origem,
       g.cadastrado_manualmente, g.dtpgto, g.idpgto, g.codplc, g.idsituacao_nf
  FROM apagar p
  JOIN get_apagar g           ON g.codapg = p.codapg
  LEFT JOIN bancos b          ON b.codbco = p.codbco
  LEFT JOIN operadores o      ON o.codoperador = p.codoperador
  LEFT JOIN parceiros f       ON f.codparceiro = p.codparceiro
  LEFT JOIN parceiros_end q   ON q.codparceiro = f.codparceiro AND coalesce(q.ativado, 'S') = 'S'
                             AND q.codend > (SELECT min(x.codend) FROM parceiros_end x WHERE x.codparceiro = q.codparceiro)
  LEFT JOIN empresas e        ON e.idempresa = p.codempresa
  LEFT JOIN nf n              ON n.codnf = p.idnf
  LEFT JOIN parceiros ce      ON ce.codparceiro = p.codparceirocedente
  LEFT JOIN parceiros_end cee ON cee.codparceiro = ce.codparceiro AND coalesce(cee.ativado, 'S') = 'S'
                             AND cee.codend > (SELECT min(x.codend) FROM parceiros_end x WHERE x.codparceiro = cee.codparceiro)
 WHERE p.quitada = 'N' AND coalesce(p.adcredito, 'N') = 'N' AND coalesce(p.agrupado, 'N') = 'N';

-- ────────────────────────────────────────────────────── GET_NF (NF) ────────────────────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_nf;
CREATE VIEW rel_get_nf AS
SELECT n.codnf                                                              AS codigo,
       CASE WHEN n.nronf ~ '^\s*\d+\s*$' THEN trim(n.nronf)::numeric(32) END AS nro_nf,
       n.nronf                                                              AS nronf_descritivo,
       n.dtemissao                                                          AS data_emissao,
       p.codparceiro                                                        AS cod_parceiro,
       p.razao                                                              AS parceiro,
       n.totalprod                                                          AS total_produtos,
       n.totalnf                                                            AS total_nf,
       n.proc                                                               AS processada,
       n.cancelada,
       n.printsucess                                                        AS impressa,
       n.idempresa,
       n.tipo,
       n.codparceiro                                                        AS codigo_parceiro,
       n.dtcontabil                                                         AS data_contabil,
       n.dtprocessamento::date                                              AS data_processamento,
       n.dtchegada                                                          AS data_chegada,
       CASE WHEN n.statusnfe = 'P' AND n.tpemissao = 1 THEN 'NFE ENVIADA A RECEITA'
            WHEN n.statusnfe = 'P' AND n.tpemissao IN (6, 7) THEN 'NFE ENVIADA EM CONTINGENCIA'
            WHEN n.statusnfe = 'C' AND n.tpemissao = 1 THEN 'NFE CANCELADA NA RECEITA'
            WHEN n.statusnfe = 'C' AND n.tpemissao IN (6, 7) THEN 'NFE CANCELADA EM CONTINGENCIA'
            WHEN n.statusnfe = 'D' THEN 'NFE DENEGADA NA RECEITA'
            ELSE n.statusnfe::varchar END                                   AS status_nfe,
       n.chavenfe                                                           AS chave_nfe,
       n.nf_importacao_nfe,
       CASE WHEN n.cfop ~ '^\d+$' THEN n.cfop::numeric END                  AS cfop,
       o.nome                                                               AS usuario,
       e.cnpj_cpf,
       replace(replace(replace(e.cnpj_cpf, '.', ''), '-', ''), '/', '')     AS cnpj_cpf_sem_mascara,
       n.modelo,
       CASE n.tipoemissao WHEN '0' THEN 'P' ELSE 'T' END                    AS tipo_emissao,
       n.dtimportacao::date                                                 AS data_importacao,
       n.produc_status                                                      AS status_industria,
       n.tpemissao                                                          AS tipoemissao_sefaz,
       nullif(n.obsnf, '')                                                  AS obs_nf,
       nullif(n.obs, '')                                                    AS obs_nf_auxiliar,
       e.uf                                                                 AS titular_uf,
       n.totalicm                                                           AS total_icms,
       n.issqn,
       n.valorissqn                                                         AS valor_issqn,
       coalesce(n.total_icmst_externo, 0)                                   AS total_icms_recolher,
       coalesce(n.icms_st_pago_fonte, 0)                                    AS total_icms_pago_fonte,
       coalesce(n.icms_st_apagar, 0)                                        AS total_icms_st_pagar,
       coalesce(p.habilita_retencao_funrural_nf, 'N')                       AS funrural,
       (1.5::numeric(13,2) / 100)                                           AS aliquota_funrural,
       p.tipofj,
       n.finalidade,
       CASE WHEN n.versaoxml ~ '^\d+(\.\d+)?$' THEN n.versaoxml::numeric END AS versaoxml,
       n.totaldesc,
       CASE WHEN pr.codnf IS NULL THEN 'NÃO' ELSE 'SIM' END                 AS precificada,
       pr.usuario_precifica,
       pr.data_precifica,
       CASE WHEN EXISTS (SELECT 1 FROM nf_referencia r WHERE r.codnf = n.codnf) THEN 'S' ELSE 'N' END AS nfe_de_devolucao,
       (SELECT nf1.nronf FROM nf_referencia nr JOIN nf nf1 ON nf1.codnf = nr.codnf
         WHERE nr.codnf_ref = n.codnf ORDER BY nr.codnfreferencia LIMIT 1)   AS nfe_devolvida,
       -- as da view da tela (get_nf) que o legado não tem
       n.codnf, n.nronf, n.serie, n.dtemissao, n.codparceiro, n.idsituacao_nf, s.descricao AS situacao, n.statusnfe, n.proc, n.totalnf
  FROM nf n
  JOIN parceiros p            ON p.codparceiro = n.codparceiro
  LEFT JOIN parceiros_end e   ON e.codend = n.codparceiro_end
  LEFT JOIN operadores o      ON o.codoperador = n.usultalteracao
  LEFT JOIN situacao_nf s     ON s.idsituacao_nf = n.idsituacao_nf
  LEFT JOIN LATERAL (SELECT i.codnf, i.usuario_precifica, i.data_precifica FROM nf_prod i
                      WHERE i.codnf = n.codnf AND i.usuario_precifica IS NOT NULL ORDER BY i.codnfprod LIMIT 1) pr ON true;
