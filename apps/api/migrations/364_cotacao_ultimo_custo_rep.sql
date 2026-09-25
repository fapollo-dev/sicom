-- O ÚLTIMO CUSTO DE REPOSIÇÃO do item da cotação (o gatilho ATUALIZA_CUSTO_COTACAO, BEFORE INSERT em COTACAO_FORN_ITENS, e a coluna
-- "Ult. Custo Rep." da grade de fornecedores do produto — sqqCotacaoFornVenc, udmCadCotacao.dfm): o VRCUSTOREP do produto na última NF
-- de entrada PROCESSADA e não cancelada DO FORNECEDOR, com CFOP de compra, contabilizada até o dia da cotação. Sem empresa no filtro
-- (o legado não filtra). Na produção, 549 de 550 itens de 2026 com ULTIMO_VALOR batem com esta conta.
CREATE OR REPLACE FUNCTION apollo_ultimo_custo_rep_cotacao(p_codctcforn bigint, p_codcpr bigint) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT coalesce((
    SELECT max(np2.vrcustorep) FROM nf_prod np2
     WHERE np2.codproduto = cpro.idproduto
       AND np2.codnf = (SELECT max(nf2.codnf) FROM nf nf2
                         WHERE nf2.tipo = 'E' AND coalesce(nf2.proc, 'N') = 'S' AND coalesce(nf2.cancelada, 'N') = 'N'
                           AND nf2.codparceiro = f.codparceiro
                           AND trim(nf2.cfop) IN ('1403','2403','1101','2101','1102','2102','1401','2401','1910','2910','1949','2949','1407','2407')
                           AND EXISTS (SELECT 1 FROM nf_prod x WHERE x.codnf = nf2.codnf AND x.codproduto = cpro.idproduto)
                           AND nf2.dtcontabil <= (co.data AT TIME ZONE 'America/Sao_Paulo')::date)), 0)
    FROM cotacao_forn f
    JOIN cotacao_prod cpro ON cpro.codcpr = p_codcpr
    JOIN cotacao co ON co.codctc = cpro.codctc
   WHERE f.codctcforn = p_codctcforn
$$;
