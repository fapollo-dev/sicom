-- 253 — CONSULTA DE BAIXAS DO A PAGAR POR LOTE (`FRMCONSAPGBX`, `UConsAPGbx.pas` 617 linhas + `.dfm` 1.210 +
-- `UReversaoBaixaContasPagar.pas` 327). **20 acessos, 7 operadores.**
--
-- A tela abre um LOTE de baixa (a busca F3 é sobre `GET_APAGARBX` por LOTE) e mostra quatro grades: os títulos
-- baixados, o movimento bancário do lote (`MOV_CONTAS_BANCARIAS.IDLOTE`), cheques de terceiros e cheques
-- próprios; e tem o botão **Reverter baixa**, que desfaz o lote inteiro. Quando o lote já foi revertido, a
-- mesma tela lê `GET_APAGARBX_REVERTIDAS` e mostra "Lote revertido".
--
-- ── O que o dado diz ────────────────────────────────────────────────────────────────────────────────────
-- `APAGAR_BX`: **51.589 baixas em 7.383 lotes**, todas com IDLOTE, ~8 títulos por lote e ~5 fornecedores por lote
-- (máximo 55). **4.483 reversões** (INDR='E'), vivas todo ano — 502 em 2026 em 33 lotes. E a reversão é SEMPRE
-- do lote inteiro: **461 lotes revertidos, 0 parciais**. 100% dos lotes de 2026 têm movimento bancário
-- (7.111 movimentos em 955 lotes). Cheques: **0** linhas com lote em `CHEQUE_REP`, `CHQ_PROPRIO` e
-- `BX_APAGAR_CRT_PROPRIO` — as duas grades de cheque estão mortas no cliente.
--
-- ── O que a reversão do legado faz (UReversaoBaixaContasPagar.pas) ─────────────────────────────────────
-- Numa transação: para cada baixa do lote, estorna a integração contábil (se contabilizada), reabre o título
-- (`APAGAR.QUITADA='N'`, `CODAPGCARTAO=NULL`) e o adiantamento de origem; cria um CONTRA-MOVIMENTO bancário para
-- cada movimento do lote (tipo invertido, valor negativo, novo IDLOTE, `IDLOTE_REVERSAO` = lote original,
-- histórico "Reabertura da baixa de contas a pagar, lote N, realizada pelo usuário X."); marca as baixas
-- `INDR='E'` com usuário e data; apaga os lançamentos de caixa de juros/acréscimos/descontos do lote (pelo
-- texto do OBS!) e os títulos de saldo não quitados gerados pelo lote.
--
-- Antes, `ReversaoPermitida`: barra se o PERÍODO CONTÁBIL está fechado (hoje ou a data de qualquer movimento),
-- se o CAIXA da conta bancária está fechado, se alguma baixa está contabilizada e a integração NÃO é
-- automática (nas lojas 1 e 2 é AUTOMATICA — a trava nunca dispara, e há 44.129 baixas contabilizadas), e se
-- algum título tem vínculo de desconto de títulos (**19** baixados no cliente).
--
-- ── Aqui ────────────────────────────────────────────────────────────────────────────────────────────────
-- O estorno por TÍTULO já existia (`apagar-baixa.service.ts`: período fechado pela DTPGTO, estorno contábil na
-- mesma transação, saldo parcial, INDR='E', estorno de caixa com trava de caixa fechado, reabre título e
-- adiantamento). A reversão de LOTE encadeia esse estorno para cada título do lote numa única transação —
-- atômica como no legado — e acrescenta o contra-movimento bancário. O que muda de propósito:
--  • os lançamentos de caixa de juros/acréscimos/descontos não são apagados por texto de OBS: o estorno de
--    caixa por baixa (`caixa.estornarDaBaixa`) já os desfaz com chave;
--  • `CaixaFechado` da conta bancária vive num BO compilado que **não veio no fonte** (`TContasBancariasBO`) —
--    a trava aqui é a do caixa do Apollo (o estorno de caixa recusa caixa fechado).
--
-- ── Folds ───────────────────────────────────────────────────────────────────────────────────────────────
--  • A baixa do Apollo NÃO carimba IDLOTE (paga título a título pela API): uma baixa sem lote é um lote de um
--    (`coalesce(idlote, -codapgbx)`). Os lotes de verdade vêm da carga do legado.
--  • `GET_APAGARBX_REVERTIDAS` soma `TXJUROS` ao valor e a `GET_APAGARBX` não — no dado é inócuo (TXJUROS = 0
--    em todas as 4.459 revertidas). Aqui uma só consulta, com a flag `revertida` por linha.
--  • Cheques de terceiros/próprios: mortos (0 linhas); recibo `.fr3` e "Manutenção" (reabrir a tela de baixa
--    do lote para editar) ficam de fora deste corte.
--  • Tenant-scoped (o legado monta `IDEMPRESA IN (lista)`).

-- o elo do contra-movimento: aponta o lote original que a reversão desfez (existe no Oracle, faltava aqui)
ALTER TABLE mov_contas_bancarias ADD COLUMN IF NOT EXISTS idlote_reversao integer;
CREATE INDEX IF NOT EXISTS ix_mcb_idlote_reversao ON mov_contas_bancarias (idlote_reversao) WHERE idlote_reversao IS NOT NULL;

-- quem reverteu e quando, como no legado (INDR_USUARIO / INDR_DATA)
ALTER TABLE apagar_bx ADD COLUMN IF NOT EXISTS indr_usuario integer;
ALTER TABLE apagar_bx ADD COLUMN IF NOT EXISTS indr_data timestamptz;

-- o novo IDLOTE do contra-movimento (o legado pede GetID('IDLOTE'))
CREATE SEQUENCE IF NOT EXISTS seq_idlote_reversao START 900000000;

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCONSAPGBX', 'FRMCONSAPGBX',      7, 1),
  ('FRMCONSAPGBX', 'BTNREVERTERBAIXA',  7, 1)
ON CONFLICT DO NOTHING;
