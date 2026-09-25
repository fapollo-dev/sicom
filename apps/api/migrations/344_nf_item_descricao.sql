-- 344 — a DESCRIÇÃO do item da NF (NF_PROD.DESCRICAO). O Apollo não a gravava: todo item nascido nele ficava sem descrição, enquanto o
-- legado sempre a preenche (a do produto ao escolhê-lo, uItensNF.pas:2531; a da origem na importação). O gravar da NF passa a preenchê-la
-- e o diálogo do item a deixa editar com EDITAR_DESCRICAO_ITEM_NF='S' (uItensNF.pas:3657). A configuração com o valor e os textos da
-- produção (25/09/2026: 'N', sem específicas); a carga a substitui pela do cliente. O ID é o da produção quando está livre na base.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 6) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 6 END,
       'EDITAR_DESCRICAO_ITEM_NF', 'N', 'String', 'Define se será liberada a edição do campo de descrição do item da nota fiscal', 'S;N|Sim;Não', 'Modulo;Empresa;Grupo;Usuario', 'Nota Fiscal', 'Editar descrição de item da NF'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'EDITAR_DESCRICAO_ITEM_NF');
