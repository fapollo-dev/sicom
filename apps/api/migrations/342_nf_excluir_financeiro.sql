-- 342 — FATURAMENTO DA NOTA, corte C: o "Excluir documentos financeiros" da NF (`ExcluirDocumentosFinanceiros`, uNF.pas:17710) é um
-- link da tela SEM permissão própria no legado — o gate é o configurador PERMITE_EXCLUIR_FINANCEIRO_DA_NF (S na produção) e o acesso à
-- tela (FRMNF/FRMNF: 171 concessões na produção). Aqui a concessão da tela para o operador de desenvolvimento; o "Estornar faturamento"
-- do Apollo (BTNESTORNARFATURAMENTO, mig 028, sem equivalente no legado) sai.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT 'FRMNF', 'FRMNF', 7, 1 WHERE NOT EXISTS (SELECT 1 FROM permissoes WHERE form = 'FRMNF' AND opcao = 'FRMNF' AND codoperador = 7 AND codempresa = 1);
DELETE FROM permissoes WHERE form = 'FRMNF' AND opcao = 'BTNESTORNARFATURAMENTO';
