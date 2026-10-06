-- 409 — LOTE DE COBRANÇA (`FRMCADLOTECOBRANCA`): os dias de atraso do JUROS/TOTAL como o Oracle os conta (sqqITENS_LOTECOB,
-- uDMCadLoteCobranca.dfm). A mig 016 usava o dia cheio (CURRENT_DATE do PG, sem hora); no Oracle o CURRENT_DATE TEM a hora e o
-- `CAST(... AS INTEGER)` ARREDONDA (provado na produção em 06/10/2026: CAST(0.5)=1, CAST(2.58)=3, CURRENT_DATE − TRUNC = 0,5997 às 14h23):
--  - JUROS: dias = round(agora − TRUNC(DTVENC)), zero quando agora − DTVENC (com a hora) < 0 — depois do meio-dia, um dia a mais;
--  - TOTAL: dias = round(agora − DTVENC) (sem o TRUNC: o vencimento com hora conta a partir da hora);
--  - a carência: agora − TRUNC(DTVENC) < TOLERANCIA (fracionário; TOLERANCIA é NUMBER(10,0), equivale ao dia cheio); TOLERANCIA nula
--    vai para o ramo do juro, como no legado (o COALESCE da 016 dava o mesmo resultado, fica a forma do fonte).
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
    CASE WHEN d.trunc_dias < p.tolerancia THEN 0
         ELSE CAST(COALESCE((r.txjuros / 30.0)
                            * (CASE WHEN d.dias < 0 THEN 0 ELSE round(d.trunc_dias) END)
                            * r.valor / 100, 0) AS numeric(13,2))
    END AS numeric(13,2))  AS juros,
  CAST(
    CASE WHEN d.trunc_dias < p.tolerancia THEN r.valor
         ELSE COALESCE(r.txjuros / 30.0, 0)
              * COALESCE((CASE WHEN d.dias < 0 THEN 0 ELSE round(d.dias) END) * r.valor / 100, 0)
              + r.valor
    END AS numeric(13,2))  AS total,
  e.endereco,
  e.bairro,
  e.cidade,
  e.uf,
  e.telefone
FROM itens_lotecob i
LEFT JOIN areceber r      ON (r.codrcb = i.codrcb)
LEFT JOIN parceiros p     ON (p.codparceiro = r.codparceiro)
LEFT JOIN parceiros_end e ON (e.codend = p.codend)
LEFT JOIN LATERAL (
  SELECT extract(epoch FROM (localtimestamp - date_trunc('day', r.dtvenc::timestamp)))::numeric / 86400 AS trunc_dias,
         extract(epoch FROM (localtimestamp - r.dtvenc::timestamp))::numeric / 86400          AS dias
) d ON true;
