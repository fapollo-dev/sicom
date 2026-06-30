-- NOTA FISCAL — Fase 5: CONTÁBIL (rateio CODCONTABILNF por centro de custo). CONFIG ARMAZENADA.
-- Distribui o total da NF por situação + centro de custo (PLC) + valor, soma = TOTALNF. É detalhe
-- 1:N gravado na transação do agregado (sem efeito). O DIÁRIO (partida dobrada) depende do módulo
-- contábil (PLANO_CONTAS/integração) e fica ADIADO. Doc: dossiê uNF.md §6/§10. Achado-chave:
-- CODCONTABILNF.CODCC -> PLC.CODPLC (Plano de Contas Gerencial / centro de custo), NÃO PLANO_CONTAS.

-- PLC — catálogo do centro de custo gerencial (alvo do CODCC). Lookup chave natural.
CREATE TABLE IF NOT EXISTS plc (
  codplc     integer PRIMARY KEY,        -- chave natural digitada
  desccodplc varchar(30),                -- código extenso (ex.: '4.07.003')
  descricao  varchar(80) NOT NULL,
  codpai     integer,                    -- hierarquia (informativo)
  nivelconta integer
);
CREATE OR REPLACE VIEW get_plc AS
  SELECT codplc, codplc AS codigo, desccodplc, descricao FROM plc;

-- NF_CONTABIL (= CODCONTABILNF) — rateio: detalhe 1:N da NF. PK app-gerada (sequence).
CREATE SEQUENCE IF NOT EXISTS seq_nf_contabil;
CREATE TABLE IF NOT EXISTS nf_contabil (
  codcontabilnf integer PRIMARY KEY DEFAULT nextval('seq_nf_contabil'),
  codnf         integer NOT NULL REFERENCES nf(codnf) ON DELETE CASCADE,
  idsituacao_nf integer REFERENCES situacao_nf(idsituacao_nf),  -- obrigatório (regra legado; validado no schema)
  codcc         integer REFERENCES plc(codplc),                 -- = CODPLC; obrigatório (validado no schema)
  valor         numeric(13,2) DEFAULT 0,
  adicional     char(1) DEFAULT 'N',     -- bonificação (legado)
  tipovalor     char(1),                 -- 'V' (legado; usado no CX_APAGAR — adiado)
  insert_manual char(1)
);
ALTER SEQUENCE seq_nf_contabil OWNED BY nf_contabil.codcontabilnf;
CREATE INDEX IF NOT EXISTS ix_nf_contabil_nf ON nf_contabil (codnf);

-- Seed do catálogo PLC (folhas do plano gerencial).
INSERT INTO plc (codplc, desccodplc, descricao, codpai, nivelconta) VALUES
  (1, '1.01.001', 'MERCADORIAS PARA REVENDA',     NULL, 3),
  (2, '4.07.001', 'DESPESAS ADMINISTRATIVAS',     NULL, 3),
  (3, '4.07.002', 'DESPESAS COMERCIAIS',          NULL, 3),
  (4, '4.07.003', 'FRETES E CARRETOS',            NULL, 3),
  (5, '3.01.001', 'RECEITA DE VENDAS',            NULL, 3)
ON CONFLICT (codplc) DO NOTHING;

-- RBAC do lookup (operador 7, empresa 1).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADCENTROCUSTO', 'BTNGRAVAR',  7, 1),
  ('FRMCADCENTROCUSTO', 'BTNEXCLUIR', 7, 1);
