-- 243 — ANÁLISE DE VENDAS DE PRODUTOS (`FRMRELATORIOVENDASDINAMICO` + `uGridRelatorio`).
-- **37 acessos, 8 operadores.** Nenhuma coluna nova: `PRODUTOS`, `VENDAS`, `NF`/`NF_PROD`, `ESTOQUE`,
-- `MULTI_PRECO`, `PARCEIROS` e `FAMILIAS_PROD`.
--
-- Uma linha por produto com o giro do período ao lado do cadastro: quanto vendeu, quanto custou, quando foi a
-- última venda, **quando foi a última compra e por quanto**, e o que tem em estoque.
--
-- ── Quatro defeitos do legado, os quatro medidos ──────────────────────────────────────────────────────
-- ⚠️ **`AND f.ativado = 'S'` no WHERE sobre `LEFT JOIN PARCEIROS`** anula o LEFT JOIN — produto **sem
--    fornecedor** ou com fornecedor inativo desaparece. Medido: **228 produtos** somem dos 47.699 com
--    `ATIVO_COMPRA='S'`. É o mesmo defeito já corrigido em outras quatro telas.
-- ⚠️ **a última compra não filtra empresa nem cancelamento** (`WHERE N.TIPO = 'E'` e nada mais): são **3
--    empresas** nas notas de entrada e **4 notas canceladas** — a "última compra" podia ser de outra loja ou
--    de uma nota que não existe mais.
-- ⚠️ **`MAX(N.DTCONTABIL)` e `MAX(N.CODNF)` são independentes**, e o custo sai da nota do maior CÓDIGO em vez
--    da mais recente. Medido: **1.431 de 19.966 produtos (7,2%)** têm as duas apontando para notas
--    diferentes. Aqui as duas vêm da MESMA nota, a mais recente.
-- ⚠️ **uma consulta por linha da grade** (`aqqConsultaCalcFields`, `:90`) só para buscar o saldo de estoque:
--    com milhares de produtos são milhares de idas ao banco. Aqui é um `LEFT JOIN`.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELATORIOVENDASDINAMICO', 'FRMRELATORIOVENDASDINAMICO', 7, 1)
ON CONFLICT DO NOTHING;
