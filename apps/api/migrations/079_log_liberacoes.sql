-- 079 — OPERADORES: LOG_LIBERACOES (auditoria de liberações por supervisor) — corte-1 (fundação).
--
-- Regra viva (uCadUsuarios §29 / call sites uPedidoCompra.pas:3741, UBaixaAreceber.pas:453, uNF.pas:1486…):
-- ação que excede a alçada de um operador exige RE-AUTENTICAÇÃO (login+senha) de um supervisor AUTORIZADO;
-- todo evento (grant OU negação) é auditado em LOG_LIBERACOES. Este corte cria a TABELA + o serviço de registro
-- + a consulta. O cadastro de quem-libera-o-quê (corte-2) e o ChamaLiberacaoLogin/validar (corte-3) vêm depois.
--
-- Fiel ao Oracle (LOG_LIBERACOES, verificado READ-ONLY 2026-07-14): ID, USUARIO_SISTEMA, USUARIO_LIBEROU(200,
-- guarda o CÓDIGO do autorizador como STRING — golden tem '7904'/'3462', não login), USUARIO_ESTACAO(200),
-- DATA_LIBERACAO(ts), LIBERACAO(1020, descrição da ação), COMPUTADOR(200). SEM coluna de empresa (schema-global).
CREATE TABLE IF NOT EXISTS log_liberacoes (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_sistema integer REFERENCES operadores(codoperador),  -- operador que PEDIU a liberação (pode ser null)
  usuario_liberou varchar(200) NOT NULL,                       -- código do AUTORIZADOR (string, fiel ao golden)
  usuario_estacao varchar(200),                                -- usuário da estação (web → null/nome do request)
  data_liberacao  timestamptz NOT NULL DEFAULT now(),
  liberacao       varchar(1020),                               -- descrição da ação liberada
  computador      varchar(200)
);
CREATE INDEX IF NOT EXISTS ix_log_liberacoes_data ON log_liberacoes (data_liberacao);

-- RBAC da consulta (form próprio da tela de liberações).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMLIBERACOES', 'BTNCONSULTAR', 7, 1), ('FRMLIBERACOES', 'BTNCONSULTAR', 7, 2)
ON CONFLICT DO NOTHING;
