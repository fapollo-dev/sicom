-- 221 — INTERSECÇÃO DE PRODUTOS (`FRMRELINTERSECCAOPRODUTOS`): só o gate de tela. 117 acessos, 10 operadores.
--
-- "O que mais o cliente leva quando leva este produto" — análise de cesta sobre os cupons.
--
-- ⛔ `VENDAS_INTER` **não entra no destino**, e a ausência é deliberada. No legado ela é uma **tabela de
-- trabalho global**: o relatório roda `DELETE FROM VENDAS_INTER` (sem filtro), grava os cupons do produto
-- pesquisado e depois faz join com ela. Com dois operadores simultâneos, o segundo apaga os cupons do
-- primeiro e **os dois recebem resultado errado, sem erro na tela** — com 10 operadores usando a tela, e
-- numa aplicação web onde todos compartilham o servidor, isso deixa de ser hipótese.
--
-- O serviço faz tudo numa consulta só, com os cupons num CTE: mesmo resultado, sem tabela intermediária e
-- sem corrida. Não há dado a migrar — a tabela é rascunho, não registro.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMRELINTERSECCAOPRODUTOS', 'FRMRELINTERSECCAOPRODUTOS', 7, 1)
ON CONFLICT DO NOTHING;
