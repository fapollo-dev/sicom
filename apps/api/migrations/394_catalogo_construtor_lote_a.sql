-- 394 — o CATÁLOGO do construtor, lote A: 23 fontes da produção que não existiam aqui (tools/cutover/catalogo-construtor-producao.json,
-- o retrato de 29/09/2026; conferidas pelo smoke §283). A lista de colunas vai explícita no CREATE VIEW, como no Oracle, onde ela
-- manda sobre os aliases do SELECT. O rótulo (COMMENT) é o do combo: o COMMENT de lá sem o ';' do início.
--
-- O que é do legado e fica: GET_EMPRESAS_SITE só as empresas 4, 5 e 6 (fixo na view); GET_PARCEIROS_SITUACAO casa com a VIEW
-- GET_PARCEIROS do legado — uma linha por endereço do parceiro, aqui `rel_get_parceiros`; GET_HISTORICO_PDV e GET_HISTORICO_DESCONTO
-- leem a HISTORICO_PDV, que existe aqui só como estrutura (PDV, fora do escopo — plano-tabelas.json) e sai vazia.
-- Diferença deliberada: o rótulo 'HistÃ³rico Desconto' (o COMMENT de lá já está com o UTF-8 lido como cp1252) sai 'Histórico Desconto'.

CREATE OR REPLACE VIEW get_cest (codigo, cest, ncm, descricao) AS
SELECT codcest, cest, ncm, descricao FROM cest;
COMMENT ON VIEW get_cest IS 'CEST';

CREATE OR REPLACE VIEW get_basecredito (codigo, descricao) AS
SELECT p.idbasecredito, p.descricao FROM pc_basecredito p;
COMMENT ON VIEW get_basecredito IS 'BASECREDITO';

CREATE OR REPLACE VIEW get_config_import_conciliador (codigo, descricao) AS
SELECT cic_id, cic_descricao FROM config_import_conciliador;
COMMENT ON VIEW get_config_import_conciliador IS 'Layout conciliador';

CREATE OR REPLACE VIEW get_formas_pgto_site (idpgto, modalidade, idempresa, destino) AS
SELECT idpgto, modalidade, idempresa, destino FROM formas_pgto;
COMMENT ON VIEW get_formas_pgto_site IS 'FORMAS PAGAMENTO SITE';

CREATE OR REPLACE VIEW get_operadoras_site (codoperadoras, operadora, ativo) AS
SELECT codoperadoras, operadora, coalesce(ativo, 'S') FROM operadoras;
COMMENT ON VIEW get_operadoras_site IS 'OPERADORAS SITE';

CREATE OR REPLACE VIEW get_tab_ajuste_pis (cod_aj, descricao, tipo, ativo) AS
SELECT cod_aj, descricao, tipo, ativo FROM pc_tab_ajuste_pis WHERE ativo = 'S';
COMMENT ON VIEW get_tab_ajuste_pis IS 'Codigos de Ajuste PIS (tabela 4.3.18)';

CREATE OR REPLACE VIEW get_tab_ajuste_cofins (cod_aj, descricao, tipo, ativo) AS
SELECT cod_aj, descricao, tipo, ativo FROM pc_tab_ajuste_cofins WHERE ativo = 'S';
COMMENT ON VIEW get_tab_ajuste_cofins IS 'Codigos de Ajuste Cofins (tabela 4.3.19)';

CREATE OR REPLACE VIEW get_lote_remessa_pagamento (codigo) AS
SELECT DISTINCT lote_remessa FROM apagar WHERE lote_remessa <> 0 ORDER BY lote_remessa;
COMMENT ON VIEW get_lote_remessa_pagamento IS 'Lote remessa de pagamento';

CREATE OR REPLACE VIEW get_inventarios (codigo, data_inventario, idempresa, qtde_itens) AS
SELECT idunico, datainventario, idempresa, count(*) FROM inventario GROUP BY idunico, datainventario, idempresa;
COMMENT ON VIEW get_inventarios IS 'INVENTARIOS';

CREATE OR REPLACE VIEW get_historico_desconto (descricao) AS
SELECT DISTINCT h.motivo FROM historico_pdv h WHERE h.motivo IS NOT NULL AND upper(h.motivo) LIKE '%DESCONTO%';
COMMENT ON VIEW get_historico_desconto IS 'Histórico Desconto';

CREATE OR REPLACE VIEW get_parceiros_situacao (codigo, codparceiro, razao) AS
SELECT sp.idsituacao_nf, sp.codparceiro, p.razao FROM situacao_nf_parceiros sp JOIN rel_get_parceiros p ON p.codigo = sp.codparceiro;
COMMENT ON VIEW get_parceiros_situacao IS 'GET_PARCEIROS_SITUACAO';

CREATE OR REPLACE VIEW get_historico_pdv (idempresa, codpdv, responsavel, usuario, data, nrocupom, chave, nropedido, tipo, motivo, historico) AS
SELECT idempresa, codpdv, responsavel, usuario, data::date, nrocupom, chave, nropedido, tipo, motivo, historico FROM historico_pdv;
COMMENT ON VIEW get_historico_pdv IS 'HISTORICO PDV';

CREATE OR REPLACE VIEW get_pdv (numero_pdv, descricao, codempresa, codigo, conta_contabil, nro_serie, modelo) AS
SELECT p.nropdv, p.descricao, p.codempresa, p.codpdv, pc.codireduzido, p.nroserie, p.modelo
  FROM pdv p LEFT JOIN plano_contas pc ON pc.codplanocontas = p.codplanocontas;
COMMENT ON VIEW get_pdv IS 'PDV';

CREATE OR REPLACE VIEW get_empresas_site (codempresa, idcidade, razaosocial, fantasia, cnpj, insc, uf, cidade, bairro, endereco, numero,
                                          complemento, fone1, fone2) AS
