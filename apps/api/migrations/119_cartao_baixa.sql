-- 119 — CARTÕES corte-2: BAIXA / LIQUIDAÇÃO do recebível (FRMBAIXACARTAO). Fecha o ciclo do recebível do corte-1:
-- selecionar recebíveis abertos (liberado='N') → gerar um LOTE → marcar liberado='S'/dtbaixa/idlote/valor_taxa_paga
-- e CREDITAR o líquido numa conta bancária (mov_contas_bancarias, origem='BAIXA CARTAO', idorigem=idlote). Estorno
-- do lote reverte. Reusa as colunas de baixa do cartao (mig 117) + o razão MCB (mig 057) + contas_bancarias (004).
-- ADIADO (fiel): baixa PARCIAL/ajuste + antecipação (destino 'Antecipação'), destino Tesouraria-only, lançamento de
-- taxa/despesas em CAIXA, gating de PLC/período, e a CONCILIAÇÃO de extrato (CONS_REG10 + adquirentes).

-- sequência do lote de baixa (idlote do cartao).
CREATE SEQUENCE IF NOT EXISTS seq_cartao_lote;

-- RBAC (operador 7 empresa 1+2): a tela de baixa de cartão.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMBAIXACARTAO', 'BTNGRAVAR',  7, 1), ('FRMBAIXACARTAO', 'BTNGRAVAR',  7, 2),
  ('FRMBAIXACARTAO', 'BTNESTORNAR', 7, 1), ('FRMBAIXACARTAO', 'BTNESTORNAR', 7, 2)
ON CONFLICT DO NOTHING;
