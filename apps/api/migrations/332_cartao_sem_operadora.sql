-- 332 — o cartão SEM OPERADORA (fechamento de caixa, corte 4.4: o CARTAO da refechada).
--
-- O legado cria o cartão que falta na refechada com CODOPERADORA 0 (`RealizaConf`, UfinalizaFechamento.pas:2440-2485):
-- o operador depois reclassifica, e a edição exige a operadora ("Informe a operadora do cartão."). OPERADORAS não tem a
-- 0, e o Oracle não tem FK — na produção são 213 cartões com 0 (mar/2024 a ago/2026), todos da refechada.
-- Aqui a FK existe e vale para linha nova, então "sem operadora" é NULO (a FK aceita). Os 213 da carga continuam 0:
-- o carregador recria a FK NOT VALID para as órfãs do legado (carregar-cutover.ts). Quem lê trata 0 e nulo como
-- "sem operadora" (LEFT JOIN em OPERADORAS).
ALTER TABLE cartao ALTER COLUMN codoperadora DROP NOT NULL;
