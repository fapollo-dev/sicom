-- 217 — ENTRADAS E SAÍDAS (`FRMRELENTRADASSAIDAS`): só o gate de tela. 148 acessos, 20 operadores.
--
-- Dois relatórios: a listagem das notas do período e o comparativo por produto (quanto entrou × quanto saiu,
-- com médias e a posição de estoque ao lado). Nenhuma coluna nova: tudo já vinha na carga.
--
-- ⚠️ O relatório do legado tem um erro de R$ 178.994,93 por ano — ver o cabeçalho do serviço e o dossiê. Ele
-- calcula o valor do item como `(QUANTIDADE × VRCUSTO) − NP.DESCONTO`, e `DESCONTO` é **percentual**, não
-- valor. Aqui usamos `VRDESCPROD`, que é o valor em reais, e a tela avisa que o número vai diferir.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMRELENTRADASSAIDAS', 'FRMRELENTRADASSAIDAS', 7, 1)
ON CONFLICT DO NOTHING;
