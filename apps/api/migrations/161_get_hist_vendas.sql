-- 161 — CONSULTA DE HISTÓRICO DE VENDAS corte-2: a LISTA/PESQUISA de vendas (`GET_HIST_VENDAS`).
--
-- Por que este corte e não "a consulta de PEDIDOS": o recon do corte-1 propôs como corte-2 a segunda query da
-- tela (`FROM PEDIDOS`), mas ao ir implementar ficou provado que ela é **resíduo morto no fonte** — o dataset
-- `cdsConsHistVendas` NUNCA é aberto em `uConsHistVendas.pas` (só há a declaração, o `CalcFields` e um `.First`
-- dentro do ramo de impressão em :243, cujo `FlagImpressao=False` só é setado dentro dele mesmo). O que está VIVO
-- e faltava é o BOTÃO DE PESQUISA (`BitBtn1Click`, :194): abre `TfrmPesquisa` sobre a view **GET_HIST_VENDAS** e,
-- ao escolher, preenche cupom, pedido, PDV (`COPY(NROPEDIDO,1,2)`) e empresa. É como o operador ACHA a venda.
--
-- A view é cópia fiel da do Oracle (VALID, 17 colunas), com os aliases que o `frmPesquisa` referencia
-- (NRO_CUPOM/TOTAL/DATA/CODCLIENTE/DESCONTO/CANCELADO). O grão está explicado no comentário da view: **uma linha
-- por VENDA × PIS**, porque o GROUP BY EXTERNO do legado tira o produto da chave.
--
-- ⚠️ PERFORMANCE: no Oracle um `select count(*) ... where rownum<=1` NESTA view estoura 180s (ela agrega as
-- 11.922.255 linhas de VENDAS). O legado sempre a filtra (`IDEMPRESA in (...)` + o filtro digitado no frmPesquisa).
-- O endpoint pede recorte de datas **ou** um identificador (cupom/pedido, como o legado, que não exige data) e
-- devolve `truncado` quando bate o teto (lição 12d).

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS importado char(1); -- flag de integração da venda (exposta pela view)

CREATE OR REPLACE VIEW get_hist_vendas AS
-- ⚠️ DOIS níveis de agregação, como a view do Oracle (fold auditoria [ALTA]): o interno agrupa por VENDA × PRODUTO
-- e o EXTERNO agrupa de novo **sem o produto**, somando as três medidas — ou seja, os produtos da mesma venda
-- (com o mesmo PIS) COLAPSAM numa linha só. Medido no golden: 2024-01-15 dá **3.298 linhas** pela view e 5.593 sem
-- o nível externo; o pedido 57150124100420 sai com 16 linhas na view contra 29 (as somas conferem nos dois casos —
-- o que muda é a contagem e o "total da linha").
--
-- ⚠️ E o `CODVENDAS` do Oracle **não é por item**: a PK lá é (NROITEM, NROPEDIDO, CODVENDAS) e em 2024-01-15 há
-- 1.406 pedidos para 1.406 codvendas ⇒ ele identifica a VENDA. No nosso schema `vendas.codvendas` é surrogate por
-- LINHA (mig 105), então a chave de venda equivalente aqui é o **NROPEDIDO**; o `codvendas` exposto é o menor da
-- venda, só para dar chave estável de linha.
SELECT
  v.nropedido,
  c.razao                                   AS cliente,
  v.nrocupom                                AS nro_cupom,
  o.nome                                    AS operador,
  -- TOTAL = Σ (total do item pelo IAT) + Σ acréscimo − Σ desconto, agregado no nível da VENDA (cast DEPOIS da soma)
  cast(sum(v.total_venda + v.acrescimo - v.desc_promocao) AS numeric(18,2)) AS total,
  ve.razao                                  AS vendedor,
  v.idempresa,
  min(v.codvendas)                          AS codvendas,
  v.dtvenda                                 AS data,      -- TRUNC(DTVENDA) no legado: só o dia
  v.codparceiro                             AS codcliente,
  sum(v.desc_promocao)                      AS desconto,
  sum(v.acrescimo)                          AS acrescimo,
  v.importado,
  v.tipocanc                                AS cancelado,  -- NVL(TIPOCANC,'N') — 'C' = cupom cancelado
  v.pis_cst,
  v.pis_valor,
  v.pis_aliquota
FROM (
  SELECT
    a.nropedido,
    a.codproduto,
    min(a.codvendas)                         AS codvendas,
    cast(a.dtvenda AT TIME ZONE 'America/Sao_Paulo' AS date) AS dtvenda, -- TRUNC(DTVENDA) no fuso do tenant (lição 17)
    a.operador,
    a.codvendedor,
    a.codparceiro,
    a.idempresa,
    a.nrocupom,
    coalesce(a.tipocanc, 'N')                AS tipocanc,
    a.importado,
    a.pis_cst, a.pis_valor, a.pis_aliquota,
    -- o MESMO CASE do IAT da consulta do cupom ('A' arredonda, senão trunca em centavos)
    sum(case when a.iat = 'A' then cast(a.qtde * a.vrvenda AS numeric(18,2))
             else cast(trunc(a.qtde * a.vrvenda * 100) AS numeric(18,2)) / 100 end) AS total_venda,
    sum((case when coalesce(a.desc_acre_medio,0) > 0 then coalesce(a.desc_acre_medio,0) else 0 end)
      + (case when coalesce(a.desc_acre_item,0)  > 0 then coalesce(a.desc_acre_item,0)  else 0 end)) AS acrescimo,
    sum(coalesce(a.desc_promocao,0) + coalesce(a.desc_departamento,0)
      + (case when coalesce(a.desc_acre_medio,0) < 0 then coalesce(a.desc_acre_medio,0) * -1 else 0 end)
      + (case when coalesce(a.desc_acre_item,0)  < 0 then coalesce(a.desc_acre_item,0)  * -1 else 0 end)) AS desc_promocao
  FROM vendas a
  GROUP BY a.nropedido, a.codproduto, cast(a.dtvenda AT TIME ZONE 'America/Sao_Paulo' AS date),
           a.operador, a.codvendedor, a.codparceiro, a.tipocanc, a.importado, a.idempresa, a.nrocupom,
           a.pis_cst, a.pis_valor, a.pis_aliquota
) v
LEFT JOIN parceiros  c  ON c.codparceiro  = v.codparceiro
LEFT JOIN parceiros  ve ON ve.codparceiro = v.codvendedor
LEFT JOIN operadores o  ON o.codoperador  = v.operador
-- o GROUP BY externo do legado: sem CODPRODUTO (é o que colapsa os produtos da venda), com os PIS_* na chave.
GROUP BY v.nropedido, c.razao, v.nrocupom, o.nome, ve.razao, v.idempresa, v.dtvenda, v.codparceiro,
         v.importado, v.tipocanc, v.pis_cst, v.pis_valor, v.pis_aliquota;

-- O acesso da lista é (empresa, DIA) e o dia é uma EXPRESSÃO (fuso do tenant), então o índice tem de ser de
-- expressão — um btree em `dtvenda` cru não serve ao predicado (fold auditoria [MÉDIA]).
CREATE INDEX IF NOT EXISTS ix_vendas_emp_dia_local
  ON vendas (idempresa, ((dtvenda AT TIME ZONE 'America/Sao_Paulo')::date));
-- e o caminho "achei o pedido/cupom, quero a venda" (busca sem data, como o legado permite):
CREATE INDEX IF NOT EXISTS ix_vendas_pedido ON vendas (nropedido);
