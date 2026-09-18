-- 254 — CONSULTA DE BAIXAS DO A RECEBER POR LOTE (`FRMCONSRCBBX`, `UconsRCBbx.pas` 672 linhas + `.dfm` 1.588 +
-- `UReversaoBaixaContasReceber.pas`). **17 acessos, 4 operadores.** A gêmea de recebíveis da `FRMCONSAPGBX`
-- (migration 253): abre um LOTE de baixa, mostra os títulos recebidos, o movimento bancário, "Recursos
-- utilizados", cheques e PERMUTAS, deixa editar a observação da baixa (`OBS_EDITAVEL`) e tem o **Reverter baixa**
-- do lote inteiro (`TReversaoBaixaContasReceber.ReverteLote` — mesma classe-base, mesmas travas).
--
-- ── O que o dado diz ────────────────────────────────────────────────────────────────────────────────────
-- `ARECEBER_BX`: **19.225 baixas em 3.219 lotes**, todas com IDLOTE; **611 reversões**, sempre do lote inteiro
-- (**109 lotes revertidos, 0 parciais**), 28 em 2026; 100% dos lotes de 2026 com movimento bancário (309/309).
-- `ARECEBER_BX_SALDO` (a "BAIXA COM SALDO" da view): **0 linhas**. `PERMUTAS`: **0 linhas**. Cheques com lote: 0.
-- Duas baixas com DTPGTO no ano **5022** (digitação) — a busca por período não as alcança, e é o certo.
--
-- ── A view `GET_ARECEBERBX` é um UNION com juro fantasma ────────────────────────────────────────────────
-- BAIXA COMUM (`ARECEBER_BX`) UNION BAIXA COM SALDO (`ARECEBER_BX_SALDO`, vazia), e carrega o `JURO_CALCULADO`
-- com o default de **9% a.m.** quando o título não tem taxa — o mesmo juro que rendeu R$ 11,5 milhões de
-- diferença na `FRMCONSCLIRCB` (migration 227). Esta consulta não precisa dele: mostra o juro COBRADO na baixa.
--
-- ── Aqui ────────────────────────────────────────────────────────────────────────────────────────────────
-- Mesmo desenho da 253: lotes do período, lote aberto (títulos + movimento bancário), reversão do lote inteiro
-- encadeando o estorno por título que já existia (`areceber-baixa.service.ts`, agora com `estornarNoTrx`) numa
-- transação, com o contra-movimento bancário e o histórico do legado. Mais a observação editável da baixa.
-- Folds: baixa do Apollo sem IDLOTE = lote de um; "BAIXA COM SALDO", permutas e cheques: mortos no cliente;
-- "Manutenção" e recibo `.fr3`: fora deste corte; tenant-scoped.

ALTER TABLE areceber_bx ADD COLUMN IF NOT EXISTS indr_usuario integer;
ALTER TABLE areceber_bx ADD COLUMN IF NOT EXISTS indr_data timestamptz;
ALTER TABLE areceber_bx ADD COLUMN IF NOT EXISTS obs_editavel varchar(500);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCONSRCBBX', 'FRMCONSRCBBX',     7, 1),
  ('FRMCONSRCBBX', 'BTNREVERTERBAIXA', 7, 1),
  ('FRMCONSRCBBX', 'BTNGRAVAR',        7, 1)
ON CONFLICT DO NOTHING;
