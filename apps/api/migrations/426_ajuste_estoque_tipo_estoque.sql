-- 426 — a auditoria do Ajuste de estoque (UajusteEstoque): a configuração TIPO_ESTOQUE que o CBdestinoExit lê (:487 — 'L' = só loja:
-- "Ajuste de estoque no depósito, bloqueado!"), com o valor global da produção em 15/10/2026 ('A', ambos; valores L/D/X/A). A
-- específica da loja 1 ('L' na produção) vem na carga das CONFIGURACOES_ESPECIFICAS.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao)
SELECT 16, 'TIPO_ESTOQUE', 'A', 'String', 'Empresa;Grupo;Usuario', 'Define o tipo de estoque da Empresa (L loja, D depósito, X almoxarifado, A ambos).'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes c WHERE c.codigo = 'TIPO_ESTOQUE' OR c.id = 16);
