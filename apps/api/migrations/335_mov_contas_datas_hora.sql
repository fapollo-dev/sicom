-- 335 — MOV_CONTAS_BANCARIAS: DTEMISSAO e DTVENC com HORA, como no legado (TIMESTAMP no Oracle).
-- 176.195 das 292.388 linhas (60%) têm hora em DTEMISSAO e 168.067 em DTVENC; a grade do legado ordena por
-- `MOV.DTEMISSAO, MOV.CODMOVCONTA` com a hora (UconsMovBancaria.pas:381-407) e o painel "posicionar na data" compara
-- com ela. O destino guardava `date` e perdia a ordem dentro do dia (uControleContasBancarias-spec.md §7, G14).
-- A conversão lê o `date` como meia-noite no fuso da loja.
ALTER TABLE mov_contas_bancarias
  ALTER COLUMN dtemissao TYPE timestamptz USING (dtemissao::timestamp AT TIME ZONE 'America/Sao_Paulo'),
  ALTER COLUMN dtvenc    TYPE timestamptz USING (dtvenc::timestamp AT TIME ZONE 'America/Sao_Paulo');

-- RELACAO_CHQ_PROP (movimento × cheque próprio) — a tabela do legado que faltava no destino. Vazia em produção (0 linhas,
-- CHQ_PROPRIO sem uso desde 2020), mas é lida pelo detalhamento da conta e pela reversão da baixa; "todos os campos".
CREATE TABLE IF NOT EXISTS relacao_chq_prop (
  codrelacaochq  integer PRIMARY KEY,
  codmovconta    integer,
  codchqproprio  integer
);
CREATE INDEX IF NOT EXISTS ix_relacao_chq_prop_mov ON relacao_chq_prop (codmovconta);
