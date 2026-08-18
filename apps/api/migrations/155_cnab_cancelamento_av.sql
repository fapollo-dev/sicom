-- 155 — CNAB de cobrança corte-2c: as duas remessas que faltavam — CANCELAMENTO (pedido de baixa ao banco) e
-- ALTERAÇÃO DE VENCIMENTO. Procedência: `uConfBoleto.pas` — o comentário do próprio legado diz "se for
-- cancelamento, emite o codigo '02', se for remessa, emite código '01'" (:2781) e
-- `taGerarRemessaAlteracaoVencimento` → `toRemessaAlterarVencimento` = ocorrência **06** (:2785).
-- Confirmado no ÚNICO arquivo real de alteração do golden (CB050101.TXT, 2023-01-05, TIPOREMESSA='AV'):
-- ocorrência `06` no detalhe, com o NOVO vencimento no mesmo campo 121-126 — o resto do registro é o do envio.
--
-- LIVENESS: `TIPOREMESSA` no golden = 'E' 456 · **'AV' 1** · **'C' NUNCA** (0); `ARECEBER.REGISTRO_ARQ_REMESSA`
-- = 'S' 7.458 · NULL 42.126, **nunca 'C'**; `REMESSAS_BOLETOS_CONTAS.DTCANCELAMENTO` **0 de 7.459 preenchidos**.
-- ⇒ o cancelamento é CÓPIA-FIEL-NEGATIVA: a regra está explícita no fonte, mas nunca foi exercida no golden.
-- As 4 colunas abaixo existem no Oracle e faltavam na mig 153 (a de cancelamento é escrita pelo fluxo 'C').
ALTER TABLE remessas_boletos_contas
  ADD COLUMN IF NOT EXISTS dtcancelamento timestamptz,  -- gravada só na remessa de cancelamento (:3072)
  ADD COLUMN IF NOT EXISTS indr           char(1),
  ADD COLUMN IF NOT EXISTS indr_usuario   integer,
  ADD COLUMN IF NOT EXISTS indr_data      timestamptz;
