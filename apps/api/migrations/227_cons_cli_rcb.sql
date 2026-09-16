-- 227 — CONSULTA A RECEBER POR CLIENTE (`FRMCONSCLIRCB`): só o gate de tela. 64 acessos, 8 operadores.
--
-- Nenhuma coluna nova: `areceber` já tem tudo (`txjuros`, `dtvenc`, `valor`).
--
-- ⚠️ No SQL do legado, a coluna JURO e a coluna TOTAL usam **taxas diferentes**: o juro aplica um default de
-- **9% ao mês** quando `TXJUROS` está fora da faixa (0, 20), e o total usa `COALESCE(TXJUROS/30, 0)` sem esse
-- default. Como **99.694 dos 99.734 títulos têm taxa zero** (99,96%), a tela mostra juro a 9% a.m. numa
-- coluna e total sem juro nenhum na outra. Nos 46.792 vencidos com taxa zero isso dá **R$ 11.567.551,22** de
-- juro exibido sobre **R$ 4.845.428,53** de principal — 2,4× o principal, em juro que não entra no total e
-- não existe. O serviço usa uma taxa só; ver o cabeçalho.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMCONSCLIRCB', 'FRMCONSCLIRCB', 7, 1)
ON CONFLICT DO NOTHING;
