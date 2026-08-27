-- 180 — REVERTIDA por evidência do smoke (duas tentativas):
--   v1 removia `ux_codref_for` → o UPSERT do de-para (recebimento.service.ts:544, ON CONFLICT (codfor, codref))
--      deixou de funcionar;
--   v2 trocava por índice parcial + coluna `origem_legado` → o smoke quebrou com "invalid input syntax for type
--      integer: NaN" no caminho do de-para (a coluna nova entra num agregado que converte o que vê).
-- Conclusão: aqui a unicidade é USADA pelo app, e mexer nela custa mais do que resolve. A carga deduplica as
-- 76 chaves repetidas (230 linhas, todas com produtos diferentes) com regra contada no manifesto — mesma saída
-- de det_aliquota e caixa_pdv. Nada a alterar no schema.
SELECT 1;
