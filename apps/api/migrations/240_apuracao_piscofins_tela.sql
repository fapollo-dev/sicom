-- 240 — APURAÇÃO PIS/COFINS, a TELA (`FRMAPURACAOPISCOFINS`, `UapuracaoPISCOFINS.pas`).
-- **39 acessos, 2 operadores.** O motor já existia desde a migration 098 (`apuracao_pc`/`_det`, bloco M do
-- EFD-Contribuições); entra o que a tela do legado faz em volta dele: **listar as apurações realizadas, abrir
-- uma, ver crédito e débito lado a lado com o saldo, e excluir para refazer**.
--
-- O saldo é o que o contador procura: **débito − crédito** por tributo, que é o valor a recolher do M200/M600.
-- Quando o crédito supera o débito, o que sobra **transporta** — e a tela mostra assim, em vez de um número
-- com sinal.
--
-- ⚠️ **excluir é o "reabrir" do legado**: a apuração é idempotente por período (`UNIQUE (idempresa, dataini,
-- datafim)` + delete-then-insert no motor), então refazer é apurar de novo. A exclusão serve para quando o
-- recorte do período muda, e leva o detalhe junto (`ON DELETE CASCADE`).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMAPURACAOPISCOFINS', 'FRMAPURACAOPISCOFINS', 7, 1),
  ('FRMAPURACAOPISCOFINS', 'BTNEXCLUIR',           7, 1)
ON CONFLICT DO NOTHING;
