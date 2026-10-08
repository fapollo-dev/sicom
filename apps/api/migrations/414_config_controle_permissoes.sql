-- CONTROLE_PERMISSOES (id 206) — o modo do controle de acesso: P(erfil) · U(suario) · A(mbos). O `GetConfigControlePermissao`
-- (udmPrincipal.pas:2698) lê `COALESCE(CE.VALOR, C.VALOR)`; o acesso (shared/acesso/acesso.service.ts) agora segue a config.
-- Catálogo como na produção (valor global 'Usuario', específica só de Módulo). A ESPECÍFICA da produção — Modulo/Retaguarda = 'A',
-- que põe o cliente em AMBOS — vem com a carga de CONFIGURACOES_ESPECIFICAS, não daqui: sem ela o tenant fica no modo usuário.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, categorias, descricaopequena, descricao, valorespossiveis, config_especificas_permitidas, obsoleto) VALUES
  (206, 'CONTROLE_PERMISSOES', 'Usuario', 'String', 'Controle de permissões', 'Define forma de realizar o controle de permissões',
   'Definir se o controle de acesso será realizado de acordo com o perfil do usuário, usuário ou ambos.', 'P;U;A|Perfil;Usuario;Ambos', 'Modulo', 'N')
ON CONFLICT DO NOTHING;
