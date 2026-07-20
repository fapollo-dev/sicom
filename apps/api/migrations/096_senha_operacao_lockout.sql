-- LOCKOUT da SENHA DE OPERAÇÃO por empresa (E7 fast-follow). O gate 'DESC'/'ADMIN'/'CANCEL'/'GAVETA' verificava a
-- senha SEM contar tentativas → um insider podia forçar-bruta um segredo curto (limitação CONSCIENTE do E7 c2a).
-- Endurecimento (espelha o lockout de login do corte-3c, mas por (empresa, tipo)): N falhas consecutivas bloqueiam
-- aquele tipo de senha da empresa por M minutos; senha correta zera; janela expirada recomeça. Estado no tenant.
CREATE TABLE IF NOT EXISTS empresas_senha_lockout (
  idempresa     integer NOT NULL,
  tipo          varchar(10) NOT NULL,   -- admin / desc / cancel / gaveta
  tentativas    integer NOT NULL DEFAULT 0,
  bloqueado_ate timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idempresa, tipo)
);

-- configs do lockout (GLOBAL/Modulo; default 5 tentativas / 15 min — 0 = sem lockout). cfgNum cai no default se ausente.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (333, 'AUTH_MAX_TENTATIVAS_SENHA_OPERACAO', '5',  'numero', 'Modulo', 'Falhas consecutivas na senha de operação (por empresa+tipo) que bloqueiam (0 = sem lockout).'),
  (334, 'AUTH_BLOQUEIO_SENHA_OPERACAO_MINUTOS', '15', 'numero', 'Modulo', 'Minutos de bloqueio da senha de operação após exceder AUTH_MAX_TENTATIVAS_SENHA_OPERACAO.')
ON CONFLICT (id) DO NOTHING;
