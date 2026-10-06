-- 410 — GET_ARECEBER: o JURO/TOTAL/DIAS_ATRAZO como a view da PRODUÇÃO (ALL_VIEWS, lida em 06/10/2026). A 015/043 transcreveram a fórmula
-- do sqqITENS_LOTECOB com o dia cheio; a GET_ARECEBER do cliente é outra:
--  - os dias = CURRENT_DATE − CAST(R.DTVENC AS DATE): o CURRENT_DATE do Oracle TEM a hora e o vencimento entra com a hora dele; o
--    CAST(... AS NUMERIC(10)) ARREDONDA (provado: CAST(0.5 AS INTEGER) = 1) — depois do meio-dia, o título vencido à meia-noite conta um
--    dia a mais (a GET_RCB, mais nova, trunca: TRUNC(CURRENT_DATE − TRUNC(DTVENC)) — a 388 está certa);
--  - o JURO usa a taxa diária ARREDONDADA a 2 casas (CAST(TXJUROS/30 AS NUMERIC(13,2)): 2% a.m. = 0,07/dia, não 0,0667); o TOTAL, a taxa
--    cheia — JURO e TOTAL − VALOR podem diferir, como no legado;
--  - a carência compara os dias fracionários com a TOLERANCIA (inteira: equivale ao dia cheio); TOLERANCIA nula cai no ramo do juro.
-- Os tipos das colunas ficam (dias_atrazo inteiro) — os consumidores (lista/leitura do contas a receber, juro padrão da baixa,
-- agrupamento, picker do lote de cobrança) não mudam.
CREATE OR REPLACE VIEW get_areceber AS
SELECT
  r.codrcb,
  r.codparceiro,
  r.codempresa,
  r.consiliado,
  p.razao,
  r.duplicata,
  r.dtvenda,
  r.dtvenc,
  r.valor,
  r.txjuros,
  round(CASE WHEN d.dias < 0 THEN 0 ELSE d.dias END)::integer                    AS dias_atrazo,
  COALESCE(p.tolerancia, 0)                                                      AS dias_tolerancia,
  CAST(
    CASE WHEN d.dias < p.tolerancia THEN 0
         ELSE CAST(COALESCE(CAST(r.txjuros / 30.0 AS numeric(13,2))
                            * round(CASE WHEN d.dias < 0 THEN 0 ELSE d.dias END)
                            * r.valor / 100, 0) AS numeric(13,2))
    END AS numeric(13,2))                                                         AS juro,
  CAST(
    CASE WHEN d.dias < p.tolerancia THEN r.valor
         ELSE COALESCE(r.txjuros / 30.0, 0)
              * COALESCE(round(CASE WHEN d.dias < 0 THEN 0 ELSE d.dias END) * r.valor / 100, 0)
              + r.valor
    END AS numeric(13,2))                                                         AS total,
  e.endereco,
  e.bairro,
  e.cidade,
  e.uf,
  e.telefone,
  -- ── colunas de gestão/estado acrescentadas (043) ──
  r.idnf,
  r.nrodup,
  r.quitada,
  r.agrupado,
  r.contabilizado,
  r.tipodoc,
  r.origem,
  r.gerado,
  r.cadastrado_manualmente,
  r.dtpgto,
  r.codvendedor,
  r.codcobrador,
  r.idpgto,
  r.codbco,
  r.codplc,
  r.idsituacao_nf
FROM areceber r
LEFT JOIN parceiros p     ON (p.codparceiro = r.codparceiro)
LEFT JOIN parceiros_end e ON (e.codend = p.codend)
LEFT JOIN LATERAL (SELECT extract(epoch FROM (localtimestamp - r.dtvenc::timestamp))::numeric / 86400 AS dias) d ON true;
