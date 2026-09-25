-- LIBERAR A NF DO USO DO INDEXADOR (uNF.pas:17780-17829): a configuração que mostra o menu e permite a liberação — a linha global da
-- produção (CONFIGURACOES id 78, 'N'); a específica por usuário (na produção só o usuário 1 = 'S') vem com a carga.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 78) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 78 END,
       'LIBERA_NF_USO_INDEXADOR', 'N', 'String',
       'Fornece, ao usuário, opção de liberar notas fiscais para não utilizar indexador tributário, deixando a nota fiscal livre para edição nos grupos de informação sobre ICMS.',
       'S;N|Sim;Não', 'Modulo;Empresa;Grupo;Usuario', 'Nota Fiscal', 'Liberação de nota fiscal do uso do indexador tributário'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'LIBERA_NF_USO_INDEXADOR');
