-- Lote de Cobrança COMPLETO (legado-fiel): view de exibição do detalhe + RAZAO no master.
-- Roda DEPOIS de 005 (lote_cobranca/itens_lotecob), 014 (parceiros) e 015 (areceber) — os
-- JOINs precisam ver ARECEBER/PARCEIROS/PARCEIROS_END.

-- GET_ITENS_LOTECOB — reproduz LITERALMENTE o SQL do detalhe legado
-- (uDMCadLoteCobranca.dfm → sqqITENS_LOTECOB). Só CODRCB é coluna STORED do item; todo o
-- resto é LIVE-JOIN de ARECEBER→PARCEIROS→PARCEIROS_END, com JUROS/TOTAL computados pela
-- carência PARCEIROS.TOLERANCIA.
--
-- Fórmula JUROS/TOTAL — TRANSCRITA do legado (NÃO reconstruída): a regra é
--   atraso = CURRENT_DATE - DTVENC::date
--   se atraso < TOLERANCIA  ⇒ JUROS = 0          e TOTAL = VALOR
--   senão                    ⇒ JUROS = (TXJUROS/30) * max(0, atraso) * VALOR / 100
--                              TOTAL = VALOR + JUROS
-- (Observação fiel ao legado: a carência é '<' — atraso ESTRITAMENTE menor que a tolerância
--  zera o juro; e o nº de dias usado no cálculo é re-clampado a >=0 com GREATEST.)
CREATE OR REPLACE VIEW get_itens_lotecob AS
SELECT
  i.codilotcob,
  i.codlotecob,
  i.codrcb,
  p.codparceiro,
  p.razao,
  r.dtvenda,
  r.dtvenc,
  r.duplicata,
  r.valor,
  r.txjuros,
  CAST(
    CASE WHEN (CURRENT_DATE - r.dtvenc::date) < COALESCE(p.tolerancia, 0) THEN 0
         ELSE COALESCE((r.txjuros / 30.0)
                       * GREATEST(0, (CURRENT_DATE - r.dtvenc::date))
                       * r.valor / 100, 0)
    END AS numeric(13,2))  AS juros,
  CAST(
    CASE WHEN (CURRENT_DATE - r.dtvenc::date) < COALESCE(p.tolerancia, 0) THEN r.valor
         ELSE r.valor + COALESCE((r.txjuros / 30.0)
                       * GREATEST(0, (CURRENT_DATE - r.dtvenc::date))
                       * r.valor / 100, 0)
    END AS numeric(13,2))  AS total,
  e.endereco,
  e.bairro,
  e.cidade,
  e.uf,
  e.telefone
FROM itens_lotecob i
LEFT JOIN areceber r      ON (r.codrcb = i.codrcb)
LEFT JOIN parceiros p     ON (p.codparceiro = r.codparceiro)
LEFT JOIN parceiros_end e ON (e.codend = p.codend);

-- Estende a view de LISTAGEM do master p/ expor RAZAO do "Cobrador" (LEFT JOIN parceiros),
-- como o legado (sqqLoteCobranca: LOTE_COBRANCA L LEFT JOIN PARCEIROS P). Mantém qtd_itens.
-- DROP+CREATE (não OR REPLACE): a view de 005 já existe com outra ordem de colunas, e
-- CREATE OR REPLACE não permite renomear/reposicionar colunas existentes.
DROP VIEW IF EXISTS get_lote_cobranca;
CREATE VIEW get_lote_cobranca AS
SELECT
  l.codlotecob,
  l.codparceiro,
  l.data,
  p.razao,
  (SELECT count(*) FROM itens_lotecob i WHERE i.codlotecob = l.codlotecob) AS qtd_itens
FROM lote_cobranca l
LEFT JOIN parceiros p ON (p.codparceiro = l.codparceiro);
