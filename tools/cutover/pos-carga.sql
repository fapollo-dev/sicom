-- PÓS-CARGA — o que o Apollo precisa ter no banco e o LEGADO não tem.
--
-- O carregador TRUNCA cada tabela antes de carregar (o ensaio parte do vazio), e com isso leva junto as linhas que
-- as nossas migrations semeiam. Quase tudo que semeamos o legado também tem (vem na carga). O que fica aqui é a
-- exceção declarada: dado que o legado NÃO tem e o Apollo exige — reaplicado no fim da carga, idempotente.
-- Este arquivo é lido por `apps/api/scripts/carregar-cutover.ts` depois da última tabela e ANTES da conferência de
-- órfãos, para o que ele semeia contar como pai.

-- motivo 999: o legado grava CODMOTIVO = 999 em milhares de ajustes de estoque (4.874 em produção) e não tem a
-- linha em MOTIVOS_OPERACAO — lá não há FK. Aqui `ajuste_estoque.codmotivo` REFERENCES motivos_operacao, então a
-- linha precisa existir (é a mesma da mig 171, que a carga apaga ao truncar a tabela).
INSERT INTO motivos_operacao (codmotivoop, descricao)
SELECT 999, 'AJUSTE DE INVENTARIO (codigo 999 do legado)'
WHERE NOT EXISTS (SELECT 1 FROM motivos_operacao WHERE codmotivoop = 999);

-- CONFIGURAÇÕES QUE SÃO NOSSAS: o legado não tem estas cinco chaves (medido em produção, §7u do plano), elas são
-- semeadas por migration — e o TRUNCATE de `configuracoes` na carga apaga. Sem elas o app pós-virada fica sem
-- lockout de login, sem lockout da senha de operação e **sem fuso horário** (o `FUSO_HORARIO_ACESSO` governa a
-- janela de acesso do operador e todo balde de data por dia — lição 17). Reaplicadas com os mesmos valores das
-- migrations 071/096/107. `ON CONFLICT DO NOTHING` por id E por código: se o cliente um dia criar a chave no
-- legado, o valor dele prevalece.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao)
SELECT * FROM (VALUES
  (328, 'AUTH_MAX_TENTATIVAS_LOGIN',            '5',                 'numero', 'Modulo', 'Falhas consecutivas de login que bloqueiam o operador (0 = sem lockout).'),
  (329, 'AUTH_BLOQUEIO_LOGIN_MINUTOS',          '15',                'numero', 'Modulo', 'Minutos de bloqueio do operador após exceder AUTH_MAX_TENTATIVAS_LOGIN.'),
  (333, 'AUTH_MAX_TENTATIVAS_SENHA_OPERACAO',   '5',                 'numero', 'Modulo', 'Falhas consecutivas na senha de operação (por empresa+tipo) que bloqueiam (0 = sem lockout).'),
  (334, 'AUTH_BLOQUEIO_SENHA_OPERACAO_MINUTOS', '15',                'numero', 'Modulo', 'Minutos de bloqueio da senha de operação após exceder AUTH_MAX_TENTATIVAS_SENHA_OPERACAO.'),
  (335, 'FUSO_HORARIO_ACESSO',                  'America/Sao_Paulo', 'texto',  'Modulo', 'Fuso IANA para avaliar a janela de horário de acesso do operador (OPERADORES_RESTRICAO_ACESSO) no login/refresh.')
) AS c(id, codigo, valor, tipovalor, config_especificas_permitidas, descricao)
WHERE NOT EXISTS (SELECT 1 FROM configuracoes x WHERE x.id = c.id OR x.codigo = c.codigo);
