-- 049 — CAIXA corte-2b: CONFERÊNCIA + QUEBRA/SOBRA no fechamento. O fechamento pode receber a
-- CONTAGEM (valor contado); a diferença (contado − esperado; esperado = saldo corrente) é a quebra
-- (<0) ou sobra (>0), gravada COM SINAL na sessão (espelha SALDO_OPERADOR.SALDO). Quebra ativa gera
-- um título A Receber contra o PARCEIRO do operador (ORIGEM='Q'), fiel a UfinalizaFechamento.pas.
-- Sobra NÃO gera nada financeiro (só o registro). Tudo aditivo (nenhum ALTER destrutivo/DROP).

-- (a) conferência na própria sessão (1 linha/fechamento, como SALDO_OPERADOR).
ALTER TABLE caixa_sessao ADD COLUMN IF NOT EXISTS valor_contado numeric(13,2);   -- dinheiro contado no fechamento
ALTER TABLE caixa_sessao ADD COLUMN IF NOT EXISTS diferenca     numeric(13,2);   -- contado − esperado; <0 quebra, >0 sobra
ALTER TABLE caixa_sessao ADD COLUMN IF NOT EXISTS codrcb_quebra integer;         -- título A Receber gerado na quebra (ARECEBER.codrcb)

-- (b) mapa MÍNIMO operador → parceiro. O legado tem OPERADORES (29 col); aqui só o vínculo necessário
-- para o título de quebra ser cobrado do FUNCIONÁRIO (OPERADORES.CODPARCEIRO). Cadastro completo de
-- operadores = epic próprio. NÃO filtrar por PARCEIROS.FUN (o recon mostrou operadores com FUN='N').
CREATE TABLE IF NOT EXISTS operadores (
  codoperador integer PRIMARY KEY,
  codparceiro integer,            -- → parceiros.codparceiro (funcionário cobrado na quebra)
  nome        varchar(80),
  codempresa  integer,
  ativo       char(1) DEFAULT 'S'
);
-- operador 7 = o do smoke (tem parceiro → gera título de quebra); 8 sem parceiro (testa a trava).
INSERT INTO operadores (codoperador, codparceiro, nome, codempresa) VALUES
  (7, 20, 'OPERADOR SMOKE', 1),
  (8, NULL, 'OPERADOR SEM PARCEIRO', 1)
ON CONFLICT (codoperador) DO NOTHING;

-- View GET_CAIXA_SESSAO — republica com os campos de conferência. IMPORTANTE: CREATE OR REPLACE VIEW
-- só permite APENDAR colunas no fim (não reordenar/renomear as existentes); por isso `saldo_corrente`
-- mantém a posição do 048 e os campos de conferência entram DEPOIS.
CREATE OR REPLACE VIEW get_caixa_sessao AS
SELECT
  s.codcaixa, s.codempresa, s.codoperador, s.dtabertura, s.dtfechamento,
  s.saldo_inicial, s.saldo_final, s.status, s.obs,
  CAST(s.saldo_inicial + COALESCE((
    SELECT SUM(CASE WHEN m.tipo = 'E' THEN m.valor ELSE -m.valor END)
    FROM caixa_mov m
    WHERE m.codcaixa = s.codcaixa AND COALESCE(m.indr, 'I') = 'I'
  ), 0) AS numeric(13,2)) AS saldo_corrente,
  s.valor_contado, s.diferenca, s.codrcb_quebra
FROM caixa_sessao s;
