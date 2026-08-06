-- 138 — CURVA ABC DE PRODUTOS VENDIDOS (rel 09 do hub FRMRELVENDAS) — 6º relatório.
-- Procedência: uVendas.pas TVendas.CurvaABCProdutosVendidos (despacho GetSQL, case 09) + o PascalScript do
-- `Relatorios/ven2_09 - Curva_ABC_ Produtos_vendidos.fr3`, que é ONDE MORA A CLASSIFICAÇÃO (o SQL não classifica
-- nada: ele só CARREGA os cortes PC_CURVA_ABC_A/B/C da EMPRESA e ordena por TOTAL_VENDA desc).
--
-- Três colunas faltavam para a cópia ser fiel:
--
-- 1) EMPRESAS.PC_CURVA_ABC_A/B/C — os CORTES da curva, por empresa. Vivos nas 4 empresas do golden
--    (1: 70/15/10 · 2: 70/20/10 · 50: 75/25/0 · 51: 70/20/10). Repare que a soma NÃO é 100 em 3 das 4 — isso
--    não é erro de digitação, é o que produz a faixa "sem letra" descrita no serviço. Ficam NULL até o cutover
--    carregar: inventar 80/15/5 aqui seria fabricar política de estoque do cliente.
--    As variantes _QTDE (rel 18, curva por quantidade) e _D/_E (curvas de 5 faixas) NÃO entram — nenhuma é lida
--    por esta variante.
--
-- 2) VENDAS.UNIDADE — a rel 09 exibe **V.UNIDADE** (o snapshot na linha da venda), não P.UNIDADE como a rel 01.
--    Não é preciosismo: em jun/23 são **564 de 146.556 linhas** (0,4%) em que a unidade da venda difere da
--    cadastrada hoje no produto. 100% populada no golden.
--
-- 3) VENDAS.DESC_ACRE — a coluna "DESCONTO" da grade da rel 09, somada à parte. Esparsa mas VIVA: 2.079 linhas
--    não-zero em 146.556 (1,4%) no mesmo mês. Coluna de DINHEIRO exibida ⇒ entra, como entrou apagar.vendor.
--
-- 4) VENDAS.IDPRODUTO_FILHO — achado COLATERAL, e ele conserta a rel 01 já entregue. O checkbox «Exibir produtos
--    filhos» (CkbExibirProdutosFilhos) troca a CHAVE DE AGRUPAMENTO do relatório para o produto FILHO
--    (`COALESCE(A.IDPRODUTO_FILHO, A.CODPRODUTO)`, uVendas.pas:1867/1986 na rel 01 e :7053 na rel 09) — 15
--    ocorrências no arquivo, é um modo transversal do hub, não um detalhe da curva. A coluna está VIVA: 80.327
--    linhas desde 2023. Sem ela o modo simplesmente não existia no app novo (a rel 01 saiu sempre agrupada pelo
--    PAI). Entra aqui e as duas telas passam a oferecê-lo.
ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS unidade         char(2),          -- unidade SNAPSHOT da venda (a rel 09 exibe esta, não a do produto)
  ADD COLUMN IF NOT EXISTS desc_acre       numeric(15,2),    -- desconto/acréscimo do item (coluna "DESCONTO" da rel 09)
  ADD COLUMN IF NOT EXISTS idproduto_filho integer;          -- produto FILHO da venda (chave do modo «Exibir produtos filhos»)

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS pc_curva_abc_a numeric(13,2),  -- corte da faixa A (% do faturamento acumulado)
  ADD COLUMN IF NOT EXISTS pc_curva_abc_b numeric(13,2),  -- largura da faixa B (SOMA-SE ao corte A, não é o teto)
  ADD COLUMN IF NOT EXISTS pc_curva_abc_c numeric(13,2);  -- largura da faixa C (idem, soma-se a A+B)

-- Sem RBAC novo: o gate do hub ('FRMRELVENDAS'/'FRMRELVENDAS') já existe desde a mig 130 e a curva ABC é uma
-- variante do mesmo form — o legado não permissiona variante.
