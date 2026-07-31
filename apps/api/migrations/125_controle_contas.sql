-- 125 — CONTROLE DE CONTAS CORRENTES (FRMCONTROLECONTASBANCARIAS — uControleContasBancarias): lançamentos MANUAIS
-- no razão de tesouraria (mov_contas_bancarias, mig 057). A 6,6k-acessos tela-hub do legado (controle→extrato→
-- cadastro). Reusa a infra existente: operacoes_conta (mig 003, catálogo C/D), mov_contas_bancarias (mig 057:
-- codopconta/idpgto/valor-magnitude/tipomovimento/origem/idorigem/indr), contas_bancarias (mig 004, codbco).
-- Movimentos: (a) lançamento MANUAL = 1 linha (operação C/D → tipomovimento, VALOR magnitude, origem='MANUAL');
-- (b) TRANSFERÊNCIA entre contas = 2 linhas (débito origem + crédito destino) ligadas por idorigem=lote,
-- origem='TRANSF', codopconta=0, numa ÚNICA transação (o legado faz 2 ApplyUpdates soltos — melhoramos). Saldo =
-- Σ com sinal (C:+ / D:−). ADIADO (fiel): split LIBERADO Atual/A-Prazo (compensação de cheque — o app novo não tem
-- a coluna LIBERADO), agrupamento por FORMA_PGTO, chaveamento de período (contas_bancarias sem DTCHAVEAMENTO),
-- lançamento de saldo admin-gated, integração contábil, impressão de extrato, transferência que carrega cheques.

-- As operações manuais (Depósito/Saque/Tarifa/… C/D) são USER-DEFINED e vêm do cadastro `operacoes_conta` (mig 003,
-- tela "Operações de Conta" — FIEL ao legado OPERACOES_CONTA). Esta migration NÃO pré-semeia operações (senão furaria
-- o teste do engine de operacoes_conta que espera só a seed 0=TRANSFERENCIA + codopconta gerado a partir de 1).

-- sequência do LOTE de transferência (liga as 2 pernas via mov_contas_bancarias.idorigem).
CREATE SEQUENCE IF NOT EXISTS seq_controle_lote;

-- RBAC (operador 7, empresas 1+2): a tela de controle de contas correntes.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCONTROLECONTASBANCARIAS', 'BTNGRAVAR',  7, 1),
  ('FRMCONTROLECONTASBANCARIAS', 'BTNGRAVAR',  7, 2),
  ('FRMCONTROLECONTASBANCARIAS', 'BTNEXCLUIR', 7, 1),
  ('FRMCONTROLECONTASBANCARIAS', 'BTNEXCLUIR', 7, 2)
ON CONFLICT DO NOTHING;
