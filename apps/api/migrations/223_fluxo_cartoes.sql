-- 223 — FLUXO DE CARTÕES (`FRMFLUXOCARTOES`): só o gate de tela. 98 acessos, 7 operadores.
--
-- Quanto a loja vendeu no cartão, quanto já caiu na conta e quanto ainda vai cair. `CARTAO` tem
-- **2.059.893 linhas** em 2.201 dias, a última de hoje (15/09/2026) — nenhuma coluna nova é necessária.
--
-- ⚠️ O legado agrupa por `TRUNC(DTVENDA), LIBERADO` e chama o `SUM` do grupo de "TOTALVENDASMES": em
-- **1.485 dos 2.201 dias (67%)** o dia sai DUPLICADO na grade, e em nenhuma das duas linhas o total é o do
-- dia. Aqui é uma linha por dia, e a soma fecha — ver o cabeçalho do serviço.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMFLUXOCARTOES', 'FRMFLUXOCARTOES', 7, 1)
ON CONFLICT DO NOTHING;
