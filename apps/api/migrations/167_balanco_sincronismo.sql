-- 167 — INVENTÁRIO / BALANÇO corte-2: o SINCRONISMO. Dois comandos do popup que reconstroem a folha a partir de
-- uma foto somando o movimento do intervalo:
--   • "Importar Balanço e Atualizar Estoque" (ImportaBalancoSincronizar, uInventario.pas:1485) — repopula a folha
--     do zero; saldo nos DOIS sentidos; filtro de entrada por LISTA LITERAL de 14 CFOPs + PROC='S'/CANCELADA='N'.
--   • "Sincronizar Inventário (Entradas - Saídas)" (SincronizarInventrio1Click, uInventario.pas:2631) — recalcula
--     a folha JÁ EXISTENTE (não cria linha); filtro por `CFOP.PROC_QTDE='S'` e **sem** PROC/CANCELADA.
-- As duas rotinas discordam nos filtros — é assim no legado, e o dossiê registra a divergência.

-- o gate do segundo comando: `LEFT JOIN CFOP C ON C.CODCFOP = I.CFOP ... AND C.PROC_QTDE='S'` (udmInventario.dfm,
-- sqqMovimentos). Golden: 'S' em 366 CFOPs, 'N' em 17, NULL em 12 — o teste é estrito ('S'), então NULL fica FORA
-- (ao contrário do gate da apuração de ICMS, que é COALESCE(...,'N')='N'). Coluna de CARGA.
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS proc_qtde char(1);
