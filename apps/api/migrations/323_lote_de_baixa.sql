-- 323 — O LOTE DE BAIXA DO LEGADO (`ID_IDLOTE`): um gerador só para as baixas de A Pagar e A Receber, a baixa de cartão,
-- de cheque, o fechamento de caixa… (19 units chamam `GetID('IDLOTE')`). O número amarra a baixa às linhas que ela gera
-- (CAIXA "Ref. … lote N", MOV_CONTAS_BANCARIAS.IDLOTE, CARTAO.IDLOTE) e é por ele que a reversão as desfaz.
--
-- ⚠️ A baixa de cartão do Apollo usava `seq_cartao_lote`, começando em 1 — e os lotes da carga vão até ~91 mil
-- (produção: ID_IDLOTE em 91.423). O lote novo repetiria o número de um lote antigo, e o estorno (por IDLOTE) desfaria
-- os cartões do lote velho junto. A sequência nova começa depois do maior lote carregado; as faixas altas próprias do
-- Apollo (reversão 900.000.000, desconto de título 800.000.000) ficam fora da conta.
CREATE SEQUENCE IF NOT EXISTS seq_idlote;
SELECT setval('seq_idlote', greatest(
  coalesce((SELECT max(idlote) FROM apagar_bx WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM areceber_bx WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM apagar WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM areceber WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM caixa WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlotebxcartao) FROM caixa WHERE idlotebxcartao < 800000000), 0),
  coalesce((SELECT max(idlote) FROM cartao WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM cartao_bx WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM cheque WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM chq_proprio WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM mov_contas_bancarias WHERE idlote < 800000000), 0))::bigint + 1, false);
