-- 269 — CONGELAR / DESCONGELAR ESTOQUE (`FRMCONGELAESTOQUE`, `UCongelaEstoque.pas`). **4 acessos, 2
-- operadores.** Dossiê: `uCongelaEstoque.md`.
--
-- A **foto do estoque** para o balanço/inventário: congelar copia `qtde → qtde_cong` e `qtde → qtde_bk`
-- em `estoque` e `estoque_dep` da empresa, e marca a empresa (`FLAGETQCONG='S'`, `USUCONGETQ`,
-- `DATACONGETQ`); descongelar levanta a marca. As duas operações pedem liberação (senha gerencial no
-- legado) e correm em transação única.
--
-- ── O que o dado diz (produção, 18/09/2026) ─────────────────────────────────────────────────────────────
--  · nenhuma empresa está congelada agora (`FLAGETQCONG='N'` nas 5), mas a foto está lá: `QTDE_CONG` e
--    `QTDE_BK` preenchidos em **100%** das linhas de `ESTOQUE` (47.716 na loja 1) e de `ESTOQUE_DEP`;
--  · e a foto é ANTIGA: diverge do saldo atual em **13.960 produtos da loja 1** (29%), 5.748 da loja 2,
--    387 da 51, 6 da 50 e 0 da 52 — é exatamente o que uma foto tirada num inventário passado deve fazer.
--  · `USUCONGETQ`/`DATACONGETQ` estão **nulos** nas 5: a foto foi tirada sem deixar quem nem quando. Aqui
--    as duas colunas são gravadas sempre, e o histórico fica em `congelamento_estoque`.
ALTER TABLE estoque     ADD COLUMN IF NOT EXISTS qtde_cong numeric(13,3);
ALTER TABLE estoque     ADD COLUMN IF NOT EXISTS qtde_bk   numeric(13,3);
ALTER TABLE estoque_dep ADD COLUMN IF NOT EXISTS qtde_cong numeric(13,3);
ALTER TABLE estoque_dep ADD COLUMN IF NOT EXISTS qtde_bk   numeric(13,3);
ALTER TABLE empresas    ADD COLUMN IF NOT EXISTS flagetqcong char(1) DEFAULT 'N';
ALTER TABLE empresas    ADD COLUMN IF NOT EXISTS usucongetq  integer;
ALTER TABLE empresas    ADD COLUMN IF NOT EXISTS datacongetq timestamptz;

-- o legado chama `GravarLog` e não deixa rastro consultável; aqui o histórico é tabela
CREATE SEQUENCE IF NOT EXISTS seq_congelamento_estoque;
CREATE TABLE IF NOT EXISTS congelamento_estoque (
  idcongelamento integer PRIMARY KEY DEFAULT nextval('seq_congelamento_estoque'),
  idempresa      integer NOT NULL,
  acao           varchar(12) NOT NULL,      -- CONGELAR / DESCONGELAR
  codoperador    integer,
  linhas_estoque integer,
  linhas_deposito integer,
  data           timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_congelamento_estoque OWNED BY congelamento_estoque.idcongelamento;
CREATE INDEX IF NOT EXISTS ix_congelamento_estoque_emp ON congelamento_estoque (idempresa, data DESC);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCONGELAESTOQUE', 'FRMCONGELAESTOQUE', 7, 1),
  ('FRMCONGELAESTOQUE', 'BTNCONGELAR',       7, 1),
  ('FRMCONGELAESTOQUE', 'BTNDESCONGELAR',    7, 1)
ON CONFLICT DO NOTHING;
