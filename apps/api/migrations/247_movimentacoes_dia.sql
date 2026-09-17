-- 247 — MOVIMENTAÇÕES DO DIA (`FRMMOVIMENTACOESDIA`, `UmovimentacoesDia.pas`). **27 acessos, 8 operadores.**
--
-- O "o que aconteceu hoje, e quem fez": pedidos, contas pagas, contas recebidas e o **log de histórico**, os
-- quatro no mesmo período e podendo filtrar por operador. É a tela de auditoria operacional do dia.
--
-- ── A tabela `HISTORICO` não existia no destino ───────────────────────────────────────────────────────
-- É a trilha de auditoria em TEXTO do legado — diferente do `HISTORICO_DINAMICO` (que é campo a campo, e já
-- existe desde a migration 009). Medido no cliente: **455.264 linhas**, de 07/04/2020 a **hoje**. Sem ela, a
-- quarta aba desta tela não tem de onde ler, e o rastro de "quem fez o quê" se perde na carga.
CREATE SEQUENCE IF NOT EXISTS seq_historico START 1;
CREATE TABLE IF NOT EXISTS historico (
  codhist     integer PRIMARY KEY DEFAULT nextval('seq_historico'),
  -- a tabela a que o evento se refere (o legado grava o nome em texto)
  tabela      varchar(40),
  historico   varchar(600),
  codoperador integer,
  codempresa  integer,
  data        timestamp,
  auxiliar    varchar(100),
  -- o documento a que o evento se refere, quando há um
  coddoc      integer
);
ALTER SEQUENCE seq_historico OWNED BY historico.codhist;
CREATE INDEX IF NOT EXISTS ix_historico_data ON historico (data);
CREATE INDEX IF NOT EXISTS ix_historico_oper ON historico (codoperador, data);
CREATE INDEX IF NOT EXISTS ix_historico_doc  ON historico (tabela, coddoc);

-- ⚠️ as quatro consultas do legado **não filtram empresa** — as views que elas usam também não. Aqui as
-- quatro são tenant-scoped, como o resto do sistema.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMMOVIMENTACOESDIA', 'FRMMOVIMENTACOESDIA', 7, 1)
ON CONFLICT DO NOTHING;
