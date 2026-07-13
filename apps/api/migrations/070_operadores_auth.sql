-- 070 — OPERADORES corte-3a: AUTENTICAÇÃO (login + hash de senha + JWT + auditoria de acesso).
-- Recon 3 frentes (Oracle READ-ONLY + fonte Delphi + monorepo). O legado guarda a senha em CIFRA REVERSÍVEL
-- (OPERADORES.SENHA = César +13, TJvCaesarCipher c/ chave-engodo → shift fixo 13; recon udmPrincipal.dfm:889).
-- DECISÃO do cutover (usuário): re-hashear as senhas decodificadas (César −13) com HASH real (scrypt do
-- node:crypto, zero-dep) E marcar solicitar_alteracao_senha='S' para TODOS → a senha atual entra 1x e a troca
-- é obrigatória no 1º acesso. Os BACKDOORS do legado (dev 'APOLLOSG', mestra 'SYSAPOLLO<dia><mês>',
-- SENHARETAGUARDA como mestra) NÃO são reimplementados. LOGIN_SENHA (CryptApollo) é redundante e descartado.
--
-- Colunas de política do legado: só existe SOLICITAR_ALTERACAO_SENHA (já migrada no 051). SEM lockout, SEM
-- expiração, SEM histórico, SEM mínimo — endurecimento consciente do novo: mínimo de 6 chars na NOVA senha
-- (schema), backdoors eliminados. Auditoria de login: OPERADORES_ACESSOS (LOGON/LOGOFF, sem falhas — fiel).

-- ── coluna de hash (a senha real do app novo) ─────────────────────────────────────────────────────
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS senha_hash text;  -- scrypt$N$r$p$salt$key (node:crypto)

-- ── auditoria de acesso (fiel a OPERADORES_ACESSOS: 49.793 linhas, TIPO LOGON/LOGOFF, sem FAIL) ────
CREATE TABLE IF NOT EXISTS operadores_acessos (
  id             integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  codoperador    integer NOT NULL REFERENCES operadores(codoperador),
  codempresa     integer,                        -- empresa selecionada no login
  dtacesso       timestamptz NOT NULL DEFAULT now(),
  ip             text,
  nomecomputador text,
  executavel     text DEFAULT 'WEB',             -- o legado grava Retaguarda.exe/Pdv.exe; aqui 'WEB'
  versao         text,
  tipo           text NOT NULL                   -- 'LOGON' | 'LOGOFF'
);
CREATE INDEX IF NOT EXISTS ix_operadores_acessos_op ON operadores_acessos (codoperador, dtacesso);

-- ── fixtures de teste (auth smoke) ────────────────────────────────────────────────────────────────
-- op 7 (login SMOKE) ganha senha 'smoke123' e NÃO precisa trocar (login normal). scrypt real gerado offline.
UPDATE operadores
   SET senha_hash = 'scrypt$16384$8$1$967cf8df88ec38ad4689f8c0adf1313d$6d24a2d0223647f68e32ed96dec222ea7d314456d8ddcdcbd3e1fd4cefa4096a38e7affaa25678f593aa74c38ccda666a1fd8b69e76ba0d09aeea8208a831311',
       solicitar_alteracao_senha = 'N'
 WHERE codoperador = 7;

-- empresa 91 (mínima) — fixture p/ o teste de SELEÇÃO de empresa no login (op com 2 empresas). Id ALTO
-- p/ não colidir com o smoke de EMPRESAS (que cria a empresa 2).
INSERT INTO empresas (idempresa, razao_social, cnpj, uf, classfiscal)
  VALUES (91, 'EMPRESA 91 (AUTH TEST)', '00000000009100', 'MG', 'LR')
ON CONFLICT (idempresa) DO NOTHING;

-- op 90 (login AUTHTEST): senha 'smoke123', vinculado a DUAS empresas → login sem empresa responde needsEmpresa.
INSERT INTO operadores (codoperador, nome, login, tipoop, idgrupo, desabilitado, ativo, indr, solicitar_alteracao_senha, senha_hash)
  VALUES (90, 'OPERADOR AUTH TEST', 'AUTHTEST', 'OPE', 2, 'N', 'S', 'I', 'N',
          'scrypt$16384$8$1$967cf8df88ec38ad4689f8c0adf1313d$6d24a2d0223647f68e32ed96dec222ea7d314456d8ddcdcbd3e1fd4cefa4096a38e7affaa25678f593aa74c38ccda666a1fd8b69e76ba0d09aeea8208a831311')
ON CONFLICT (codoperador) DO NOTHING;

INSERT INTO relacao_operador_empresa (codoperador, codempresa)
SELECT v.op, v.emp FROM (VALUES (90, 1), (90, 91)) AS v(op, emp)
WHERE NOT EXISTS (
  SELECT 1 FROM relacao_operador_empresa r WHERE r.codoperador = v.op AND r.codempresa = v.emp
);
