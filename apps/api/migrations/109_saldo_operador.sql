-- 109 — SALDO_OPERADOR: conferência do FECHAMENTO do PDV (uFinalizaFechamento) — CAIXA × CX_VENDAS.
-- O operador conta a gaveta física (REAL); o sistema calcula o ESPERADO de DINHEIRO do CX_VENDAS do turno
-- (CODGRUPO). diferenca = REAL − ESPERADO + devolução (uFinalizaFechamento.pas:903); <0 = QUEBRA, >0 = SOBRA
-- (:784). GOLDEN (Oracle, tudo CODORIGEM=17): SOBRA→2019 (D183/C541, hist 84; 4591 linhas casam exato),
-- QUEBRA-sem-título→2018 (D541/C200, hist 85; 4638), quebra-COM-título→785 (título A Receber contra o
-- operador, 418). A tabela SALDO_OPERADOR (11.779 linhas) guarda SALDO (=diferenca), CODRCB (título) e
-- CONTABILIZADO; aqui estendemos com valor_esperado/valor_real/devolucao (o legado só persiste o SALDO).
CREATE SEQUENCE IF NOT EXISTS seq_saldo_operador;
CREATE TABLE IF NOT EXISTS saldo_operador (
  idsaldoop      bigint PRIMARY KEY DEFAULT nextval('seq_saldo_operador'),
  idempresa      integer NOT NULL,
  codgrupo       integer NOT NULL,          -- fechamento do turno (unidade da conferência)
  codoperador    integer,
  codpdv         integer,
  datafechamento date,
  valor_esperado numeric(15,2),             -- Σ DINHEIRO(valor−troco) do CX_VENDAS do grupo (extensão)
  valor_real     numeric(15,2),             -- contado na gaveta (extensão)
  devolucao      numeric(15,2) DEFAULT 0,   -- EdtDevolucaoDinheiro (extensão)
  saldo          numeric(15,2) NOT NULL,    -- diferenca = real − esperado + devolução (quebra<0/sobra>0)
  gera_saldo     char(1) DEFAULT 'N',       -- 'S' se gerou título A Receber (785)
  codrcb         bigint,                    -- título-quebra gerado (A Receber origem 'Q')
  contabilizado  char(1),                   -- 'S' após lançar a divergência no DIÁRIO
  excluido       char(1),                   -- 'S' = estornado (soft-delete)
  usucadastro    integer,
  dtcadastro     timestamptz DEFAULT now(),
  usultalteracao integer,
  dtultimalteracao timestamptz
);
ALTER SEQUENCE seq_saldo_operador OWNED BY saldo_operador.idsaldoop;
-- 1 conferência ATIVA por (empresa, grupo).
CREATE UNIQUE INDEX IF NOT EXISTS ux_saldo_operador_grupo ON saldo_operador (idempresa, codgrupo) WHERE coalesce(excluido, 'N') <> 'S';

-- CX_VENDAS: colunas que compõem o ESPERADO da gaveta (fiel a sqqFechaVendas: VALOR = Σ((valor − troco −
-- venda_balcao) − sangrias + suprimentos)). A mig 106 (corte-1) trouxe um SUBSET sem elas → sem a netagem, um
-- turno com sangria produziria QUEBRA-fantasma da magnitude da sangria (fold [ALTA]). Default 0 (dado sintético).
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS venda_balcao numeric(15,2) DEFAULT 0;
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS sangrias     numeric(15,2) DEFAULT 0;
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS suprimentos  numeric(15,2) DEFAULT 0;

-- IIC 2018 (QUEBRA-sem-título do PDV): D 541 SOBRA DE CAIXA / C 200 VENDAS TRANSITORIAS, hist 85.
-- (SOBRA 2019 D183/C541 já vem da mig 053; contas 541/200 já existem.) WHERE NOT EXISTS: itens_integracao_contabil
-- não tem UNIQUE(codoperacao,natureza) → ON CONFLICT seria vacuous; o guard explícito é idempotente de fato.
INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil, codhistorico)
SELECT * FROM (VALUES (2018, 'D', 'F', 541, 85), (2018, 'C', 'F', 200, 85)) AS v(codoperacao, natureza, tipo, codconta_contabil, codhistorico)
WHERE NOT EXISTS (SELECT 1 FROM itens_integracao_contabil i WHERE i.codoperacao = 2018);

-- fold [MÉDIA]: a IIC 2019 (SOBRA, mig 053) não tem codhistorico → a divergência gravaria codhist NULL; o
-- golden usa 84 (aplica também à sobra do caixa_sessao, que compartilha a 2019). Backfill fill-only-empty.
UPDATE itens_integracao_contabil SET codhistorico = 84 WHERE codoperacao = 2019 AND codhistorico IS NULL;

-- RBAC da conferência do PDV (na tela do Caixa).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCAIXA', 'BTNCONFERIRPDV', 7, 1),
  ('FRMCAIXA', 'BTNCONFERIRPDV', 7, 2);
