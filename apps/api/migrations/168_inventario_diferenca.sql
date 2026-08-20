-- 168 — INVENTÁRIO / BALANÇO corte-3: o "Relatório Diferença do Balanço para Estoque"
-- (RelatorioDiferencaBalancoClick, uInventario.pas:1981-2057) e os dois comandos menores do popup
-- ("Zerar Qtde na Grade" e "Atualizar Custo do Inventário à partir do Cadastro dos Produtos").
--
-- ⚠️ A MEDIÇÃO DO GOLDEN MUDOU O DESENHO (e evitou duas colunas inventadas):
--   • `INVENTARIO` no Oracle tem CODINVENT, IDPRODUTO, CODBARRA, QTDE, DESCRICAO, VRCUSTO, CODSUBGRUPO, ALIQUOTA,
--     UNIDADE, DATAINVENTARIO, IDEMPRESA, VRVENDA, TIPO, **DIFERENCA**, **ALTERADO**, IDUNICO, IMPORTADO, SEQUENCIA.
--     **NÃO existem `QTDE_IST`, `STATUS`, `TOTAL_CUSTO`, `TOTAL_VENDA` nem `SELECIONAR`** — são campos calculados do
--     ClientDataSet (memória). Por isso o relatório NÃO persiste nada: ele mexe em QTDE/QTDE_IST/DIFERENCA no
--     dataset, imprime, e depois RESTAURA `QTDE := QTDE_IST` (uInventario.pas:2042-2054). No Apollo ele é read-only.
--   • `ALTERADO` = 'N' em **79.119 das 79.190** linhas e NULL em 71 — **nunca 'T'**. O 'T' só é gravado no Enter da
--     grade (uInventario.pas:2239, em memória) e o save em massa grava 'N'/'S' por cima; o relatório é para rodar
--     ANTES de gravar. Logo a cascata de 9 casos do relatório é **cópia-fiel-negativa no dado**: com a folha
--     gravada, todas as linhas caem no ramo `else` (diferença 0 e quantidade zerada na impressão).
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS alterado  char(1) DEFAULT 'N';
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS diferenca numeric(13,3);

-- as duas opções do popup que este corte usa e que existem no golden (34 linhas / 15 operadores cada);
-- "Zerar Qtde na Grade" **não tem opção própria** lá ⇒ responde ao gate da tela.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT v.form, v.opcao, v.codoperador, v.codempresa
FROM (VALUES
  ('FRMINVENTARIO', 'ATUALIZACUSTODOINVENTRIOCOMOPRODUTO1', 7, 1),
  ('FRMINVENTARIO', 'ATUALIZACUSTODOINVENTRIOCOMOPRODUTO1', 7, 2),
  ('FRMINVENTARIO', 'BTNIMPRIMIR', 7, 1),
  ('FRMINVENTARIO', 'BTNIMPRIMIR', 7, 2)
) AS v(form, opcao, codoperador, codempresa)
WHERE NOT EXISTS (
  SELECT 1 FROM permissoes p
  WHERE p.form = v.form AND p.opcao = v.opcao AND p.codoperador = v.codoperador AND p.codempresa = v.codempresa
);
