-- 238 — RELATÓRIO FINANCEIRO (`FRMRELFINANCEIRO`, `UrelFinanceiro.pas`). **43 acessos, 7 operadores.**
-- Recebíveis (99.768 títulos) e compromissos (55.210) no mesmo período, cada linha com a baixa ao lado.
--
-- ── ⚠️ O filtro por data de BAIXA do lado A RECEBER **não funciona** no legado ─────────────────────────
-- O legado monta o filtro SEM prefixo de tabela (`:596`) e o cola num SELECT que já tem
-- `LEFT JOIN ARECEBER_BX`. Como **as duas tabelas têm `DTPGTO`**, o Oracle responde **ORA-00918, "coluna
-- definida de maneira ambígua"** — verificado na produção. O operador escolhe "Baixa", manda consultar e
-- recebe a mensagem do `except`. A opção existe na tela e não produz relatório nenhum.
--
-- E se rodasse, rodaria errado: `ARECEBER.DTPGTO` é denormalizada e **abandonada** — está em **6.819** dos
-- **50.949** títulos quitados, contra **18.601** com baixa em `ARECEBER_BX`. Filtrar por ela esconderia
-- **11.782 títulos baixados, R$ 12.207.925,74**. Em agosto/2026 dá **0 linhas** onde o certo dá **24**.
-- Aqui a data de baixa é sempre a da BAIXA. Do lado A PAGAR o legado acerta por acidente: `APAGAR` não tem
-- `DTPGTO`, então o nome resolve sozinho para o da baixa.
--
-- ── As duas colunas que faltavam, ambas cópia-fiel-negativa ───────────────────────────────────────────
-- ⚠️ `ARECEBER.NRODOC` — o "documento" que o relatório imprime — está preenchido em **1** linha de 99.769.
--    O número que o operador reconhece é a `DUPLICATA`, e é ela que a tela mostra quando o `NRODOC` é nulo.
-- ⚠️ `ARECEBER.CODCONTA` — o filtro "Conta corrente" da tela — está preenchido em **6** de 99.769. O filtro
--    existe, é fiel, e na prática não seleciona nada deste lado.
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS nrodoc   varchar(20);
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS codconta integer;

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELFINANCEIRO', 'FRMRELFINANCEIRO', 7, 1)
ON CONFLICT DO NOTHING;
