-- EFD ICMS-IPI: a configuração que a view GET_CONFIG_NFCE_CONTIGENCIA lê (NFC-e em contingência, STATUSNFE 'G', entra no C100 com 'S')
-- — a linha da produção (CONFIGURACOES id 293, 'N', sem específicas).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 293) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 293 END,
       'CONSIDERA_NFCE_CONTINGENCIA_SPED_FISCAL', 'N', 'String', 'Considerar NFCe com status em contingência.', 'S;N|Sim;Nao', 'Modulo', 'Sped',
       'Considerar NFCe com status em contingência.'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'CONSIDERA_NFCE_CONTINGENCIA_SPED_FISCAL');
