-- 277 — CARTÕES corte-3: a BAIXA PARCIAL (`CARTAO_BX`) — e a trava que o legado não tem.
-- Corte-1/2 nas migrations 117/119 (recebível + baixa em lote). Fecha o
-- "ADIADO (fiel): baixa parcial/ajuste" declarado no corte-2. Dossiê: `uBaixaCartao-parcial.md`.
--
-- ── ⚠️ A tabela existia no cliente e NÃO TINHA DESTINO ────────────────────────────────────────────────
-- `CARTAO_BX` tem **1.169.680 baixas** (R$ 58,4 milhões; 223.704 só em 2026) e **não estava no destino nem
-- no `plano-tabelas.json`** — o corte-2 modelou a baixa como um flag no próprio recebível
-- (`cartao.liberado/dtbaixa/idlote`), que não comporta duas baixas no mesmo cartão. Achado da varredura de
-- dado de 18/09/2026.
--
-- E não é detalhe: **1.110.745 cartões distintos** aparecem lá, **46.218 com mais de uma baixa**.
--
-- ── ⚠️ O defeito, medido: o legado baixa o mesmo recebível duas vezes ─────────────────────────────────
-- Contando só as baixas **ativas** (`INDR <> 'E'`):
--   · **2.926 cartões têm 2+ baixas ativas**;
--   · em **2.921 deles a soma das baixas ULTRAPASSA o valor do cartão** — **R$ 131.623,12 a mais**.
-- O padrão é sempre o mesmo: o recebível é baixado num lote, o lote é estornado **sem** marcar a baixa com
-- `INDR='E'`, e ele é baixado de novo noutro lote. As duas ficam valendo. Exemplo real: o cartão 1843996
-- (R$ 19,61) tem duas baixas de R$ 19,61 — lotes 81835 e 85579.
-- Aqui a baixa é recusada quando faria a soma passar do valor (422 `CARTAO_BAIXA_EXCEDE`).
--
-- ── A baixa parcial é real e usada ────────────────────────────────────────────────────────────────────
-- **5.186 cartões** têm soma ativa MENOR que o valor (ex.: recebível de R$ 405,42 com R$ 258,71 baixados).
-- O corte-2 não conseguia representar isso; agora o cartão só fica `liberado='S'` quando a soma das baixas
-- ativas fecha o valor, e o saldo fica visível.
--
-- ── Estorno ───────────────────────────────────────────────────────────────────────────────────────────
-- Lógico, como em `areceber_bx`/`apagar_bx`: `INDR='E'` + usuário + data (o cliente tem **59.118** assim).
-- Estornando a última baixa ativa, o recebível volta a aberto.
CREATE SEQUENCE IF NOT EXISTS seq_cartao_bx;
CREATE TABLE IF NOT EXISTS cartao_bx (
  codvendcartaobx integer PRIMARY KEY DEFAULT nextval('seq_cartao_bx'),
  codvendcartao   integer NOT NULL REFERENCES cartao(codvendcartao) ON DELETE CASCADE,
  idempresa       integer NOT NULL,
  valorpg         numeric(15,2) NOT NULL,      -- o BRUTO baixado (no cliente a soma bate com CARTAO.VALOR)
  data_pgto       timestamptz NOT NULL DEFAULT now(),
  codopbx         integer,
  idlote          integer,
  obs             varchar(500),
  obs_editavel    varchar(500),
  contabilizado   char(1),
  indr            varchar(1),                  -- 'E' = estornada (estorno LÓGICO, como nas outras baixas)
  indr_usuario    integer,
  indr_data       timestamptz,
  dtcadastro      timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_cartao_bx OWNED BY cartao_bx.codvendcartaobx;
CREATE INDEX IF NOT EXISTS ix_cartao_bx_cartao ON cartao_bx (codvendcartao) WHERE coalesce(indr, 'I') <> 'E';
CREATE INDEX IF NOT EXISTS ix_cartao_bx_lote ON cartao_bx (idempresa, idlote);
