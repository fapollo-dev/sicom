-- O PREÇO DE VENDA no processar da NF de entrada (UpdateProdutos, udmNF.pas:7352-7503; TfrmEstoqueNF.FormShow): as três configurações
-- que ele lê, com as linhas da produção (CONFIGURACOES id 278, 251 e 80) e as específicas do módulo Retaguarda (o on-line bloqueado e o
-- lote só do produto com o preço alterado). A específica da empresa 1 do GERA_LOTE_PROD_ALTERADO vem com a carga.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 278) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 278 END,
       'BLOQUEAR_ATUALIZA_PRECO_ONLINE_NF', 'N', 'String',
       'Define se, ao realizar o processamento da nota fiscal (tela estoque), o sistema irá bloquear a opção de atualizar preços on-line.', 'S;N|Sim;Não',
       'Modulo;Empresa;Grupo;Usuario', 'Nota Fiscal', 'Bloquear opção de atualizar preços on-line ao processar nota fiscal'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'BLOQUEAR_ATUALIZA_PRECO_ONLINE_NF');
INSERT INTO configuracoes_especificas (id, tipo, chave, valor)
SELECT id, 'Modulo', 'Retaguarda', 'S' FROM configuracoes WHERE codigo = 'BLOQUEAR_ATUALIZA_PRECO_ONLINE_NF'
ON CONFLICT DO NOTHING;

INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 251) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 251 END,
       'GERA_LOTE_PROD_ALTERADO', 'S', 'String',
       'Define se o sistema, ao processar, se marcado para gerar lote, irá gerar o lote de nf apenas dos produtos onde o valor de venda foi alterado em relação ao cadastro de produtos.',
       'S;N|Sim;Não', 'Modulo;Empresa', 'Nota Fiscal', 'Gerar lote de nf apenas de produtos com valor de venda alterado'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'GERA_LOTE_PROD_ALTERADO');
INSERT INTO configuracoes_especificas (id, tipo, chave, valor)
SELECT id, 'Modulo', 'Retaguarda', 'S' FROM configuracoes WHERE codigo = 'GERA_LOTE_PROD_ALTERADO'
ON CONFLICT DO NOTHING;

INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 80) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 80 END,
       'ENTRADA_ATUALIZAR_PRECO_GRUPO', 'N', 'String',
       'Define se no processamento das NF de entrada irá atualizar todos preços do mesmo grupo', 'S;N|Sim;Não',
       'Modulo;Empresa;Grupo;Usuario', 'Nota Fiscal', 'Define se na NF de entrada irá atualizar todos preços do mesmo grupo'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'ENTRADA_ATUALIZAR_PRECO_GRUPO');
