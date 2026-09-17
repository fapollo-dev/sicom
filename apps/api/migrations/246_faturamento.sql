-- 246 — FATURAMENTO DA NOTA (`FRMFATURAMENTO2`, `uFaturamento2.pas`). **34 acessos, 8 operadores.**
--
-- As **parcelas** de cada nota fiscal: quando vence, quanto, e se já foram liberadas para virar título. É a
-- ponte entre a nota e o financeiro — e é a tela que diz o que está **vencendo hoje**, o que está **atrasado**
-- e o que já foi **faturado**.
--
-- No cliente: **47.063 parcelas** em **42.502 notas**, **R$ 125.733.363,04**, com **7.472 só em 2026**.
-- Por modalidade: A PAGAR 45.897 · A RECEBER 1.143 · BONIFICADO 16 · ⚠️ **APAGAR 7** (a mesma coisa, escrita
-- sem espaço — duas grafias para uma modalidade só, e o legado aceita as duas).
--
-- ── ⚠️ Cópia-fiel-negativa, medida ────────────────────────────────────────────────────────────────────
-- · `TIPOREF` (o "destino" do faturamento: APG/RCB/CHQ/KXP/KXR) é **NULO nas 47.063 linhas**
-- · `LOTE_FATURAMENTO` e `LOTE_FATURAMENTO_DETALHE` têm **0 linhas** — o lote nunca foi usado
-- A aba de movimento do legado, que junta as duas, não tem substrato. O corte cobre a consulta das parcelas.
--
-- ⚠️ **5 parcelas têm o ano digitado errado** (202, 2202, 5202), somando **R$ 11.193,35** — o legado aceita
-- qualquer data. A consulta as mostra (esconder falsearia o total), e a tela as destaca.
CREATE SEQUENCE IF NOT EXISTS seq_faturamento START 1;
CREATE TABLE IF NOT EXISTS faturamento (
  codfaturamento      integer PRIMARY KEY DEFAULT nextval('seq_faturamento'),
  data                date,                    -- o VENCIMENTO da parcela
  idnf                integer,                 -- → nf.codnf
  modalidade          varchar(20),             -- 'A PAGAR' · 'A RECEBER' · 'BONIFICADO' (⚠️ e 'APAGAR')
  valor               numeric(13,2),
  -- 'S' já virou título no financeiro · 'N'/nulo ainda a faturar
  liberado            char(1),
  obs                 varchar(600),
  codoperador         integer,
  nrofatura           integer,
  totalparcelasfatura integer,
  -- ⚠️ nulo nas 47.063 linhas do cliente
  tiporef             char(1),
  codref              integer,
  nronf               varchar(12),
  codbco              integer,
  duplicata           varchar(65),
  valor_desconto      numeric(13,2),
  valor_bonificado    numeric(13,2),
  codbarrasboleto     varchar(48)
);
ALTER SEQUENCE seq_faturamento OWNED BY faturamento.codfaturamento;
CREATE INDEX IF NOT EXISTS ix_faturamento_nf  ON faturamento (idnf);
CREATE INDEX IF NOT EXISTS ix_faturamento_dt  ON faturamento (data, liberado);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMFATURAMENTO2', 'FRMFATURAMENTO2', 7, 1)
ON CONFLICT DO NOTHING;
