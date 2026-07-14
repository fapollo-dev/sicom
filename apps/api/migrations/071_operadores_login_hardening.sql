-- 071 — OPERADORES corte-3c: ENDURECIMENTO de segurança do login (lockout + auditoria de falha desconhecida).
-- DIVERGÊNCIA CONSCIENTE do legado: o retaguarda NÃO tem lockout, contador de tentativas, expiração nem
-- auditoria de FALHA (recon 3a: OPERADORES_ACESSOS só grava LOGON/LOGOFF). Isto é HARDENING além do legado
-- (recomendado pela auditoria adversarial do 3a — M3), não uma cópia fiel; sem golden a bater.

-- ── lockout por tentativas (no operador; cross-instância, pois é no banco) ────────────────────────
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS tentativas_login integer DEFAULT 0; -- falhas consecutivas
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS bloqueado_ate    timestamptz;       -- bloqueio temporário até

-- ── auditoria de falha de login DESCONHECIDO (codoperador vira NULLABLE; grava o login tentado) ──
ALTER TABLE operadores_acessos ALTER COLUMN codoperador DROP NOT NULL;              -- FAIL de login inexistente
ALTER TABLE operadores_acessos ADD COLUMN IF NOT EXISTS login_tentativa text;       -- o LOGIN digitado (unknown)

-- ── política (config GLOBAL — o login é pré-empresa; lida como valor-base, sem override por empresa) ──
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (328, 'AUTH_MAX_TENTATIVAS_LOGIN',  '5',  'numero', 'Modulo', 'Falhas consecutivas de login que bloqueiam o operador (0 = sem lockout).'),
  (329, 'AUTH_BLOQUEIO_LOGIN_MINUTOS', '15', 'numero', 'Modulo', 'Minutos de bloqueio do operador após exceder AUTH_MAX_TENTATIVAS_LOGIN.')
ON CONFLICT (id) DO NOTHING;

-- ── fixture do smoke: op 92 (LOCKTEST) independente do op 90 (que o §71 muta) ────────────────────
INSERT INTO operadores (codoperador, nome, login, tipoop, idgrupo, desabilitado, ativo, indr, solicitar_alteracao_senha, senha_hash)
  VALUES (92, 'OPERADOR LOCK TEST', 'LOCKTEST', 'OPE', 2, 'N', 'S', 'I', 'N',
          'scrypt$16384$8$1$967cf8df88ec38ad4689f8c0adf1313d$6d24a2d0223647f68e32ed96dec222ea7d314456d8ddcdcbd3e1fd4cefa4096a38e7affaa25678f593aa74c38ccda666a1fd8b69e76ba0d09aeea8208a831311')
ON CONFLICT (codoperador) DO NOTHING;

INSERT INTO relacao_operador_empresa (codoperador, codempresa)
SELECT 92, 1
WHERE NOT EXISTS (SELECT 1 FROM relacao_operador_empresa r WHERE r.codoperador = 92 AND r.codempresa = 1);
