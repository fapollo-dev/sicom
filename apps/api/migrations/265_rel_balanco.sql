-- 265 — BALANÇO PATRIMONIAL (`FRMRELBALANCO`, `uRelBalanco.pas` 239 linhas + `udmRelBalanco`).
-- **8 acessos, 3 operadores.** Dossiê: `uRelBalanco.md`.
--
-- O irmão patrimonial do balancete (mig 258): mesmas contas e mesmo diário, mas **só ATIVO e PASSIVO**
-- (`PP.CODIEXPANDIDO < '3'`) e numa DATA — saldo anterior (tudo antes do 1º dia do mês da data), débito e
-- crédito do mês até a data, saldo atual = anterior + débito − crédito. Opções do legado: "Degrau"
-- (indentação por nível), "Analíticas" e "Sem movimento".
--
-- ── ⚠️ O relatório "só sintéticas" do legado vem VAZIO, sempre ────────────────────────────────────────
-- Quando o operador DESMARCA "Analíticas", o legado acrescenta `AND PP.CLASSE = 'S'`. Em produção
-- (18/09/2026) `PLANO_CONTAS.CLASSE` só tem dois valores: **'A' (10.950) e 'T' (78)** — **nenhuma linha
-- com 'S'**. Das 10.871 contas de ativo/passivo, 10.816 são 'A' e 55 'T'. Ou seja: o modo sintético do
-- balanço devolve zero linhas desde sempre. Aqui, como no balancete, **sintética = tem conta filha** (ou
-- `CLASSE` em S/T), e o roll-up é por PREFIXO do código expandido.
--
-- ── Outros folds, com o número ────────────────────────────────────────────────────────────────────────
--  · o legado casa pai×filha com `Q.CODIEXPANDIDO LIKE PP.CODIEXPANDIDO || '%'` — sem o separador, o pai
--    "1" abocanharia um "10" se existisse; aqui o prefixo inclui o ponto (`'1.'`), como na mig 258.
--  · multi-empresa por `CODEMPRESA IN (...)`; aqui tenant-scoped (em 2026 o diário tem 74.260 lançamentos
--    na loja 1, 55.018 na 2, 2.160 na 50).
--  · a data "anterior" do legado é `edtDtIni − dia(edtDtIni) + 1` (o 1º do mês); preservado — e exposto na
--    resposta (`competencia`) para o contador ver de onde vem o "movimento do mês".
--  · 131.487 lançamentos de 2026 tocam contas patrimoniais (R$ 134,1 mi).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELBALANCO', 'FRMRELBALANCO', 7, 1)
ON CONFLICT DO NOTHING;
