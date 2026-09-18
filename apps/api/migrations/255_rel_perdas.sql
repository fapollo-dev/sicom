-- 255 — RELATÓRIO DE PERDAS (`FRMRELPERDAS`, `URelPerdas.pas` 622 linhas + `.dfm` 1.448 + grade). **17 acessos,
-- 4 operadores.** O relatório sobre `SCRAP`/`SCRAP_ITEM` — o documento de perda/quebra que já vive no destino
-- (`cadastro/scrap`, com aplicar/estornar no estoque). Também abre a partir do próprio scrap (`Create(CodScrap)`).
--
-- Dois tipos: ANALÍTICO (um item por linha: scrap, data, centro de custo, parceiro, produto, qtde, custo, total,
-- fornecedor, setor, motivo, departamento, status da nota) com o resumo por CENTRO DE CUSTO embaixo; SINTÉTICO
-- (por produto: qtde, custo médio ponderado, total, fornecedor, setor, motivo, departamento) com o total por
-- EMPRESA. Filtros: período (`DT_CADASTRO`), parceiro, centro de custo, scrap, produto, setor, motivo,
-- departamento/grupo/subgrupo, fornecedor.
--
-- ── O que o dado diz ────────────────────────────────────────────────────────────────────────────────────
-- **3.794 scraps, 133.309 itens**, o último em **02/09/2026**; motivo "PERDA GERAL" em 98.925 itens (31.557
-- sem motivo); setor preenchido em 27.675 itens (21%); centro de custo em 100% dos scraps.
--
-- ── ⚠️ Um scrap com um item digitado errado vale 91% das perdas do ano ─────────────────────────────────
-- Em 2026 o custo das perdas soma **R$ 7.292.991,37** — e **R$ 6.645.919,88 (91,1%)** estão em UM scrap
-- (16155, de 22/08/2026, 3 itens): o item "MUCHIBA KG" com **139.502,008 kg** a R$ 47,64. Nos outros seis scraps
-- desse produto a quantidade média é 393 kg (máximo 1.300). Sem ele, 2026 fecha em R$ 647.071,49 — a mesma
-- ordem de grandeza de 2025 (R$ 1,88 mi) e 2024 (R$ 1,36 mi). O relatório do legado imprime o total sem
-- avisar; aqui os totais trazem o maior item e a sua participação, para o número não passar em silêncio.
--
-- ── Folds ───────────────────────────────────────────────────────────────────────────────────────────────
--  • `STATUSNOTA` do legado vem de `PEDIDO_NF (TIPO='S')` → `NF` (a NF de saída gerada pelo scrap; 81% dos scraps
--    de 2026 têm). `PEDIDO_NF` não existe no destino: o status da nota fica de fora; `mov_estoque` (o efeito no
--    estoque, que é o que a casa confere) e `importado` entram.
--  • Tenant-scoped (o legado monta `IDEMPRESA IN (lista)`); a grade `.fr3`: acessório.

CREATE INDEX IF NOT EXISTS ix_scrap_emp_data ON scrap (idempresa, dt_cadastro);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELPERDAS', 'FRMRELPERDAS', 7, 1)
ON CONFLICT DO NOTHING;
