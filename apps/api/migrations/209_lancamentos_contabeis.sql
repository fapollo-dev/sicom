-- 209 — LANÇAMENTOS CONTÁBEIS (`FRMRELLANCAMENTOSCONTABEIS`, `UFrmRelLancamentosContabeis.pas` 1.416 linhas).
-- Dossiê: `uRelLancamentosContabeis.md`. 377 acessos, 19 operadores.
--
-- ⚠️ Duas coisas que a carga descartava e que este relatório expõe:
--
-- **`DIARIO.DESCHIST`** — o TEXTO do histórico de cada lançamento, preenchido em **1.750.513 de 1.750.577**
-- linhas (99,99%). Sem ele o razão mostra número e não conta história: é a coluna que o contador lê.
-- (`DIARIO.TIPODOC` vem junto: 36.414 linhas, 2%, mas é dado do cliente.)
--
-- **`ORIGEM_CONTABIL`** — o de-para dos códigos de origem que os três cortes da integração contábil vinham
-- usando como NÚMERO cru (12, 15, 16, 51, 61, 62, 13, 14, 19, 63, 64, 65…). São 35 linhas com o nome oficial
-- de cada uma, e agora toda tela contábil pode mostrar "INTEGRAÇÃO DE BAIXA DE CARTÕES" em vez de "51".
ALTER TABLE diario ADD COLUMN IF NOT EXISTS deschist varchar(255);
ALTER TABLE diario ADD COLUMN IF NOT EXISTS tipodoc  varchar(10);
-- ⛔ `DIARIO.CODPERIODO` NÃO entra: 0 de 1.750.577 preenchidas — coluna morta, como a CODCC (mig 199).

CREATE TABLE IF NOT EXISTS origem_contabil (
  codorigem        integer PRIMARY KEY,
  descorigem       varchar(120) NOT NULL,
  status           char(1),          -- 'S' em uso · 'N' herdada de versão antiga do legado
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz
);

-- as 35 origens do cliente, com o nome que ele vê. As de STATUS='N' são de uma geração anterior da
-- integração (baixa total/parcial separadas, venda PDV solta) e não recebem lançamento novo — vêm porque
-- o razão histórico as referencia.
INSERT INTO origem_contabil (codorigem, descorigem, status) VALUES
  (1, 'MANUAL', 'S'),
  (2, 'CONTAS A PAGAR - CADASTRO', 'N'),
  (4, 'CONTAS A PAGAR - BAIXA TOTAL', 'N'),
  (5, 'CONTAS A PAGAR - BAIXA PARCIAL', 'N'),
  (6, 'CONTAS A RECEBER - CADASTRO', 'N'),
  (8, 'CONTAS A RECEBER - BAIXA TOTAL', 'N'),
  (9, 'CONTAS A RECEBER - BAIXA PARCIAL', 'N'),
  (10, 'FECHAMENTO DE CAIXA', 'N'),
  (11, 'VENDA PDV', 'N'),
  (12, 'INTEGRAÇÃO DE NOTAS FISCAIS', 'S'),
  (13, 'INTEGRAÇÃO DE CONTAS A PAGAR', 'S'),
  (14, 'INTEGRAÇÃO DE CONTAS A RECEBER', 'S'),
  (15, 'INTEGRAÇÃO DE BAIXA DE CONTAS A PAGAR', 'S'),
  (16, 'INTEGRAÇÃO DE BAIXA DE CONTAS A RECEBER', 'S'),
  (17, 'INTEGRAÇÃO DE FECHAMENTO DE CAIXA', 'S'),
  (18, 'INTEGRAÇÃO DE REDUÇÃO Z', 'S'),
  (19, 'INTEGRAÇÃO DE TRANSFERÊNCIAS', 'S'),
  (50, 'REDUÇÃO Z', 'N'),
  (51, 'INTEGRAÇÃO DE BAIXA DE CARTÕES', 'S'),
  (52, 'INTEGRAÇÃO DE BAIXA DE CHEQUES', 'S'),
  (53, 'INTEGRAÇÃO DE BAIXA DE CONTAS A PAGAR - JUROS PAGOS', 'S'),
  (54, 'INTEGRAÇÃO DE BAIXA DE CONTAS A PAGAR - ACRÉSCIMOS PAGOS', 'S'),
  (55, 'INTEGRAÇÃO DE BAIXA DE CONTAS A PAGAR - DESCONTOS RECEBIDOS', 'S'),
  (56, 'INTEGRAÇÃO DE BAIXA DE CONTAS A RECEBER - JUROS RECEBIDOS', 'S'),
  (57, 'INTEGRAÇÃO DE BAIXA DE CONTAS A RECEBER - ACRÉSCIMOS RECEBIDOS', 'S'),
  (58, 'INTEGRAÇÃO DE BAIXA DE CONTAS A RECEBER - DESCONTOS CONCEDIDOS', 'S'),
  (59, 'INTEGRAÇÃO DE BAIXA DE CHEQUES - ACRÉSCIMOS RECEBIDOS', 'S'),
  (60, 'INTEGRAÇÃO DE BAIXA DE CHEQUES - DESCONTOS CONCEDIDOS', 'S'),
  (61, 'INTEGRAÇÃO DE BAIXA DE CARTÕES - TAXAS DE CARTÕES', 'S'),
  (62, 'INTEGRAÇÃO DE BAIXA DE CARTÕES - OUTRAS DESPESAS', 'S'),
  (63, 'INTEGRAÇÃO DE ADIANTAMENTO À PARCEIROS', 'S'),
  (64, 'INTEGRAÇÃO DE MOVIMENTAÇÃO DO CAIXA', 'S'),
  (65, 'INTEGRAÇÃO DE AGRUPAMENTO DE CONVÊNIO', 'S'),
  (66, 'IMPORTAÇÃO', 'S'),
  (67, 'INTEGRAÇÃO DE NFC-E', 'S')
ON CONFLICT (codorigem) DO NOTHING;

-- RBAC: gate de tela.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELLANCAMENTOSCONTABEIS', 'FRMRELLANCAMENTOSCONTABEIS', 7, 1)
ON CONFLICT DO NOTHING;
