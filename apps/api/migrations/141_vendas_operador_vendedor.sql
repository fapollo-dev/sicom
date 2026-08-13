-- 141 — FAMÍLIA OPERADOR/VENDEDOR do hub FRMRELVENDAS (rel 06, 19, 25, 36, 46) + base p/ as fiscais (15/16).
-- Procedência: uVendas.pas VendasDataporOperador/VendasResumoporOperador/VendasDetalhePorOperador/
-- VendasDataporVendedor/ProdutosVendidosPeriodoPorOperador.
--
-- Colunas de VENDAS que essas variantes agrupam/juntam e que a mig 105 não trouxe. TODAS 100% populadas no
-- golden (146.556/146.556 em jun/23) — nenhuma é "por precaução":
--   OPERADOR     → o caixa que registrou (JOIN OPERADORES O ON O.CODOPERADOR = V.OPERADOR)
--   CODVENDEDOR  → o vendedor comissionável (JOIN PARCEIROS VE ON VE.CODPARCEIRO = V.CODVENDEDOR)
--   CODGRUPO/CODSUBGRUPO/CODDPTO → família DENORMALIZADA na linha da venda. ⚠️ Metade das variantes junta
--     FAMILIAS_PROD por V.COD* (o snapshot da venda) e a outra metade por P.COD* (o cadastro de hoje) — a rel 06
--     usa P., a rel 19/36 usam V. É diferença real quando o produto muda de família depois da venda; cada
--     serviço junta pelo lado que o SEU SQL usa.
--   IDPISCOFINS  → a situação PIS/COFINS da venda (rel 15/16, próxima família).
ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS operador    integer,
  ADD COLUMN IF NOT EXISTS codvendedor integer,
  ADD COLUMN IF NOT EXISTS codgrupo    integer,
  ADD COLUMN IF NOT EXISTS codsubgrupo integer,
  ADD COLUMN IF NOT EXISTS coddpto     integer,
  ADD COLUMN IF NOT EXISTS idpiscofins integer;

CREATE INDEX IF NOT EXISTS ix_vendas_operador ON vendas (idempresa, operador);

-- COLUNAS MORTAS NO GOLDEN, NÃO CRIADAS (checado all-time em 2026-08-13):
--   COMISSAO = 0 em TODAS as linhas de VENDAS e de PARCEIROS ⇒ rel 12/14/17/24 (família comissão) ficam
--     ADIADAS-dormentes: a mecânica existiria mas todo valor seria 0,00 com cara de funcional.
--   IDPROACUMULATIVA: 35 linhas na história inteira (PROMOCAO_ACUMULATIVA tem 4) ⇒ rel 27 adiada-dormente.
--   DEVOLUCAO='S': 0 linhas ⇒ rel 44 adiada-dormente.
-- E DUAS VARIANTES MORTAS POR FALTA DE FONTE: rel 48 (CRESCE_VENDAS existe com 0 linhas) e rel 41
-- (VendasPorCategoria faz FROM PERDAS — tabela que NÃO EXISTE no Oracle: a variante QUEBRA no legado vivo;
-- é o caso FRMSALDOEMPRESA/lição 35 — bloqueio, não pendência).
