-- 270 — LIVRO DIÁRIO (`FRMRELDIARIOCONTABIL`, `uRelDiarioContabil.pas` + `udmRelDiarioContabil`).
-- **4 acessos, 4 operadores.** Dossiê: `uRelDiarioContabil.md`.
--
-- O terceiro livro contábil da casa, ao lado do balancete (mig 258) e do balanço (mig 265): cada
-- lançamento do `DIARIO` do período vira **duas linhas** — uma na conta debitada e outra na creditada —
-- com data, código expandido, descrição da conta, histórico (`TRIM(DESCHIST) || ' ' || COMPLEMENTO`),
-- origem, id de origem, documento e o valor na coluna certa. Ordenado por dia e conta.
--
-- ── O que o dado diz (produção, 18/09/2026) ─────────────────────────────────────────────────────────────
--  · `DIARIO`: 1.769.341 linhas — 480.888 em 2024, 273.308 em 2025, **131.536 em 2026** (e 2 em 2027,
--    lançamento com data futura);
--  · em 2026, `DESCHIST` preenchido em 131.431 de 131.538 (99,9%) e `COMPLEMENTO` em 127.757 (97%);
--  · por empresa em 2026: 74.260 (loja 1), 55.018 (2), 2.160 (50), 71 (52), 29 (51) — e **o legado soma as
--    cinco** (`CODEMPRESA IN (...)`). Aqui é tenant-scoped.
--
-- ── Folds ─────────────────────────────────────────────────────────────────────────────────────────────
--  · o legado usa `UNION` (não `UNION ALL`): duas linhas idênticas em tudo — mesmo dia, conta, histórico,
--    origem, documento e valor — **colapsam em uma só**, e o livro perde um lançamento legítimo. Aqui é
--    `UNION ALL` com o `coddiario` em cada linha, que é o que um livro Diário precisa ter.
--  · o cabeçalho do .fr3 traz o **contabilista** (`CONTABILISTA`: 4 linhas, uma por empresa, todas do mesmo
--    contador — CELSO APARECIDO BORBA, CRC 44122). A tabela não existia no destino; entra aqui e na carga.
--  · o nome da origem vem de `origem_contabil` (mig 209), não o número cru.
CREATE TABLE IF NOT EXISTS contabilista (
  codempresa       integer PRIMARY KEY,
  nome             varchar(150) NOT NULL,
  cpf              varchar(20),
  crc              varchar(20),
  cnpj             varchar(20),
  cep              varchar(10),
  endereco         varchar(150),
  numero           varchar(10),
  complemento      varchar(60),
  bairro           varchar(60),
  telefone         varchar(30),
  email            varchar(120),
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_diario_emp_data ON diario (codempresa, datalan);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELDIARIOCONTABIL', 'FRMRELDIARIOCONTABIL', 7, 1)
ON CONFLICT DO NOTHING;
