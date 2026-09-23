-- 297 — O RAZÃO BANCÁRIO: o sinal que a carga não convertia, e o "a prazo" que o saldo não separava.
-- Contagens no Oracle de produção (só leitura), 23/09/2026. Achado ao estudar o lançamento automático do OFX.
--
-- ── 1. O SINAL — defeito de carga, corrigido no extrator (não nesta migration) ─────────────────────────
-- O legado grava o VALOR JÁ COM SINAL e o saldo é a soma dele (`udmControleContasBancarias.dfm:765`:
-- entradas = VALOR > 0, saídas = VALOR < 0, saldo = Σ VALOR). O Apollo decidiu outra convenção — valor
-- absoluto, direção em `tipomovimento`, saldo = Σ(C) − Σ(D) — e todos os seus gravadores e leitores a seguem.
-- Mas **a carga não convertia**: um débito do legado (−13,01) entraria como D −13,01 e o saldo o SOMARIA.
-- No cliente são **82.999 débitos negativos, Σ −R$ 310.269.830,13**: carregados crus, o Σ dos saldos passaria
-- de ~R$ 50,5 milhões para ~R$ 671 milhões. `extrair.py` agora carrega valor ABSOLUTO e o tipo PELO SINAL —
-- que é como o próprio legado lê a linha, e deixa o saldo idêntico ao dele em toda linha, inclusive nas 23
-- anômalas (20 créditos negativos e 3 débitos positivos, que o legado conta pelo sinal).
--
-- E o contra-movimento do estorno de baixa (`cons-apg-bx`, `cons-rcb-bx`) copiava o legado ao pé da letra:
-- `valor × −1` E tipo invertido. No legado isso zera (D −505 → C +505); na convenção do Apollo DOBRA
-- (D 505 → C −505: o saldo cai 1.010 em vez de voltar). O contra-movimento passa a levar o mesmo valor com o
-- tipo invertido — é o que o legado grava, lido na convenção nova (as 77.383 reversões do cliente: C+ para
-- D−, D− para C+).
--
-- ── 2. O "A PRAZO" — `LIBERADO` ──────────────────────────────────────────────────────────────────────
-- O saldo do legado conta só `LIBERADO = 'S'`; o resto (N e nulo) é mostrado à parte como TOTAL A PRAZO.
--   S 268.510 linhas · N 23.373 (R$ 8.908.429,58) · nulo 115 (R$ 226.673,02)
-- Os não liberados são sobretudo PIX POS até mai/2025 (16.056) e baixas de cartão lançadas em conta de
-- dinheiro (R$ 8,5 mi, vivas); em 2026 são 257 contra 27.141 liberados. Sem a coluna, o saldo atual do Apollo
-- somaria os R$ 9,1 mi a prazo. O conferidor não a acusou porque só olha colunas de chave/número — flag fica
-- de fora por desenho, e esta flag decide o saldo.
--
-- Movimento novo do Apollo nasce LIBERADO (`DEFAULT 'S'`): nenhum fluxo do Apollo cria movimento a prazo.
-- ⚠️ Quem vira N → S no legado mora em `FuncoesApollo`, que não veio no fonte (o repositório só mostra o filtro
-- "liberados / não liberados" em `UconsMovBancaria.dfm:697`). A liberação fica adiada com essa procedência; o
-- dado carregado mantém o estado do legado, e o nulo continua a prazo, como lá.
ALTER TABLE mov_contas_bancarias ADD COLUMN IF NOT EXISTS liberado char(1) DEFAULT 'S';
ALTER TABLE mov_contas_bancarias ADD COLUMN IF NOT EXISTS dtliberacao timestamptz;
ALTER TABLE mov_contas_bancarias ADD COLUMN IF NOT EXISTS dtvenc date;
-- o saldo atual lê só os liberados; a prazo é a exceção
CREATE INDEX IF NOT EXISTS ix_mov_contas_a_prazo ON mov_contas_bancarias (codconta)
  WHERE coalesce(liberado, 'N') <> 'S';
