-- 271 — NF-e / NFC-e INUTILIZADAS (`FRMNFE_INUTILIZADA`, `UNFE_Inutilizada.pas`). **2 acessos, 2
-- operadores** no menu — e **187.138 registros na tabela**. Dossiê: `uNFE_Inutilizada.md`.
--
-- O livro das **numerações inutilizadas**: quando um número de NFC-e é queimado (queda de energia,
-- travamento do PDV, contingência), a SEFAZ autoriza a inutilização e devolve um protocolo — e esse
-- registro tem de existir para a numeração não ficar com buraco inexplicado na escrita fiscal. A tela é
-- um cadastro pequeno (data, série, número inicial, número final, protocolo) porque **quem grava é o
-- processo de emissão**; a tela serve para consultar e corrigir.
--
-- ── O que o dado diz (produção, 18/09/2026) ─────────────────────────────────────────────────────────────
--  · **187.138 inutilizações**, e a soma das faixas dá exatamente 187.138: **toda inutilização é de UM
--    número** (`NUMERACAO_INI = NUMERACAO_FIM`) — é o PDV queimando números um a um, não faixas.
--  · por empresa e modelo: loja 1 **131.333** NFC-e (19/08/2020 → **18/09/2026**), loja 2 **54.904**
--    (22/12/2023 → 18/09/2026), loja 51 **899**; e **2 NF-e** na vida (uma na loja 1 em 2023, outra na 2
--    em 2024). Só em 2026 são **21.339** — cerca de 78 por dia.
--  · `NF.STATUSNFE = 'I'` tem **0 linhas**: a inutilização NÃO deixa rastro na `NF` — vive só aqui. Sem
--    esta tabela, o Apollo não tem como explicar os buracos da numeração para o fisco.
--  · a tabela não existia no destino nem no `plano-tabelas.json`; entra na f0.
CREATE SEQUENCE IF NOT EXISTS seq_nfe_inutilizada;
CREATE TABLE IF NOT EXISTS nfe_inutilizada (
  codinutilizacao  integer PRIMARY KEY DEFAULT nextval('seq_nfe_inutilizada'),
  codempresa       integer NOT NULL,
  data             timestamptz NOT NULL,
  tiponf           varchar(10) NOT NULL DEFAULT 'NFCE',   -- NFCE / NFE
  serie            varchar(3),
  numeracao_ini    integer NOT NULL,
  numeracao_fim    integer NOT NULL,
  protocolo        varchar(30),
  arquivo_xml      text,
  codnf            integer,
  coddocumento     integer,
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz DEFAULT now(),
  CONSTRAINT ck_nfe_inutilizada_faixa CHECK (numeracao_fim >= numeracao_ini)
);
ALTER SEQUENCE seq_nfe_inutilizada OWNED BY nfe_inutilizada.codinutilizacao;
CREATE INDEX IF NOT EXISTS ix_nfe_inutilizada_emp_data ON nfe_inutilizada (codempresa, data);
CREATE INDEX IF NOT EXISTS ix_nfe_inutilizada_faixa ON nfe_inutilizada (codempresa, tiponf, serie, numeracao_ini);
-- a mesma numeração não pode ser inutilizada duas vezes na mesma série (o legado não tinha essa trava)
CREATE UNIQUE INDEX IF NOT EXISTS ux_nfe_inutilizada_num
  ON nfe_inutilizada (codempresa, tiponf, coalesce(serie, ''), numeracao_ini, numeracao_fim);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMNFE_INUTILIZADA', 'FRMNFE_INUTILIZADA', 7, 1),
  ('FRMNFE_INUTILIZADA', 'BTNGRAVAR',          7, 1),
  ('FRMNFE_INUTILIZADA', 'BTNEXCLUIR',         7, 1)
ON CONFLICT DO NOTHING;
