-- 140 — VENDAS POR HORA (rel 07 do hub FRMRELVENDAS): a SESSÃO do PDV, que é o que dá o nº de caixas abertos
-- por hora. Sem ela o relatório é uma lista de faturamento por hora; com ela responde a pergunta que o gerente
-- faz — «tinha caixa aberto suficiente no pico?».
--
-- Procedência: `URelVendasPorHora.pas` `TRelVendasPorHora.GetQuantidadeOperadorasLogadas` (chamado por
-- `ProcessaRel7` em URelVendas.pas), cuja query junta CX_VENDAS × OPERADORES × PDV × **CAIXA_PDV**.
--
-- CAIXA_PDV no golden: **12.710 linhas**, 1 por sessão de caixa (operador × PDV × dia), com HORAENTRADA e
-- HORASAIDA. Trazemos só as 7 colunas que o relatório usa; as outras 26 (VENDAB_INICIAL, CANCELAMENTOS,
-- DESCONTOS, SANGRIA, FUNDOCAIXA, TROCO, CONTRAVALE, RECARGA, VOUCHER, os INI_* …) são o domínio de
-- FECHAMENTO DE PDV, que não tem tela migrada — entram quando essa tela entrar, não "por precaução".
--
-- ⚠️ CHAVE é o identificador da sessão e tem **14 caracteres FIXOS** no golden (12.707 distintas em 12.710
-- linhas), no leiaute `PP AAMMDD HHMMSS` — ex. '60200820122940' = PDV 60, 20/08/2020, 12:29:40, conferido
-- contra a HORAENTRADA da mesma linha. É por isso que o legado consegue tirar a hora de abertura de
-- `Copy(CHAVE, 9, 2)` quando HORAENTRADA está vazia (o fallback de sessão ainda aberta).
CREATE TABLE IF NOT EXISTS caixa_pdv (
  codcaixa     integer PRIMARY KEY,
  codpdv       integer,          -- ⚠️ guarda o **NROPDV** (é assim que o legado casa: CP.CODPDV = C.NROPDV)
  codoperadora integer,          -- o OPERADOR do caixa (→ operadores.codoperador)
  data         timestamptz,      -- dia da sessão
  horaentrada  timestamptz,      -- abertura (0 nulos no golden — o fallback pela CHAVE é p/ sessão do dia)
  horasaida    timestamptz,      -- fechamento (2 nulos em 12.710: sessão ainda aberta)
  chave        varchar(20),      -- identificador da sessão, 14 chars: PP AAMMDD HHMMSS
  idempresa    integer NOT NULL
);
-- o relatório varre por (empresa, data) e casa a sessão por (chave, codpdv, data, empresa)
CREATE INDEX IF NOT EXISTS ix_caixa_pdv_empresa_data ON caixa_pdv (idempresa, data);
CREATE INDEX IF NOT EXISTS ix_caixa_pdv_chave        ON caixa_pdv (chave);

-- CX_VENDAS.CHAVE — é o lado esquerdo do casamento (`CP.CHAVE = C.CHAVE`). A mig 106 trouxe o subset FISCAL/
-- contábil e não precisou dela; agora precisa. Mesmo leiaute de 14 chars.
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS chave varchar(20);
CREATE INDEX IF NOT EXISTS ix_cx_vendas_chave ON cx_vendas (chave);

-- Sem RBAC novo: o gate do hub ('FRMRELVENDAS') existe desde a mig 130.
