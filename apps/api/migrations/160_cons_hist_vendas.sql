-- 160 — CONSULTA DE HISTÓRICO DE VENDAS (FRMCONSHISTVENDAS, uConsHistVendas.pas) corte-1: a consulta de UM
-- CUPOM (841 acessos/25 operadores no legado; leitura pura). O que faltava era o CABEÇALHO da venda: as colunas
-- de quem vendeu e para quem, que a tela mostra e o nosso `vendas` (mig 105, feito para relatórios agregados)
-- não tinha. Golden 2024 (272.980 itens em 61.128 cupons): CODPARCEIRO, CODVENDEDOR e OPERADOR preenchidos em
-- **100%** das linhas; DESC_ACRE em 3.523 (1,3%) e IDPRODUTO_FILHO em 8.586 (3,1%).
ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS codparceiro      integer,        -- cliente da venda (→ parceiros)
  ADD COLUMN IF NOT EXISTS codvendedor      integer,        -- vendedor (→ parceiros; o legado guarda vendedor em PARCEIROS)
  ADD COLUMN IF NOT EXISTS operador         integer,        -- operador do caixa (→ operadores)
  ADD COLUMN IF NOT EXISTS desc_acre        numeric(15,2),  -- desconto/acréscimo do CUPOM (≠ os desc_* do item)
  ADD COLUMN IF NOT EXISTS idproduto_filho  integer,        -- produto filho: a DESCRIÇÃO vem da venda, não do cadastro
  ADD COLUMN IF NOT EXISTS descricao        varchar(150);   -- VARCHAR2(150) no Oracle; a grade usa esta quando há
                                                            -- produto filho, senão a do cadastro (PR.DESCRICAO).
-- `vendas.unidade` (snapshot da venda) já existe desde a mig 138, mas ESTA tela lê `PR.UNIDADE` (do cadastro) —
-- é o que o SQL do legado seleciona; a rel 09 é que usa a da venda. Não unificar.

-- o índice de cupom existente é (idempresa, nroserie, nrocupom); a consulta entra por (idempresa, nrocupom) e
-- filtra o PDV pelo PREFIXO do nropedido — ver o dossiê §2: NROPEDIDO = PDV(2)+DDMMYY(6)+HHMMSS(6).
CREATE INDEX IF NOT EXISTS ix_vendas_cupom_emp ON vendas (idempresa, nrocupom);
-- os finalizadores são lidos por NROPEDIDO (`CX_VENDAS WHERE NROPEDIDO = :NROPEDIDO`).
CREATE INDEX IF NOT EXISTS ix_cx_vendas_pedido ON cx_vendas (nropedido);

-- RBAC — no golden o form tem UMA opção só (o gate da tela): 63 linhas / 36 operadores.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT v.form, v.opcao, v.codoperador, v.codempresa
FROM (VALUES
  ('FRMCONSHISTVENDAS', 'FRMCONSHISTVENDAS', 7, 1),
  ('FRMCONSHISTVENDAS', 'FRMCONSHISTVENDAS', 1, 1)
) AS v(form, opcao, codoperador, codempresa)
WHERE NOT EXISTS (
  SELECT 1 FROM permissoes p
  WHERE p.form = v.form AND p.opcao = v.opcao AND p.codoperador = v.codoperador AND p.codempresa = v.codempresa
);
