-- 309 — O RESTO DO ACHADO 18 (FILA): o que a origem tem com valor e o destino não tinha, depois da triagem de 23/09/2026.
--
-- A ESCADA DE PREÇO no momento da venda e da entrada: o PDV grava em cada item vendido a foto do catálogo (créditos,
-- débitos, despesa operacional, IR, CSLL, composição do custo) — 86% das 18,9 milhões de vendas —, e a nota de entrada
-- grava a sua (lucro bruto/líquido, IR, CSLL — 380 mil itens). Nenhuma tela do retaguarda de 2020 as lê (a Rentabilidade
-- calcula pelo catálogo ATUAL), mas a foto é irrecuperável depois da virada: vem, e fica. Nas duas, o motor as preserva
-- quando a tela salva (colunas não gerenciadas).
ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS creditoicm             numeric(13,2),
  ADD COLUMN IF NOT EXISTS creditopiscofins       numeric(13,2),
  ADD COLUMN IF NOT EXISTS debitoicm              numeric(13,2),
  ADD COLUMN IF NOT EXISTS despopv                numeric(13,2),
  ADD COLUMN IF NOT EXISTS imprend                numeric(13,2),
  ADD COLUMN IF NOT EXISTS contsocial             numeric(13,2),
  ADD COLUMN IF NOT EXISTS frete                  numeric(13,2),
  ADD COLUMN IF NOT EXISTS frete2                 numeric(13,2),
  ADD COLUMN IF NOT EXISTS ipi                    numeric(13,2),
  ADD COLUMN IF NOT EXISTS seguro                 numeric(13,2),
  ADD COLUMN IF NOT EXISTS despacessorio          numeric(13,2),
  ADD COLUMN IF NOT EXISTS icmst                  numeric(13,2),
  ADD COLUMN IF NOT EXISTS pis                    char(1),         -- o produto tributava PIS/COFINS na venda
  ADD COLUMN IF NOT EXISTS icms_taxa_reducao_bc   numeric(13,2),   -- % de redução da base do cupom (1,9% dos itens)
  ADD COLUMN IF NOT EXISTS icms_origem_mercadoria integer;         -- origem da mercadoria no XML (4 em 4.411 vendas 2024+)

ALTER TABLE nf_prod
  ADD COLUMN IF NOT EXISTS debitoicm   numeric(13,2),
  ADD COLUMN IF NOT EXISTS despopv     numeric(13,2),
  ADD COLUMN IF NOT EXISTS imprend     numeric(13,2),
  ADD COLUMN IF NOT EXISTS contsocial  numeric(13,2),
  ADD COLUMN IF NOT EXISTS lucrobrutov numeric(13,2),
  ADD COLUMN IF NOT EXISTS lucrobrutop numeric(13,2),
  ADD COLUMN IF NOT EXISTS lucroliqv   numeric(13,2),
  ADD COLUMN IF NOT EXISTS lucroliqp   numeric(13,2);

-- os totais de PIS e COFINS da NF-e (campos do cabeçalho da tela de nota, uNF.dfm:4188/4305 — 11.608 notas); o SPED do
-- legado não os usa (grava 0, UdmSpedPisCofins.dfm:1951)
ALTER TABLE nf
  ADD COLUMN IF NOT EXISTS pis_nfe    numeric(13,2),
  ADD COLUMN IF NOT EXISTS cofins_nfe numeric(13,2);

-- o produto tributa PIS ('S'/'N'; 119 'N') — a apuração do legado o lê (Uapuracao.dfm:1535)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pis char(1);
