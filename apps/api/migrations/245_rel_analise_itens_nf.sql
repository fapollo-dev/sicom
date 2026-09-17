-- 245 — ANÁLISE DE ITENS DA NOTA FISCAL (`FRMRELANALISEITENSNF`). **34 acessos, 4 operadores.**
-- Item a item das notas do período, com custo, base de cálculo, ICMS, ST e o que é isento. Nenhuma coluna
-- nova: `NF`, `NF_PROD`, `PARCEIROS` e `PRODUTOS`.
--
-- ── ⚠️ O `WHERE` do legado só filtra DATA ─────────────────────────────────────────────────────────────
-- `WHERE N.DTCONTABIL BETWEEN :D1 AND :D2` e nada mais: **sem empresa, sem tipo de nota, sem cancelamento**.
-- Medido em agosto/2026: **6.840 notas de entrada somadas com 943 de saída**, de **3 empresas**. Num
-- relatório de custo e crédito de ICMS, misturar entrada com saída e loja com loja não dá número de nada.
-- Aqui a empresa é a da sessão, o tipo é escolha (padrão **entrada**) e a cancelada fica fora por padrão.
--
-- ⚠️ **`NP.DESCONTO` sem `COALESCE`**: `((QUANTIDADE * VRCUSTO) - DESCONTO)` vira NULL quando o desconto é
-- nulo, e o item **some do somatório**. São **23 linhas** de 497.627, mas somem sem avisar.
--
-- Curiosidade sem efeito: `if Pos(FFiltro, 'N.CODNF') > 0` (`:138`) tem os argumentos invertidos — em Delphi
-- é `Pos(agulha, palheiro)` —, mas os dois ramos do `if` fazem exatamente a mesma coisa.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELANALISEITENSNF', 'FRMRELANALISEITENSNF', 7, 1)
ON CONFLICT DO NOTHING;
