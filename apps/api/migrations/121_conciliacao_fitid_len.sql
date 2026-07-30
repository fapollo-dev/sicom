-- 121 — CONCILIAÇÃO BANCÁRIA (OFX) corte-2: alarga o FITID. O parser real de arquivo .ofx (ofx-parser.ts) revelou
-- que bancos BR (Bradesco/Itaú) emitem FITIDs longos (o padrão OFX permite A-255). Com varchar(20) dois FITIDs
-- distintos do mesmo dia truncavam para a mesma chave → a 2ª transação era descartada como "duplicada" (dedup por
-- ux_mbo_fitid). Alarga mbo_transacao_id para 255 (spec OFX). CHECKNUM permanece 20 (spec OFX A-12 + margem).
-- ALTER COLUMN TYPE reconstrói ux_mbo_fitid automaticamente (coluna indexada).
ALTER TABLE movimentacao_bancaria_ofx ALTER COLUMN mbo_transacao_id TYPE varchar(255);
