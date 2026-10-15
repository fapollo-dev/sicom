-- 423 — as configurações que o cadastro de Contas a Receber (uCadAReceber) lê e o destino não tinha, com os valores e overrides da
-- produção em 14/10/2026: o motivo ao trocar o cliente (N; o módulo Retaguarda exige), a troca do cliente nas outras parcelas (S),
-- a situação obrigatória (N; o módulo Retaguarda exige), as travas do título automático (S) e o banco padrão (vazio). A unicidade
-- é por CODIGO (o smoke semeia algumas em tempo de execução com outro id): só entra o que não existe.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao)
SELECT v.id, v.codigo, v.valor, v.tipovalor, v.permitidas, v.descricao
  FROM (VALUES
    (31,  'EXIGE_MOTIVO_ALTERACAO_CLIENTE_CR', 'N', 'String', 'Modulo', 'Exige motivo ao alterar um cliente (btnGravarClick/VerificaAlteracaoCliente, uCadAReceber.pas:881).'),
    (35,  'ATUALIZA_CLIENTE_OUTRAS_CR', 'S', 'String', 'Modulo;Empresa;Grupo;Usuario', 'Ao trocar o cliente de uma parcela, troca nas outras contas do mesmo grupo (InsereLogAlteracaoCliente).'),
    (119, 'INFORMA_SITUACAO_DOC_CONTAS_RECEBER', 'N', 'String', 'Modulo;Empresa;Grupo;Usuario', 'Obriga informar a situação do documento ao cadastrar uma conta a receber.'),
    (201, 'BLOQUEIA_CONTAS_RECEBER_ORIGEM_AUTO', 'S', 'String', 'Modulo;Empresa', 'Bloquear campos da tela de contas a receber para financeiros gerados de forma automática.'),
    (305, 'BANCO_PADRAO_CR', '', 'Integer', 'Modulo;Empresa;Grupo;Usuario', 'Banco padrão para lançamento de contas a receber (SetaBancoPadrao, uCadAReceber.pas:4041).')
  ) AS v(id, codigo, valor, tipovalor, permitidas, descricao)
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes c WHERE c.codigo = v.codigo OR c.id = v.id);
INSERT INTO configuracoes_especificas (id, tipo, chave, valor)
SELECT c.id, 'Modulo', 'Retaguarda', 'S' FROM configuracoes c
 WHERE c.codigo IN ('EXIGE_MOTIVO_ALTERACAO_CLIENTE_CR', 'INFORMA_SITUACAO_DOC_CONTAS_RECEBER')
   AND NOT EXISTS (SELECT 1 FROM configuracoes_especificas e WHERE e.id = c.id AND e.tipo = 'Modulo' AND e.chave = 'Retaguarda');
-- o motivo de operação de Contas a Receber da produção (MOTIVOS_OPERACAO TIPO_OPERACAO 'CR')
INSERT INTO motivos_operacao (codmotivoop, descricao, tipo_operacao)
SELECT 21, 'QUEBRA DE CAIXA', 'CR' WHERE NOT EXISTS (SELECT 1 FROM motivos_operacao WHERE codmotivoop = 21);
