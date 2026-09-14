-- 216 — RELATÓRIOS DE PRODUTOS (`FRMPRODUTOSREL`), corte-1. 162 acessos, 19 operadores.
--
-- ⚠️ A TELA É UM ÉPICO, NÃO UMA TELA: `uProdutosRel.pas` (2.687 linhas) + `.dfm` (3.640) +
-- `UDMProdutosRel` (410/3.699) + três grades auxiliares — **~10.900 linhas** e **15 relatórios** num combo
-- só, servidos por 21 datasets. O corte-1 entrega os três que compartilham o mesmo núcleo de estoque;
-- os outros doze estão listados no dossiê, com o substrato de cada um medido.
--
-- ── Onde o estoque REALMENTE vive ───────────────────────────────────────────────────────────────────────
-- O legado tem duas tabelas gêmeas, e é fácil escolher a errada:
--   · `ESTOQUE_DEP` — 203.546 linhas e **completamente zerada** no cliente: nenhuma quantidade, nenhum
--     mínimo, nenhum máximo, nenhum local. Este cliente **não usa estoque por depósito**.
--   · `ESTOQUE`     — as mesmas 203.546 linhas, e é onde o número está: **4.121 produtos com estoque
--     negativo**, 186.487 zerados.
-- Medido na produção em 14/09/2026. A escolha da tabela decide se o relatório mostra tudo zero.
--
-- ── As 7 colunas que faltavam em `estoque` ──────────────────────────────────────────────────────────────
-- `qtde`, `minimo`, `maximo` e `local` já vinham. Faltavam as de reserva e as datas de giro — e são elas
-- que separam "tenho 10 em estoque" de "tenho 10, mas 8 já estão vendidos e não saíram".
ALTER TABLE estoque ADD COLUMN IF NOT EXISTS qtde_est_ped_vendas  numeric(15,4);
ALTER TABLE estoque ADD COLUMN IF NOT EXISTS qtde_est_ped_compras numeric(15,4);
ALTER TABLE estoque ADD COLUMN IF NOT EXISTS qtde_est_condicional numeric(15,4);
ALTER TABLE estoque ADD COLUMN IF NOT EXISTS qtde_cong            numeric(15,4);
ALTER TABLE estoque ADD COLUMN IF NOT EXISTS qtde_bk              numeric(15,4);
-- a data da última venda e a anterior: é com elas que se mede giro e ruptura
ALTER TABLE estoque ADD COLUMN IF NOT EXISTS dtvenda              timestamp;
ALTER TABLE estoque ADD COLUMN IF NOT EXISTS dtvenda_anterior     timestamp;

CREATE INDEX IF NOT EXISTS ix_estoque_negativo ON estoque (idempresa, idproduto) WHERE qtde < 0;

-- RBAC: gate de tela.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMPRODUTOSREL', 'FRMPRODUTOSREL', 7, 1)
ON CONFLICT DO NOTHING;
