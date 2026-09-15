-- 220 — DIAS DE ESTOQUE / COBERTURA (`FRMRELDDE`) e a tabela de 4 milhões de linhas que faltava.
--
-- ── ⚠️ `MOVIMENTACAO_DIARIA` não estava na carga ────────────────────────────────────────────────────────
-- É a venda **por produto e por dia**, consolidada: `IDEMPRESA · CODPRODUTO · DATA · QTDE`. Medida na
-- produção em 15/09/2026: **4.034.759 linhas**, de 02/01/2019 a **14/09/2026**, cobrindo **18.296 produtos**.
-- Sem ela não existe cobertura de estoque, nem giro, nem curva de venda diária — e ela é a fonte barata
-- desses números: somar `VENDAS` (18,9 milhões de linhas) para o mesmo fim custa uma ordem de grandeza mais.
--
-- É a **maior tabela** que encontramos ausente até aqui.
CREATE TABLE IF NOT EXISTS movimentacao_diaria (
  idempresa  integer NOT NULL,
  codproduto integer NOT NULL,
  data       date    NOT NULL,
  qtde       numeric(15,3),
  CONSTRAINT pk_movimentacao_diaria PRIMARY KEY (idempresa, codproduto, data)
);

-- o relatório sempre corta por janela de dias a partir de hoje, e sempre por empresa
CREATE INDEX IF NOT EXISTS ix_mov_diaria_data ON movimentacao_diaria (idempresa, data);

INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMRELDDE', 'FRMRELDDE', 7, 1)
ON CONFLICT DO NOTHING;
