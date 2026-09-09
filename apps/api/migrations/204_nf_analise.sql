-- 204 — ANÁLISE DE NOTAS FISCAIS (`FRMNFANALISE`, `UNFAnalise.pas` 1.547 linhas + `UdmNFAnalise`).
-- Dossiê: `uNFAnalise.md`. É a tela de maior uso ainda não migrada fora do PDV: **704 acessos, 19 operadores,
-- o último em 04/09/2026**.
--
-- A tela é um HUB de nove análises sobre notas (situação tributária, precificação, formas de pagamento,
-- conferência…). Este corte traz as duas que não dependem de nada além do que já temos:
--   **1 — Análise de Situação Tributária** e **8 — Análise de Conferência de Notas**.
--
-- ── 1. `nf.totaloutrasdesp` ────────────────────────────────────────────────────────────────────────────────
-- Está na consulta base da análise (`sqqNF`, `UdmNFAnalise.dfm:352`) e é uma das colunas do relatório.
-- Preenchida em **49.282 de 49.282** notas do cliente (100%) e **fora da nossa carga** — mais uma da série.
ALTER TABLE nf ADD COLUMN IF NOT EXISTS totaloutrasdesp numeric(13,2);

-- ── 2. `cfop.devolucao` ────────────────────────────────────────────────────────────────────────────────────
-- É o filtro "Incluir notas de devolução" da tela (`:734`): sem a coluna, não há como excluí-las. No cliente
-- 14 CFOPs estão marcados como devolução e 30 como não (354 sem marca, que a regra trata como "não").
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS devolucao char(1);

-- ── 3. RBAC ────────────────────────────────────────────────────────────────────────────────────────────────
-- O cliente concede o gate da tela; não há opção por botão (o "[F11] Imprimir" não é permissão separada).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES ('FRMNFANALISE', 'FRMNFANALISE', 7, 1)
ON CONFLICT DO NOTHING;
