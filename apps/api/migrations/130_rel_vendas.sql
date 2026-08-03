-- 130 — RELATÓRIO DE VENDAS (FRMRELVENDAS) — 1º relatório migrado (a categoria "relatórios" não existia no app novo).
-- É o relatório MAIS USADO do sistema (MENUEXPRESS 11.103 acessos; o 2º tem 334). A tela é um HUB de ~50 variantes
-- × 4 trilhas (Vendas/Pedidos/Vendas+NF/NF); o corte-1 migra a variante DOMINANTE: **rel 01 "Produtos vendidos no
-- período", trilha Vendas** — default duplo no .dfm, a única com filtro de Lucro/agrupar-empresas/atacarejo, a de
-- grade mais rica (26 colunas + 5 KPIs) e o molde dos rel 34/46.
--
-- BLOQUEADOR RESOLVIDO AQUI: o legado tira o custo de **VENDAS.VRCUSTO** — um SNAPSHOT na linha da venda (100%
-- populado no golden: 146.556/146.556 em 2023-06). A mig 105 não trouxe essas colunas → sem elas morrem
-- TOTAL_CUSTO, LUCRO, MARGEM, RENTABILIDADE e 4 dos 5 KPIs. Usar multi_preco.vrcusto seria o custo de HOJE (num
-- período com reprecificação a margem se desloca arbitrariamente) — NÃO é fiel. Portanto: colunas de snapshot.
ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS vrcusto    numeric(15,4),  -- custo SNAPSHOT no momento da venda (base do lucro)
  ADD COLUMN IF NOT EXISTS vrcustorep numeric(15,4),  -- custo de reposição snapshot (radio "Filtro Custo")
  ADD COLUMN IF NOT EXISTS promocao   char(1);        -- 'S' = item vendido em promoção (filtro RgPromocao; 16% no golden)

-- config do denominador do LUCRO BRUTO (RELATORIO_VENDAS_LUCRO_BRUTO): valor VIVO do tenant = 'TOTAL CUSTO' →
-- o ramo MARKUP é o que roda: ((TOTAL_VENDA/TOTAL_CUSTO)−1)×100. Com 'TOTAL VENDA' seria markdown.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (903, 'RELATORIO_VENDAS_LUCRO_BRUTO', 'TOTAL CUSTO', 'TEXTO', 'Modulo;Empresa', 'Denominador da margem no Relatório de Vendas: "TOTAL CUSTO" = markup ((venda/custo)−1)×100 (valor do tenant); "TOTAL VENDA" = markdown.'),
  (904, 'VENDAS_FILTRO_CUSTO', 'C', 'C/R', 'Modulo;Empresa', 'Custo default do Relatório de Vendas: C = VRCUSTO; R = VRCUSTOREP (o legado faz um StringReplace global VRCUSTO→VRCUSTOREP). Golden: C.')
ON CONFLICT (id) DO NOTHING;

-- RBAC: 1 gate de TELA + 2 de campo (as 3 únicas opções reais no Oracle p/ este form; nenhuma variante é
-- permissionada individualmente).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELVENDAS', 'FRMRELVENDAS', 7, 1),
  ('FRMRELVENDAS', 'FRMRELVENDAS', 7, 2),
  ('FRMRELVENDAS', 'EDTCFOP',      7, 1)
ON CONFLICT DO NOTHING;
