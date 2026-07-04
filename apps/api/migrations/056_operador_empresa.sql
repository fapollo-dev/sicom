-- 056 — OPERADORES corte-2: empresas-permitidas (ponte N:N) + supervisor + trava do usuário-sistema.
-- Espelho FIEL do Oracle RELACAO_OPERADOR_EMPRESA: PK SURROGATE (CODRELACAO, sequence app-side ID_CODRELACAO),
-- codoperador FK, codempresa FK. SEM índice único (codoperador,codempresa) no legado (só PK). SEM INDR
-- (relação pura, hard-delete no substitute do agregado). 215 linhas reais; 154 operadores; ≥1 empresa p/
-- operador ATIVO (uCadUsuarios.pas:444; os 3 sem empresa no Oracle são todos INDR='E').
CREATE SEQUENCE IF NOT EXISTS seq_relacao_operador_empresa;
CREATE TABLE IF NOT EXISTS relacao_operador_empresa (
  codrelacao  integer PRIMARY KEY DEFAULT nextval('seq_relacao_operador_empresa'),
  codoperador integer NOT NULL REFERENCES operadores(codoperador),
  codempresa  integer NOT NULL REFERENCES empresas(idempresa)
);
CREATE INDEX IF NOT EXISTS ix_relacao_operador_empresa_op ON relacao_operador_empresa (codoperador);
ALTER SEQUENCE seq_relacao_operador_empresa OWNED BY relacao_operador_empresa.codrelacao;

-- Usuário-SISTEMA protegido (trava não editar/excluir). O legado protege LOGIN='SICOM' (uCadUsuarios.pas:
-- 332/358); o usuário-sistema REAL deste tenant é op 1 LOGIN='ADMIN' 'ACESSO DE PROGRAMADOR' (Oracle) — SICOM
-- não existe como operador. Seedamos o op 1 ADMIN REAL (não colide com o import futuro; ON CONFLICT preserva)
-- e o serviço protege AMBOS os logins ('SICOM' literal do legado + 'ADMIN' real do tenant).
INSERT INTO operadores (codoperador, nome, login, tipoop, idgrupo, desabilitado) VALUES
  (1, 'ACESSO DE PROGRAMADOR', 'ADMIN', 'SUP', 3, 'N')
ON CONFLICT (codoperador) DO NOTHING;

-- Bridge seed: op 1 (SICOM), 7 (SMOKE), 8 → empresa 1 (a única existente NO TEMPO DA MIGRATION; a empresa 2
-- só é criada durante o smoke, via POST — vincular op↔emp2 é exercitado pela API na seção de operadores).
-- Idempotente por NOT EXISTS (a ponte não tem unique(codoperador,codempresa) — PK é surrogate — então
-- ON CONFLICT não dedupa; NOT EXISTS evita duplicar se a migration reexecutar sobre um banco já semeado).
INSERT INTO relacao_operador_empresa (codoperador, codempresa)
SELECT v.op, v.emp
FROM (VALUES (1, 1), (7, 1), (8, 1)) AS v(op, emp)
WHERE NOT EXISTS (
  SELECT 1 FROM relacao_operador_empresa r WHERE r.codoperador = v.op AND r.codempresa = v.emp
);
