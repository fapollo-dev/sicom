-- 228 — ANÁLISE DE ENTRADA × SAÍDA (`FRMANALISEENTRADAXSAIDA`): só o gate. 68 acessos, 9 operadores.
--
-- Por fornecedor e produto: quanto entrou pela nota e quanto saiu — e a saída pode vir de **pedidos** ou de
-- **vendas**, escolha do operador. Nenhuma coluna nova.
--
-- ⚠️ Os filtros do legado ANULAM o LEFT JOIN: `AND P.RAZAO LIKE :RAZAO` sobre um `LEFT JOIN PARCEIROS` faz
-- todo produto **sem** fornecedor sumir, porque `NULL LIKE '%%'` é falso — e o mesmo vale para grupo e
-- departamento. Medido: **4.502 produtos sem grupo** e **4.520 sem departamento** (de 47.711), o que em
-- agosto/2026 derrubaria **652 linhas de venda, 38 produtos, R$ 7.111,31**. Pouco em valor, invisível para
-- quem usa. Aqui o filtro só se aplica quando preenchido, e o produto sem cadastro aparece rotulado.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMANALISEENTRADAXSAIDA', 'FRMANALISEENTRADAXSAIDA', 7, 1)
ON CONFLICT DO NOTHING;
