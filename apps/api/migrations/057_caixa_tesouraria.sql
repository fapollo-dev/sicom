-- 057 — CAIXA corte-2d-b: TESOURARIA do dinheiro. No fechamento contábil (AUTOMATICA), além da divergência
-- (2019/2002, corte-2d), o dinheiro recebido no caixa (net das baixas AR/AP em dinheiro, contabilizado em 183)
-- é registrado como TRANSFERÊNCIA p/ a tesouraria: 1 linha no razão MOV_CONTAS_BANCARIAS (ORIGEM='FCP') +
-- 1 partida no DIÁRIO (CODORIGEM=19, codoperacao=2020, codhist=86).
--
-- PARIDADE (Oracle, auditoria): p/ DINHEIRO a conta de tesouraria = FORMAS_PGTO.codcontacorrente(21) →
-- CONTAS_BANCARIAS.codlanccontabil = 183 (a conta 21 tem TITULAR='TESOURARIA'), a MESMA conta contábil do
-- CAIXA (FORMAS_PGTO(DINHEIRO).codplanocontas também = 183). Logo a partida é um WASH D 183 / C 183 —
-- contabilmente inócua (o dinheiro fica em 183; muda só a sub-conta operacional, rastreada na MCB). NÃO se
-- inventa uma conta-cofre separada (o plc(188).codcontabil legado é lixo). Quando entrarem modalidades cujo
-- destino ≠ 183 (cartão→213, banco→…), a transferência vira real e o DIÁRIO deixa de ser wash — corte futuro.
-- Fechamento POR MODALIDADE (situação 2010, D modalidade / C 200) é PDV-dependente → ADIADO.

-- MOV_CONTAS_BANCARIAS (MCB) — razão de tesouraria/contas. Núcleo do fechamento por-dinheiro (ORIGEM='FCP').
-- (No legado tem ~40 colunas; migramos o núcleo; conciliação/OFX/reversão detalhada = adiado.)
CREATE SEQUENCE IF NOT EXISTS seq_mov_contas_bancarias;
CREATE TABLE IF NOT EXISTS mov_contas_bancarias (
  codmovconta       integer PRIMARY KEY DEFAULT nextval('seq_mov_contas_bancarias'),
  codconta          integer,               -- conta/tesouraria destino (soft-ref: FORMAS_PGTO.codcontacorrente)
  idempresa         integer NOT NULL,
  valor             numeric(13,2) NOT NULL,
  tipomovimento     char(1),               -- 'C' entra na tesouraria (fechamento FCP é sempre 'C' no legado)
  codopconta        integer,               -- 0 = TRANSFERENCIA (operacoes_conta)
  historico         varchar(255),
  idpgto            integer,               -- forma de pagamento (DINHEIRO)
  codoperador       integer,               -- operador do fechamento (coluna própria da MCB, 100% no legado)
  nropdv_fechamento integer,               -- = codcaixa (chave do fechamento p/ estorno)
  data_fechamento   timestamptz,
  origem            varchar(10),           -- 'FCP' = Fechamento de Caixa
  idorigem          integer,               -- = codcaixa (PK do fechamento; NÃO o coddiario — fiel ao legado)
  contabilizado     char(1),               -- fica NULL no fechamento (legado concilia depois)
  indr              char(1),               -- I/E (gancho; hoje o estorno é hard-delete, como o resto do módulo)
  dtcadastro        timestamptz
);
ALTER SEQUENCE seq_mov_contas_bancarias OWNED BY mov_contas_bancarias.codmovconta;
CREATE INDEX IF NOT EXISTS ix_mcb_fechamento ON mov_contas_bancarias (nropdv_fechamento);
