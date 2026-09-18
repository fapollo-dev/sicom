-- 275 — DEVOLUÇÃO DE VENDAS (`FRMDEVOLUCAOVENDAS`, `uDevolucaoVendas.pas` 1.019 linhas + `udmDevolucaoVendas`).
-- **3.958 acessos, 36 operadores, último em 17/09/2026.** Dossiê: `uDevolucaoVendas.md`.
--
-- ⚠️ **Esta tela não estava na fila de conversão nem no Apollo.** A fila (194 telas) foi gerada cruzando o
-- `MENUEXPRESS` com os `FRM*` presentes em `apps/api` — e 8 formulários com uso ficaram **fora dos dois
-- lados**, somando **43.071 acessos**. Este é o maior deles que é de RETAGUARDA (os outros são PDV, fora
-- de escopo por instrução, ou a integração Borba Fiscal). Achado de 18/09/2026.
--
-- ── O que a tela faz ──────────────────────────────────────────────────────────────────────────────────
-- O cliente volta à loja com mercadoria comprada. O operador acha o cupom (PDV + número, ou por período),
-- marca os itens e a quantidade devolvida, escolhe um MOTIVO e registra. Também reverte um registro feito
-- por engano.
--
-- ── ⚠️ A regra mais importante está num comentário do fonte: o ESTOQUE NÃO VOLTA ──────────────────────
-- `btnEstornarClick` (uDevolucaoVendas.pas:400-403) tem o `UPDATE ESTOQUE ... QTDE + devolvido`
-- **comentado**, com a justificativa em caixa alta:
--     `//ESTOQUE NÃO DEVE SER ALTERADO SEM PROCESSO FISCAL`
-- Ou seja: a devolução de venda **registra e marca**, mas quem devolve o estoque é a NF de devolução
-- (processo fiscal). Copiado exatamente assim — e é o tipo de regra que, "melhorada" por conta própria,
-- criaria estoque do nada.
--
-- ── O que o dado diz (produção, 18/09/2026) ─────────────────────────────────────────────────────────────
--  · `DEVOLUCAO_VENDAS`: **3.658 linhas** — 2020: 173 · 2021: 813 · 2022: 846 · 2023: 347 · 2024: 541 ·
--    2025: 688 · **2026: 250** (R$ 4.466,96). Duas empresas. Fluxo contínuo, nunca parou.
--  · **3.583 de 3.658 têm motivo** (`CODMOTIVOOP` → `motivos_operacao` com `TIPO_OPERACAO='DEVOLUCAO'`).
--  · `VENDAS.DEVOLUCAO='D'` em 243 itens de 2026 (e 6 com o literal `' '`, que é o valor que a REVERSÃO
--    grava — o legado escreve `' '`, não NULL).
--  · **`CODAPG_DEVOLUCAO_SALDO`: 0 de 3.658.** A geração de saldo/crédito ao cliente
--    (`GeraSaldoCliente`, gated pela config `GERA_SALDO_CLIENTE_DEVOLUCAO_VENDA`) **nunca foi usada** —
--    fica fora do corte, com a prova.
CREATE SEQUENCE IF NOT EXISTS seq_devolucao_vendas;
CREATE TABLE IF NOT EXISTS devolucao_vendas (
  coddevolucaovenda      integer PRIMARY KEY DEFAULT nextval('seq_devolucao_vendas'),
  datadevolucao          timestamptz NOT NULL DEFAULT now(),
  operador               varchar(60),            -- o legado grava o NOME do operador, não o código
  codvendas              bigint NOT NULL,
  codproduto             integer NOT NULL,
  idempresa              integer NOT NULL,
  nroitem                integer NOT NULL,
  codmotivoop            integer REFERENCES motivos_operacao(codmotivoop),
  codapg_devolucao_saldo integer,                -- 0 de 3.658 no cliente: o saldo ao cliente nunca foi usado
  codoperador            integer,                -- o CÓDIGO (o legado só guarda o nome; aqui os dois)
  dtcadastro             timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_devolucao_vendas OWNED BY devolucao_vendas.coddevolucaovenda;
-- a chave que o legado usa para não duplicar (`RetornarValores('DEVOLUCAO_VENDAS', 'CODVENDAS;CODPRODUTO;IDEMPRESA;NROITEM')`)
CREATE UNIQUE INDEX IF NOT EXISTS ux_devolucao_vendas_item
  ON devolucao_vendas (codvendas, codproduto, idempresa, nroitem);
CREATE INDEX IF NOT EXISTS ix_devolucao_vendas_data ON devolucao_vendas (idempresa, datadevolucao);

-- as colunas que a devolução marca na venda e que o destino não tinha
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS qtde_devolvido       numeric(13,3);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS total_item_devolvido numeric(13,2);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS codnf_devolucao      integer;

-- o motivo é de um tipo próprio no legado (`MOTIVOS_OPERACAO.TIPO_OPERACAO='DEVOLUCAO'`)
INSERT INTO motivos_operacao (codmotivoop, descricao, tipo_operacao) VALUES
  (301, 'DEVOLUCAO DE VENDA', 'DEVOLUCAO')
ON CONFLICT (codmotivoop) DO NOTHING;
SELECT setval('seq_motivos_operacao', (SELECT GREATEST(coalesce(max(codmotivoop), 1), 301) FROM motivos_operacao));

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMDEVOLUCAOVENDAS', 'FRMDEVOLUCAOVENDAS', 7, 1),
  ('FRMDEVOLUCAOVENDAS', 'BTNESTORNAR',        7, 1),
  ('FRMDEVOLUCAOVENDAS', 'BTNREVERTER',        7, 1)
ON CONFLICT DO NOTHING;
