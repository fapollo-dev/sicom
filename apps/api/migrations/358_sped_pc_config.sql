-- EFD-CONTRIBUIÇÕES (UspedPisCofins / UdmSpedPisCofins): as duas configurações que as views GET_CONFIG_ABATER_ICMS_PC e
-- GET_CONFIG_DECOMPOSICAO leem, com as linhas da produção (CONFIGURACOES id 308 e 152, 'N', sem específicas).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 308) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 308 END,
       'ABATER_ICMS_BASE_CALCULO_PIS_COFINS', 'N', 'String',
       'Abater valor do ICMS na base de calculo do PIS/COFINS quando produto tributado no ICMS e no PIS/COFINS', 'S;N|Sim;Nao',
       'Modulo;Empresa', 'SPED PIS/COFINS', 'Abater ICMS no PIS/COFINS.'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'ABATER_ICMS_BASE_CALCULO_PIS_COFINS');
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 152) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 152 END,
       'CONSIDERA_ITENS_DECOMPOSICAO_SPED_FISCAL', 'N', 'String',
       'Considerar os itens da decomposicao , caso a flag  "A entrada deste produto na NF. sera de forma decomposta" existente no cadastro do produto , na aba decomposicao esteja desmarcada.',
       'S;N|Sim;Nao', 'Modulo', 'Sped', 'Considerar os itens da decomposicao'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'CONSIDERA_ITENS_DECOMPOSICAO_SPED_FISCAL');
