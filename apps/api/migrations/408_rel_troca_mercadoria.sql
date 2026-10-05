-- 408 — RELATÓRIO DE TROCA DE MERCADORIAS (`FRMRELTROCAMERCADORIAFOR`, uRelTrocaMercadoriaFor.pas): a permissão do operador do smoke.
-- O relatório lê as tabelas da troca (mig 118); o ITENS_TROCA_QTDE do legado é o próprio item (309/309, conferir-tabelas-fora.py).
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMRELTROCAMERCADORIAFOR', 'FRMRELTROCAMERCADORIAFOR', 7, 1)
ON CONFLICT DO NOTHING;
