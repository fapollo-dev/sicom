-- A ANÁLISE AUTOMÁTICA dos itens da NF (UAnalisaItemNF — [F7] repasse automático / [F8] um item): as duas configurações que ela lê,
-- com as linhas da produção (CONFIGURACOES id 14 e 248; a específica do módulo Retaguarda do id 14).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 14) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 14 END,
       'BLOQUEIA_ANALISE_AUTOMATICA_ITENS_NF', 'N', 'String',
       'Bloqueia o atalho F7, na tela de Analise de Itens, para não realizar a análise automática de itens da nota fiscal', 'S;N|Sim;Não',
       'Modulo;Empresa;Grupo;Usuario', 'Nota Fiscal', 'Bloquear a análise automática de itens da NF'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'BLOQUEIA_ANALISE_AUTOMATICA_ITENS_NF');
INSERT INTO configuracoes_especificas (id, tipo, chave, valor)
SELECT id, 'Modulo', 'Retaguarda', 'N' FROM configuracoes WHERE codigo = 'BLOQUEIA_ANALISE_AUTOMATICA_ITENS_NF'
ON CONFLICT DO NOTHING;

INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 248) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 248 END,
       'OBRIGA_SITUACAONF_ANALISA_ITEM_NF', 'S', 'String',
       'Define se, ao analisar itens da nota fiscal e a situação ainda não estiver preenchida, obriga ao usuário a informar a situação de documento primeiro.',
       'S;N|Sim;Não', 'Modulo;Empresa;Grupo;Usuario', 'Nota Fiscal', 'Obrigar a inserir a situação de documento ao analisar itens da nota fiscal'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'OBRIGA_SITUACAONF_ANALISA_ITEM_NF');
