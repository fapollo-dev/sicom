-- 139 — CURVA ABC por CLIENTE e por FORNECEDOR (rel 10 e 11 do hub FRMRELVENDAS) + ranking por QUANTIDADE (rel 18).
-- Procedência: uVendas.pas TVendas.CurvaABCVendasCliente / CurvaABCVendasFornecedor / CurvaABCVendasQuantidade.
--
-- A rel 11 (fornecedor) e a rel 18 (quantidade) NÃO precisavam de coluna nova — agrupam por PRODUTOS.CODFOR e por
-- PRODUTOS.CODBARRA, que já existem. Quem precisava é a rel 10, que agrupa pelo CLIENTE DA VENDA:
--
-- 1) VENDAS.CODPARCEIRO — o cliente do cupom. **100% populado** no golden (146.556/146.556 em jun/23), com 78
--    parceiros distintos no mês. Antes de investir foi conferida a distribuição: o parceiro **0 = "AO CONSUMIDOR"
--    concentra 140.913 das 146.556 linhas (96%)**, e os outros 77 são as contas de convênio/crediário. Ou seja: a
--    faixa A vai ser dominada por uma linha só, e é isso mesmo que o legado mostra — o valor do relatório está na
--    cauda (quem compra no convênio), não no topo. Registrado aqui p/ ninguém "consertar" excluindo o consumidor.
-- 2) VENDAS.RAZAO — o nome digitado no PDV. 145.313/146.556 (99,2%). O legado exibe
--    `COALESCE(V.RAZAO, C.RAZAO)`: o nome do CUPOM tem precedência sobre o do cadastro — para o parceiro 0 é o
--    único nome que existe, e para os demais preserva como o cliente foi identificado NAQUELA venda.
ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS codparceiro integer,        -- cliente do cupom (0 = "AO CONSUMIDOR" no golden)
  ADD COLUMN IF NOT EXISTS razao       varchar(60);    -- nome do cliente NA VENDA (precede o do cadastro)

-- a curva por cliente varre (empresa, data) e agrupa por cliente: o índice espelha o caminho.
CREATE INDEX IF NOT EXISTS ix_vendas_parceiro ON vendas (idempresa, codparceiro);

-- Sem RBAC novo: as três são variantes do hub, cujo gate ('FRMRELVENDAS'/'FRMRELVENDAS') existe desde a mig 130.
