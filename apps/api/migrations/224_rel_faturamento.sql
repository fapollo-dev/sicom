-- 224 — FATURAMENTO POR MÊS (`FRMRELFATURAMENTO`): só o gate de tela. 80 acessos, 7 operadores.
--
-- ⚠️ O relatório do legado mostra **0,04% do faturamento** deste cliente. Ele soma a Redução Z do ECF e as
-- notas fiscais de saída em seis CFOPs — o que era certo na época do cupom de impressora e deixou de ser
-- quando a loja passou a emitir NFC-e. Medido em agosto/2026: `REDUCAOZ` tem **0 linhas** na tabela inteira,
-- as notas somam **R$ 872,74**, e a venda NFC-e do mesmo mês foi **R$ 2.233.973,50**.
--
-- O serviço soma **três** pernas (Redução Z, nota fiscal e NFC-e) e mostra cada uma separada. Sem dupla
-- contagem: as vendas são 100% `venda_nfc = 'S'` (modelo 65) e as notas de saída do mês são todas modelo 55.

-- ── `REDUCAOZ` — a tabela existe, vazia, para a perna do ECF não sumir ─────────────────────────────────
-- Está **vazia na origem** (0 linhas na produção inteira): este cliente é 100% NFC-e e nunca teve cupom de
-- impressora fiscal. Criamos a estrutura mesmo assim, por dois motivos concretos:
--   · a consulta do faturamento tem três pernas e **quebraria** sem a tabela — não é elegante somar zero com
--     um `CASE` que verifica se a tabela existe;
--   · outro tenant pode ter ECF, e aí a perna passa a valer sem mexer no código.
-- Só as colunas que o faturamento usa; o resto entra se alguém tiver o dado.
CREATE TABLE IF NOT EXISTS reducaoz (
  codreducao  integer PRIMARY KEY,
  idempresa   integer NOT NULL,
  data        timestamp,
  nroterminal integer,
  nroserie    varchar(30),
  modelo      char(2),
  cooz        integer,
  vendaliq    numeric(15,2),
  vendabruta  numeric(15,2),
  isentos     numeric(15,2),
  canc        numeric(13,2)
);
CREATE INDEX IF NOT EXISTS ix_reducaoz_data ON reducaoz (idempresa, data);

INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMRELFATURAMENTO', 'FRMRELFATURAMENTO', 7, 1)
ON CONFLICT DO NOTHING;
