-- 048 — CAIXA (sessão + movimento manual), corte-1. Modelo LIMPO que simplifica as ~6 tabelas do
-- legado (CAIXA/CX_VENDAS/CX_PEDIDOS/CX_OS/CAIXA_PDV/SALDO_OPERADOR) em duas: `caixa_sessao` (o caixa
-- do operador, aberto/fechado) + `caixa_mov` (movimentos manuais: suprimento/sangria/entrada/saída,
-- estorno LÓGICO via INDR — mesma decisão de areceber_bx/apagar_bx). Ganchos codrcbbx/codapgbx/codconta
-- ficam prontos p/ o corte-2 (wire da baixa AR/AP→caixa + tesouraria). Multi-tenant por CODEMPRESA;
-- 1 caixa ABERTO por operador+empresa (trava legada UabertCaixa.pas:212). Conferência/quebra
-- (SALDO_OPERADOR), integração contábil e tesouraria = corte-2.

-- ── SESSÃO DE CAIXA (abre/fecha; espelha CAIXA_PDV + estado) ──
CREATE SEQUENCE IF NOT EXISTS seq_caixa_sessao;
CREATE TABLE IF NOT EXISTS caixa_sessao (
  codcaixa       integer PRIMARY KEY DEFAULT nextval('seq_caixa_sessao'),
  codempresa     integer NOT NULL,             -- tenant (≠ IDEMPRESA)
  codoperador    integer,                       -- dono do caixa (header x-operador-id)
  dtabertura     timestamptz,
  dtfechamento   timestamptz,
  saldo_inicial  numeric(13,2) DEFAULT 0,       -- fundo de caixa (no legado é um SUPRIMENTO; aqui é a semente)
  saldo_final    numeric(13,2),                 -- gravado no fechamento (= saldo corrente)
  status         char(1) DEFAULT 'A',           -- A=aberta / F=fechada
  obs            text,
  usultalteracao integer, dtultimalteracao timestamptz, dtcadastro timestamptz
);
ALTER SEQUENCE seq_caixa_sessao OWNED BY caixa_sessao.codcaixa;
-- trava de duplicidade: 1 caixa ABERTO por (empresa, operador) — "operador com caixa aberto"
-- (UabertCaixa.pas:212-230). Índice PARCIAL: só linhas status='A' conflitam.
CREATE UNIQUE INDEX IF NOT EXISTS ux_caixa_sessao_aberta ON caixa_sessao (codempresa, codoperador) WHERE status = 'A';
CREATE INDEX IF NOT EXISTS ix_caixa_sessao_empresa ON caixa_sessao (codempresa);

-- ── MOVIMENTO DE CAIXA (manual; espelha CAIXA/CX_VENDAS por OPERACAO) ──
CREATE SEQUENCE IF NOT EXISTS seq_caixa_mov;
CREATE TABLE IF NOT EXISTS caixa_mov (
  codmov         integer PRIMARY KEY DEFAULT nextval('seq_caixa_mov'),
  codcaixa       integer NOT NULL REFERENCES caixa_sessao(codcaixa) ON DELETE CASCADE,
  codempresa     integer NOT NULL,
  tipo           char(1) NOT NULL,              -- E=entrada / S=saída (derivado da espécie)
  especie        varchar(20) NOT NULL,          -- SUPRIMENTO/SANGRIA/ENTRADA/SAIDA (RECEBIMENTO/PAGAMENTO no corte-2)
  recurso        varchar(20) DEFAULT 'DINHEIRO',-- corte-1 só DINHEIRO; cheque/cartão/etc no corte-2
  valor          numeric(13,2) NOT NULL,        -- sempre POSITIVO; o sinal vem de `tipo`
  codrcbbx       integer,                        -- gancho: baixa AR (corte-2)
  codapgbx       integer,                        -- gancho: baixa AP (corte-2)
  codconta       integer,                        -- gancho: tesouraria/conta bancária (corte-2)
  codoperador    integer,
  data_operacao  timestamptz,
  indr           varchar(1) DEFAULT 'I',        -- I=válido / E=estornado (estorno lógico, preserva histórico)
  contabilizado  char(1),                        -- gancho: integração contábil (corte-2)
  obs            text
);
ALTER SEQUENCE seq_caixa_mov OWNED BY caixa_mov.codmov;
CREATE INDEX IF NOT EXISTS ix_caixa_mov_codcaixa ON caixa_mov (codcaixa);
CREATE INDEX IF NOT EXISTS ix_caixa_mov_empresa  ON caixa_mov (codempresa);

-- View GET_CAIXA_SESSAO — sessão + SALDO CORRENTE (saldo_inicial + Σ entradas − Σ saídas, só INDR='I').
CREATE OR REPLACE VIEW get_caixa_sessao AS
SELECT
  s.codcaixa, s.codempresa, s.codoperador, s.dtabertura, s.dtfechamento,
  s.saldo_inicial, s.saldo_final, s.status, s.obs,
  CAST(s.saldo_inicial + COALESCE((
    SELECT SUM(CASE WHEN m.tipo = 'E' THEN m.valor ELSE -m.valor END)
    FROM caixa_mov m
    WHERE m.codcaixa = s.codcaixa AND COALESCE(m.indr, 'I') = 'I'
  ), 0) AS numeric(13,2)) AS saldo_corrente
FROM caixa_sessao s;

-- RBAC da tela FRMCAIXA (empresa 1 = smoke; 2 = teste de tenant do serviço).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCAIXA', 'BTNABRIR',      7, 1),
  ('FRMCAIXA', 'BTNFECHAR',     7, 1),
  ('FRMCAIXA', 'BTNMOVIMENTAR', 7, 1),
  ('FRMCAIXA', 'BTNESTORNAR',   7, 1),
  ('FRMCAIXA', 'BTNABRIR',      7, 2),
  ('FRMCAIXA', 'BTNFECHAR',     7, 2),
  ('FRMCAIXA', 'BTNMOVIMENTAR', 7, 2),
  ('FRMCAIXA', 'BTNESTORNAR',   7, 2);
