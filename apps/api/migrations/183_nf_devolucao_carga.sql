-- 183 — `ux_nf_cod_ped_dev_compra` também exclui o histórico carregado (§7b + ensaio da F2).
--
-- Medição: 7 pedidos de devolução do golden têm 2 a 3 NFs emitidas (15 linhas) — é o mesmo fenômeno do
-- recebimento parcial, que a mig 087 já reconheceu do outro lado (lá o `ux_nf_codpedcomp` foi removido porque o
-- legado é 1:N). Aqui o índice é **backstop anti-duplo** da devolução (nf.aggregate.ts:69 e
-- devolucao-compra.service.ts:183 → 23505 vira DEVOLUCAO_NF_JA_EMITIDA), então não se remove: estende-se o
-- predicado, como na mig 182. A proteção continua para devolução nova; o histórico entra.
DROP INDEX IF EXISTS ux_nf_cod_ped_dev_compra;
CREATE UNIQUE INDEX IF NOT EXISTS ux_nf_cod_ped_dev_compra
  ON nf (cod_ped_dev_compra)
  WHERE cod_ped_dev_compra IS NOT NULL AND coalesce(origem_legado, 'N') <> 'S';
