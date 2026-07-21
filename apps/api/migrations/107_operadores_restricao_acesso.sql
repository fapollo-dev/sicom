-- 107 — OPERADORES_RESTRICAO_ACESSO: janela de HORÁRIO de acesso por operador (login gate).
-- Estrutura fiel ao Oracle homolog: CODRESTRICAO_ACESSO(PK), CODOPERADOR, DIASEMANA (1=domingo..7=sábado,
-- convenção Delphi DayOfWeek), HORA_INICIAL/HORA_FINAL 'HH:MM', INDR (soft-delete 'E'), auditoria.
-- SEMÂNTICA (janela PERMITIDA): operador SEM linha ativa = LIVRE (loga a qualquer hora); COM ≥1 linha ativa =
-- o (dia-da-semana, hora) do momento do login precisa cair em ALGUMA janela, senão o login é RECUSADO.
-- NOTA de procedência: o CÓDIGO de checagem NÃO existe neste snapshot do fonte legado (uLogin/uMenuSuperior só
-- têm o RBAC de formulário); a tabela é nova em homolog (1 linha, dtcadastro 2026-04). Implementado como
-- "novo por cima" (guia fiscal-usar-legado) pela ESTRUTURA + semântica padrão de janela de acesso.
CREATE TABLE IF NOT EXISTS operadores_restricao_acesso (
  codrestricao_acesso serial      PRIMARY KEY,
  codoperador         integer     NOT NULL,
  diasemana           integer     NOT NULL,          -- 1=domingo .. 7=sábado (Delphi DayOfWeek)
  hora_inicial        varchar(5)  NOT NULL,          -- 'HH:MM' (00:00–23:59)
  hora_final          varchar(5)  NOT NULL,          -- 'HH:MM' (inclusivo; janela não cruza a meia-noite)
  indr                char(1),                        -- 'E' = excluído (soft-delete); NULL/'I' = ativo
  usucadastro         integer,
  dtcadastro          timestamptz DEFAULT now(),
  usultalteracao      integer,
  dtultimalteracao    timestamptz,
  CONSTRAINT ck_restr_diasemana   CHECK (diasemana BETWEEN 1 AND 7),
  -- fold [MÉDIA]: guarda de banco contra linha suja (cutover/insert direto). O gate compara 'HH:MM'
  -- lexicograficamente → um valor não-zero-padded ('8:00') ou cross-meia-noite (22:00>02:00) casaria NADA
  -- e trancaria o operador 24/7 sem diagnóstico. O CHECK rejeita esses casos na origem (o schema Zod já
  -- protege o caminho da API; isto protege o resto).
  CONSTRAINT ck_restr_hora_inicial CHECK (hora_inicial ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT ck_restr_hora_final   CHECK (hora_final   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT ck_restr_hora_ordem   CHECK (hora_inicial < hora_final)
);
CREATE INDEX IF NOT EXISTS ix_restr_operador_ativo
  ON operadores_restricao_acesso (codoperador)
  WHERE coalesce(indr, 'I') <> 'E';

-- fold [ALTA]: o gate avalia dia-da-semana/hora no RELÓGIO DO BANCO (now() AT TIME ZONE), não no relógio do
-- processo Node (que num container/cloud sem TZ roda em UTC → janela 08–18 da loja avaliada em UTC tranca o
-- usuário no horário real). O fuso é configurável (default America/Sao_Paulo); decisão e auditoria passam a
-- usar o MESMO relógio (now()). Config GLOBAL (o login é pré-empresa).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (335, 'FUSO_HORARIO_ACESSO', 'America/Sao_Paulo', 'texto', 'Modulo', 'Fuso IANA para avaliar a janela de horário de acesso do operador (OPERADORES_RESTRICAO_ACESSO) no login/refresh.')
ON CONFLICT (id) DO NOTHING;

-- ── fixture do smoke: op 93 (HORTEST), senha smoke123, empresa 1 (isolado de 90/92; hash reusado do 071) ──
INSERT INTO operadores (codoperador, nome, login, tipoop, idgrupo, desabilitado, ativo, indr, solicitar_alteracao_senha, senha_hash)
  VALUES (93, 'OPERADOR HORARIO TEST', 'HORTEST', 'OPE', 2, 'N', 'S', 'I', 'N',
          'scrypt$16384$8$1$967cf8df88ec38ad4689f8c0adf1313d$6d24a2d0223647f68e32ed96dec222ea7d314456d8ddcdcbd3e1fd4cefa4096a38e7affaa25678f593aa74c38ccda666a1fd8b69e76ba0d09aeea8208a831311')
ON CONFLICT (codoperador) DO NOTHING;

INSERT INTO relacao_operador_empresa (codoperador, codempresa)
SELECT 93, 1
WHERE NOT EXISTS (SELECT 1 FROM relacao_operador_empresa r WHERE r.codoperador = 93 AND r.codempresa = 1);