SELECT idempresa, idcidade, razao_social, fantasia, cnpj, insc, uf, cidade, bairro, endereco, numero, complemento, fone1, fone2
  FROM empresas WHERE idempresa IN (4, 5, 6);
COMMENT ON VIEW get_empresas_site IS 'EMPRESAS SITE';

CREATE OR REPLACE VIEW get_mensagens_nf (codigo, descricao, texto) AS
SELECT codconfiglegislacao, descricao, observacoes::varchar(600) FROM config_legislacao
 WHERE coalesce(indr, 'I') <> 'E' AND coalesce(tipo, 'U') <> 'S';
COMMENT ON VIEW get_mensagens_nf IS 'MENSAGEM PARA NOTA FISCAL';

CREATE OR REPLACE VIEW get_mov_analise_concorrente (codigo, data_mov, idempresa, idanalise, descricao_analise, ativo) AS
SELECT m.idmovanalise, m.data_mov::date, m.idempresa, m.idanalise, a.desc_analise, m.ativo
  FROM mov_analise_concorrente m LEFT JOIN analise_concorrencia a ON a.idanalise = m.idanalise;
COMMENT ON VIEW get_mov_analise_concorrente IS 'MOV ANALISE CONCORRENTE';

CREATE OR REPLACE VIEW get_piscofins (descricao, aliq_pis_ent, aliq_pis_sai, aliq_cofins_ent, aliq_cofins_sai, cst_pis_ent, cst_pis_sai,
                                      cst_cofins_ent, cst_cofins_sai, codigo, exigenatureza) AS
SELECT descricao, aliq_pis_ent, aliq_pis_sai, aliq_cofins_ent, aliq_cofins_sai, cst_pis_ent, cst_pis_sai, cst_cofins_ent, cst_cofins_sai,
       idpiscofins, exigenatureza FROM piscofins;
COMMENT ON VIEW get_piscofins IS 'PIS COFINS';

-- (o kardex: QTDE_ALTER/QTDE_ATUAL do legado moram em qtde/saldo_novo — extrair.py RENOMEIA)
CREATE OR REPLACE VIEW get_historico_prod (idproduto, codbarra, descricao, qtde_alterada, saldo_atual, data, historico, idempresa) AS
SELECT h.idproduto, p.codbarra, p.descricao, h.qtde, h.saldo_novo, h.data::date, h.historico, h.idempresa
  FROM historico_prod h JOIN produtos p ON p.idproduto = h.idproduto;
COMMENT ON VIEW get_historico_prod IS 'FICHA KARDEX';

CREATE OR REPLACE VIEW get_nf_prod_validade (codbarra, descricao, lote, validade, empresa) AS
SELECT DISTINCT p.codbarra, p.descricao, n.lote, n.dtvalidade::date, n.idempresa
  FROM nf_prod_lote n JOIN produtos p ON p.idproduto = n.idproduto WHERE n.dtvalidade IS NOT NULL;
COMMENT ON VIEW get_nf_prod_validade IS 'VALIDADES';

CREATE OR REPLACE VIEW get_parceiros_site (codparceiro, razao, fantasia, tipofj, ativado, cliente, fornecedor, convenio, funcionario,
                                           transportadora, sexo, dtnascimento, site) AS
SELECT codparceiro, razao, fantasia, tipofj, coalesce(ativado, 'S'), cli, frn, con, fun, tra, sexo, dtnascimento, site FROM parceiros;
COMMENT ON VIEW get_parceiros_site IS 'PARCEIROS SITE';

CREATE OR REPLACE VIEW get_parceiros_end_site (codend, codparceiro, idcidade, ativado, cnpj_cpf, rg_insc, cep, uf, cidade, bairro, endereco,
                                               numero, complemento, tipo_endereco, telefone, celular, fax, site) AS
SELECT codend, codparceiro, idcidade, coalesce(ativado, 'S'), cnpj_cpf, rg_insc, cep, uf, cidade, bairro, endereco, numero, complemento,
       tipo_endereco, telefone, celular, fax, site FROM parceiros_end;
COMMENT ON VIEW get_parceiros_end_site IS 'PARCEIROS ENDERECO SITE';

CREATE OR REPLACE VIEW get_cst_ibs_cbs (cst, descricao_cst, ind_gibscbs, ind_gibscbsmono, ind_gred, ind_gdif, ind_gtranf_cred, ind_nfe,
                                        ind_nfce, ind_cte, ind_cteos, ind_bpe, ind_bpetm, ind_nf3e, ind_nfcom, ind_nfse) AS
SELECT cst, descricao_cst, ind_gibscbs, ind_gibscbsmono, ind_gred, ind_gdif, ind_gtranf_cred, ind_nfe, ind_nfce, ind_cte, ind_cteos,
       ind_bpe, ind_bpetm, ind_nf3e, ind_nfcom, ind_nfse FROM cst_ibs_cbs;
COMMENT ON VIEW get_cst_ibs_cbs IS 'CST IBS CBS';

CREATE OR REPLACE VIEW get_reducaoz (codigo, data, nroterminal, nroserie, modelo, cooi, coof, cooz, gtinicial, gtfinal, vendaliq, vendabruta,
                                     isentos, ntb, stb, canc, descontos, cro, idempresa, verificado, crz) AS
SELECT codreducao, data::date, nroterminal, nroserie, modelo, cooi, coof, cooz, gtinicial, gtfinal, vendaliq, vendabruta, isentos, ntb, stb,
       canc, descontos, cro, idempresa, verificado, crz FROM reducaoz;
COMMENT ON VIEW get_reducaoz IS 'REDUCAO Z';
