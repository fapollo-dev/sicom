-- 131 — PRÉVIA DO FORNECEDOR / ANÁLISE DE GIRO (FRMRELLISTAPRECOSFORNECEDOR) — corte-1.
-- 2º relatório migrado. 6.694 acessos / 21 operadores (o maior ALCANCE entre as telas vivas não-migradas).
-- É uma MATRIZ produto × período: antes da visita do fornecedor o comprador vê o que girou em cada período e
-- decide a compra. O legado roda uma query POR período (até 15 datasets paralelos, cdsPeriodo1..15) e casa com a
-- lista de produtos no cliente — por isso PRODUTO SEM VENDA APARECE COM ZERO (é o ponto do relatório).
--
-- BLOQUEADORES RESOLVIDOS AQUI (mesma disciplina da mig 130: só cria coluna que é VIVA no legado):
--  1) NF_PROD.VRCUSTOREP — a perna de NF da UNION faz AVG(VRCUSTOREP). Vivo: 252.327/252.468 preenchidos,
--     244.031 > 0 no golden. (VENDAS.VRCUSTO/VRCUSTOREP já vieram na mig 130 — dividendo do corte anterior.)
--  2) ESTOQUE.DTENT/QTDE_ENT — a lista de produtos mostra a ÚLTIMA ENTRADA (GetSQLListaProdutos:
--     'E.DTENT DTULTENT, E.QTDE_ENT QTDEULTENT'). Vivo mas ESPARSO: 16.716/137.524 linhas (12%), até 2026-06-30.
--     Nullable e SEM backfill de propósito → a tela renderiza "—", nunca 0 (lição do denominador nulo).
ALTER TABLE nf_prod
  ADD COLUMN IF NOT EXISTS vrcustorep numeric(15,4);   -- custo de reposição do item da NF (AVG na matriz)

ALTER TABLE estoque
  ADD COLUMN IF NOT EXISTS dtent    timestamptz,       -- data da última entrada do produto na empresa
  ADD COLUMN IF NOT EXISTS qtde_ent numeric(15,3);     -- quantidade da última entrada

-- índice do lado das VENDAS já existe (ix_vendas_empresa_data, mig 105). A perna de NF filtra por DTCONTABIL:
CREATE INDEX IF NOT EXISTS ix_nf_empresa_dtcontabil ON nf (idempresa, dtcontabil);

-- RBAC: gate de TELA único — é a única opção que existe no Oracle p/ este form (48 grants, nenhuma opção de campo).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELLISTAPRECOSFORNECEDOR', 'FRMRELLISTAPRECOSFORNECEDOR', 7, 1),
  ('FRMRELLISTAPRECOSFORNECEDOR', 'FRMRELLISTAPRECOSFORNECEDOR', 7, 2)
ON CONFLICT DO NOTHING;
