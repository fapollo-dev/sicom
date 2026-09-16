-- 225 — ANÁLISE DE COMPRA × VENDA (`FRMRELENTSAI`): só o gate de tela. 84 acessos, 10 operadores.
--
-- Por produto: quanto entrou (compra por nota) e quanto saiu (venda do PDV), em quantidade e em dinheiro.
-- Nenhuma coluna nova — `vendas`, `nf_prod` e `produtos` já têm tudo.
--
-- ⚠️ Registro de uma divergência entre telas do próprio legado: o custo de entrada aqui trata
-- `NF_PROD.DESCONTO` como PERCENTUAL (`VRCUSTO − VRCUSTO × DESCONTO/100`), igual ao Relatório de Compras
-- (mig 213) — e é o certo, provado no dado. Já o Entradas e Saídas (mig 217) subtrai o mesmo campo como se
-- fosse reais, o que lhe custa R$ 178.994,93 por ano. Três telas, a mesma coluna, dois entendimentos.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMRELENTSAI', 'FRMRELENTSAI', 7, 1)
ON CONFLICT DO NOTHING;
