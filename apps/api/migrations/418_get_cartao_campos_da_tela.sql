-- 418 — os campos do "Controle de cartões" (FRMCADCARTAO, UcadCartao.dfm) que a get_cartao não trazia: o NSU host e o código da rede
-- (os campos da conciliação — 445 e 178 alterações no HISTORICO de 2025-26), o operador que lançou (DataField NOME), a forma de pagamento
-- (MODALIDADE) e a razão social da loja (RAZAOSOCIAL). Colunas no fim: a view guarda as anteriores na mesma ordem.
CREATE OR REPLACE VIEW get_cartao AS
  SELECT c.codvendcartao, c.codvendcartao AS codigo, c.idempresa, c.dtvenda, c.nrocupom, c.nropedido, c.codpdv,
         c.nroparcela, c.qtde_parcelas, c.codoperadora, o.operadora, c.idpgto, c.tipocartao, c.codbandeira,
         c.nsu, c.autorizacao, c.valor, c.txefetiva, c.valorliq, c.liberado, c.dtbaixa, c.idlote, c.consiliado, c.obs,
         (CASE WHEN COALESCE(otx.txadm,0) > 0 THEN otx.txadm ELSE COALESCE(ot.txadm,0) END) AS txadm_efetiva,
         COALESCE(c.valorliq,
                  (c.valor + COALESCE(c.valor_ajuste_baixa,0))
                   - (c.valor * (CASE WHEN COALESCE(otx.txadm,0) > 0 THEN otx.txadm ELSE COALESCE(ot.txadm,0) END) / 100)
                 )::numeric(13,2) AS valor_com_taxa,
         (CASE extract(dow FROM (c.dtvenda::date + (COALESCE(otx.diafechamento, ot.diascomp, 0) * COALESCE(c.nroparcela,1))))
            WHEN 0 THEN c.dtvenda::date + (COALESCE(otx.diafechamento, ot.diascomp, 0) * COALESCE(c.nroparcela,1)) + 1
            WHEN 6 THEN c.dtvenda::date + (COALESCE(otx.diafechamento, ot.diascomp, 0) * COALESCE(c.nroparcela,1)) + 2
            ELSE c.dtvenda::date + (COALESCE(otx.diafechamento, ot.diascomp, 0) * COALESCE(c.nroparcela,1))
          END) AS previsao_compensacao,
         c.nsuhost, c.codrede, c.codoperador, op.nome AS nome_operador, fp.modalidade, e.razao_social
  FROM cartao c
  LEFT JOIN operadoras o  ON o.codoperadoras = c.codoperadora
  LEFT JOIN operadoras ot ON ot.codoperadoras = COALESCE(NULLIF(o.codoperadorabase,0), o.codoperadoras)
  LEFT JOIN operadoras_taxa otx ON otx.codoperadoras = ot.codoperadoras AND otx.idempresa = c.idempresa
  LEFT JOIN operadores op ON op.codoperador = c.codoperador
  LEFT JOIN formas_pgto fp ON fp.idpgto = c.idpgto
  LEFT JOIN empresas e ON e.idempresa = c.idempresa;
