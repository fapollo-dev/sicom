-- 257 — EXTRATO DE CLIENTES (`FRMEXTRATOCLIENTES`, `UextratoClientes.pas` 486 linhas). **13 acessos, 2 operadores.**
--
-- Quatro modelos sobre o A RECEBER — "Extrato por período", "por data de referência a menor", "a maior" e "Saldo
-- do contas a receber em" — cruzados com o campo de data (emissão / vencimento / baixa), o status (em aberto /
-- baixados / todos), o cliente e, no saldo, um teto de valor; analítico ou sintético (o sintético só existe para
-- o saldo no legado). Sempre `COALESCE(AGRUPADO,'N') = 'N'` — o título agrupado já está representado pelo
-- título-pai (62.344 dos 99.790 títulos do cliente são agrupados).
--
-- ── ⚠️ Três dos quatro modelos NÃO filtram empresa ──────────────────────────────────────────────────────
-- Só o modelo "saldo" tem `A.CODEMPRESA = :emp`; período/referência a menor/a maior varrem o A RECEBER inteiro.
-- Medido: títulos emitidos em 2026 com `AGRUPADO='N'` — **3.129 na loja 1, 6.364 no total** (a loja 50 sozinha
-- tem R$ 16,96 milhões em títulos). O extrato de um cliente da loja 1 trazia os títulos dele nas outras lojas.
-- Aqui os quatro modelos são tenant-scoped.
--
-- ── ⚠️ O modelo "saldo" confia em `ARECEBER.DTPGTO`, e ele está vazio em 44.130 quitados ────────────────
-- `WHERE DTVENDA <= :ref AND (DTPGTO > :ref OR DTPGTO IS NULL)`: um título quitado sem DTPGTO entra como em
-- aberto na data de referência. No cliente **44.130 títulos quitados (R$ 13,78 milhões) têm DTPGTO NULL** —
-- 11.782 deles com a baixa registrada em `ARECEBER_BX`. Aqui a data de pagamento efetiva é
-- `coalesce(areceber.dtpgto, max(areceber_bx.dtpgto ativa))`.
--
-- ── Folds ───────────────────────────────────────────────────────────────────────────────────────────────
--  • `NF.NRONF` do legado: `IDNF` está preenchido em 34 dos 13.974 títulos de 2026 — a coluna vem, quase sempre vazia.
--  • "Agrupar por mês" é variável do `.fr3`; aqui cada linha traz `mes` (nome do mês do campo de data escolhido).
--  • O juro/acréscimo/pago vêm da baixa ATIVA (`INDR='I'`), como no legado — sem o juro fantasma de 9%.

CREATE INDEX IF NOT EXISTS ix_areceber_emp_dtvenda ON areceber (codempresa, dtvenda);
CREATE INDEX IF NOT EXISTS ix_areceber_emp_dtvenc  ON areceber (codempresa, dtvenc);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMEXTRATOCLIENTES', 'FRMEXTRATOCLIENTES', 7, 1)
ON CONFLICT DO NOTHING;
