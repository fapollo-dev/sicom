-- 251 — ANÁLISE DE COMPORTAMENTO DA LOJA (`FRMANALISECOMPORTAMENTO`, `uAnaliseComportamento.pas` 5.911 linhas +
-- `uAnaliseComportamentoFiltro.pas` 3.223 + grid + dm = 9.436 linhas). **53 acessos, 8 operadores.** Item 27 da
-- fila, que estava ADIADO: a tela lê `REL_ANALISE_COPORTAMENTO`, alimentada pelo **Giros** (processo externo que
-- não veio no fonte), e reconstruir o número dava 0,75%. A migration 250 fechou o critério (1 centavo em R$ 1,1
-- milhão) e esta tela vem em cima dele.
--
-- O relatório: para um mês/ano, TRÊS blocos (mês anterior, mês atual, mesmo mês do ano anterior), cada um com
-- NOVE linhas — Faturamento, CMV, Rentabilidade (R$), Previsão de Impostos, Lucro Final, Margem Bruta (%),
-- Margem Final (%), Num. Clientes, Ticket Médio — em CINCO "semanas" + total; e DOIS comparativos (mês atual ×
-- mês anterior; mês atual × ano anterior) com diferença e variação de cada linha.
--
-- ── As "semanas" são blocos FIXOS de 7 dias, não semanas de calendário ─────────────────────────────────
-- Semana 1 = dias 1–7, 2 = 8–14, 3 = 15–21, 4 = 22–28, 5 = 29–fim. Confirmado na cache linha a linha (uma
-- linha por DIA, cada dia cai na coluna SEMANA_n do seu bloco) e no valor: semana 1 de ago/2026 na loja 1 é
-- **238.838,52** na cache e **238.838,52** no cálculo; semana 5 é 117.555,28 = 116.891,44 de venda + 663,84 de NF.
--
-- ── O CMV por semana: 1–3 exatos, 4–5 com o resíduo do Giros ───────────────────────────────────────────
-- Ago/2026, loja 1: semanas 1, 2 e 3 batem em **0,00**; a 4 difere 159,62 (0,07%) e a 5 570,96 (0,7%) — o custo
-- da madrugada seguinte, já medido e explicado na migration 250. Num. Clientes: semanas 3, 4 e 5 diferem em
-- 0, 1 e 1 cupom; as semanas 1 e 2 em 29 e 162 (os dois dias de 11 e 12/08 com cupons cancelados depois do job).
--
-- ── ⚠️ A mesma tela tem DOIS critérios: sem filtro lê a cache, com filtro CALCULA — e calcula errado ────
-- Ao filtrar por departamento/grupo/subgrupo/seção/fornecedor, `uAnaliseComportamentoFiltro` não pode usar a
-- cache (que é por dia, sem família) e monta a conta em cima de VENDAS/NF_PROD. Medido em ago/2026, loja 1:
--   • FATURAMENTO: `SUM(QTDE × VRVENDA)` sem arredondar por item e sem os descontos → **1.153.860,03** contra
--     1.146.825,82 da cache (+0,61%). E a NF entra por `NF_PROD.VRVENDA`, que é **zero em 57 dos 62 itens** das
--     notas de venda do cliente (o valor está em VRCUSTO) → NF = **0,00** contra 872,74.
--   • CMV: `LEFT JOIN MULTI_PRECO M ON M.IDPRODUTO = V.CODPRODUTO` **sem IDEMPRESA** — cada linha de venda vira
--     uma por loja com preço: **111.535 linhas viram 475.737 (×4,265)**. Mais ICMS-ST, frete, IPI e despesas
--     acessórias do preço de HOJE. Resultado: **R$ 3.518.208,52** contra R$ 805.652,00 reais — **4,37×**. Com o
--     filtro ligado, a tela mostra CMV maior que o faturamento e "Rentabilidade" negativa em 2,4 milhões.
--   • E o WHERE do CMV carrega um **`AND V.IDEMPRESA IN (1)` fixo no código** — o operador da loja 2 vê o CMV da
--     loja 1 (R$ 804.921,42 × 4,27) sobre o faturamento da loja 2 (R$ 1.071.188,61).
-- Aqui há UM critério (o da migration 250) com ou sem filtro; o filtro só recorta.
--
-- ── ⚠️ A "Previsão de Impostos" nunca teve dado ────────────────────────────────────────────────────────
-- A linha soma `ABS(CAIXA.VALOR)` das contas do plano marcadas na tabela `IMPOSTOS`. No cliente, `IMPOSTOS`
-- tem **0 linhas** — e `CAIXA ⋈ IMPOSTOS` nunca produziu uma linha em toda a história. Logo Lucro Final =
-- Rentabilidade e Margem Final = Margem Bruta, sempre. A regra é viva (a própria tela mantém a lista, pelo
-- botão "Selecionar Plano de Contas" e pelo "Excluir"), então a tabela entra e a manutenção vem junto.
--
-- ── Folds ───────────────────────────────────────────────────────────────────────────────────────────────
--  • Tenant-scoped (o legado monta `IDEMPRESA IN (lista)` pelo seletor multi-empresa).
--  • A % do comparativo aqui já divide pela BASE (`Dif / Anterior`) — ao contrário da irmã (migration 250),
--    esta tela acerta. Mantido.
--  • `REL_ANALISE_COMPORTAMENTO_GRID` (1.850 linhas) é buffer de impressão do `.fr3`, não fonte: ignorada.
--  • Exportar para Excel e o `.fr3`: acessórios; o retorno traz o material da grade.

-- as contas do plano que a tela considera "imposto" — o legado guarda CODPLC + descrição
CREATE TABLE IF NOT EXISTS impostos (
  codplc     integer PRIMARY KEY REFERENCES plc(codplc),
  descricao  varchar(80)
);

-- a linha de impostos varre o caixa do mês por conta
CREATE INDEX IF NOT EXISTS ix_caixa_emp_data_plc ON caixa (idempresa, data, codplc);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMANALISECOMPORTAMENTO', 'FRMANALISECOMPORTAMENTO', 7, 1),
  ('FRMANALISECOMPORTAMENTO', 'BTNGRAVAR',  7, 1),
  ('FRMANALISECOMPORTAMENTO', 'BTNEXCLUIR', 7, 1)
ON CONFLICT DO NOTHING;
