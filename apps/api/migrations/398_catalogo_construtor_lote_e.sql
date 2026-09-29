-- 398 — o CATÁLOGO do construtor, lote E: 6 fontes cuja SQL cita tabela que não existe aqui, mas cujo dado existe (retrato de
-- 29/09/2026, §283).
--   · GET_TROCA_ITENS: o sub-nível ITENS_TROCA_QTDE é cópia 1:1 de itens_troca (conferir-tabelas-fora.py, EQUIVALENTE: quantidade
--     309/309, STATUS 'F' exatamente onde FECHADO = 'S'); a empresa do item é a que a carga traz do sub-nível (mig 393).
--   · GET_NF_OBS: CODCONTABIL (0 linhas) e PAIS (EQUIVALENTE) só entram por LEFT JOIN sem coluna usada — como CFOP, SITUACAO_NF e
--     NF_STATUS_PROCESSO, que também não levam coluna: saem daqui sem mudar linha (todos por chave única).
--   · GET_PARCEIROS_IZIO: a UF do legado é a tabela IBGE (EQUIVALENTE: packages/shared/src/ufs.ts) — aqui como lista literal.
--   · GET_PARCEIROS_COBRANCA / GET_PARCEIROSEND: nenhuma tabela ausente (o verificador leu um alias).
--   · GET_DEVOLUCAO_VENDAS: a NFC-e da devolução vinha da NFC (PDV, fora); o vínculo que a subconsulta procura (pedido + loja + série +
--     dia, com a nota autorizada) é o que a carga já deriva em vendas.codnfc/statusnfe (mig 299). O código da venda é o do legado
--     (codvendas_legado — mig 392), que é o que DEVOLUCAO_VENDAS e NF_CUPONS_REFERENCIA guardam.
--
-- O que é do legado e fica: GET_PARCEIROS_IZIO só pessoa física cliente ativa com CPF de 11 dígitos no endereço padrão ativo, e
-- "FEMINONO" (grafia da produção); GET_PARCEIROSEND uma linha por endereço (ativo ou não).
--
-- Ficam de fora, com prova (contagem na produção, só leitura, 29/09/2026): as views sobre tabelas VAZIAS (mapa de carga/entrega,
-- ordens de serviço, agendas de atendimento e orçamento, PIX, comandas, cortesias, etapas, regiões, pesquisa, publicidade, limite de
-- compra, estoque local, faturamento por tipo, troca por planilha, vendas anteriores, cheques devolvidos/reapresentados…) ou MORTAS
-- (abastecimento/veículos, ambiente de contingência, benefício fiscal, consulta de preço, devolução antiga, doca, lote de validade,
-- mensagens NF, NF-e antiga, saída para depósito); as do PDV (NFC, contatos, mídia, terminais, motivos de cancelamento); a do SPED de
-- PIS/COFINS sobre a tabela de trabalho NFAUXSPED (o SPED do Apollo não usa tabela de trabalho); e a GET_HISTORICO_KARDEX, que é
-- INVÁLIDA na produção (WM_CONCAT, removida do Oracle — colunas UNDEFINED).

-- ───────────────────────────────────────────────────── GET_TROCA_ITENS (TROCA ITENS) ───────────────────────────────────────
CREATE OR REPLACE VIEW get_troca_itens (idproduto, codbarra, descricao, quantidade, vrvenda, vrcusto, vrcustorep, data, status, codtroca, troca,
                                        codparceiro, razao, codempresa) AS
SELECT p.idproduto, p.codbarra, p.descricao, i.qtde, mp.vrvenda, mp.vrcusto, mp.vrcustorep, t.data::date,
       CASE WHEN i.fechado = 'S' THEN 'FECHADA' ELSE 'ABERTA' END, t.codtroca, t.descricao, pa.codparceiro, pa.razao, i.idempresa
  FROM itens_troca i
  JOIN produtos p      ON p.idproduto = i.idproduto
  JOIN multi_preco mp  ON mp.idproduto = i.idproduto AND mp.idempresa = i.idempresa
  JOIN troca t         ON t.codtroca = i.codtroca
  JOIN parceiros pa    ON pa.codparceiro = t.codparceiro;
COMMENT ON VIEW get_troca_itens IS 'TROCA ITENS';

-- ─────────────────────────────────────────────────────────── GET_NF_OBS ────────────────────────────────────────────────────
CREATE OR REPLACE VIEW get_nf_obs (codnf, titular_razao, titular_logradouro, titular_bairro, titular_cidade, titular_uf, titular_cep, titular_cnpj,
                                   titular_rg_insc, titular_fone, transportadora_razao, transp_cod_end, transp_logradouro, transp_bairro, transp_cidade,
                                   transp_uf, transp_cep, transp_cnpj, transp_rg_insc, transp_fone, desc_vendedor, titular_fantasia, chave_ref,
                                   nro_complementar, codoperador, nome_operador, fpgto) AS
SELECT n.codnf, (SELECT p.razao FROM parceiros p WHERE p.codparceiro = n.codparceiro), e.endereco, e.bairro, e.cidade, e.uf, e.cep, e.cnpj_cpf,
       e.rg_insc, e.telefone, t.razao, f.codend, f.endereco, f.bairro, f.cidade, f.uf, f.cep, f.cnpj_cpf, f.rg_insc, f.telefone, v.razao,
       (SELECT p.fantasia FROM parceiros p WHERE p.codparceiro = n.codparceiro), nc.chavenfe, nc.nronf, op.codoperador, op.nome,
       (SELECT xa.modalidade FROM formas_pgto xa JOIN nf_forma_pagamento xb ON xb.idpgto = xa.idpgto WHERE xb.codnf = n.codnf LIMIT 1)
  FROM nf n
  LEFT JOIN parceiros_end e   ON e.codend = n.codparceiro_end
  LEFT JOIN parceiros t       ON t.codparceiro = n.codtransp
  LEFT JOIN parceiros_end f   ON f.codend = n.codtransp_end
  LEFT JOIN parceiros v       ON v.codparceiro = n.codvendedor
  LEFT JOIN nf nc             ON nc.codnf = n.codnf_ref
  LEFT JOIN operadores op     ON op.codoperador = n.usultalteracao;
COMMENT ON VIEW get_nf_obs IS 'GET_NF_OBS';

-- ──────────────────────────────────────────────────── GET_PARCEIROS_IZIO (PARCEIROS IZIO) ──────────────────────────────────
CREATE OR REPLACE VIEW get_parceiros_izio (codigo, dados_completo, dados_simplificado, razao, cpf, celular, telefone, data_nascimento, cep, endereco,
                                           numero, bairro, cidade, uf, sexo, ativado, campanha_izio, codigo_izio) AS
WITH uf (iduf, sigla) AS (
  VALUES (11, 'RO'), (12, 'AC'), (13, 'AM'), (14, 'RR'), (15, 'PA'), (16, 'AP'), (17, 'TO'), (21, 'MA'), (22, 'PI'), (23, 'CE'), (24, 'RN'),
         (25, 'PB'), (26, 'PE'), (27, 'AL'), (28, 'SE'), (29, 'BA'), (31, 'MG'), (32, 'ES'), (33, 'RJ'), (35, 'SP'), (41, 'PR'), (42, 'SC'),
         (43, 'RS'), (50, 'MS'), (51, 'MT'), (52, 'GO'), (53, 'DF')
)
SELECT p.codparceiro,
       CASE WHEN length(replace(replace(replace(coalesce(nullif(trim(e.cep), ''), '0'), '.', ''), '-', ''), ' ', '')) <> 8
              OR coalesce(CASE WHEN c.idcidade IS NOT NULL THEN c.idcidade ELSE d.idcidade END, 0) = 0
              OR p.dtnascimento IS NULL
              OR e.celular IS NULL OR coalesce(nullif(trim(e.celular), ''), '0') = '0'
              OR NOT length(trim(translate(e.celular, '()- ', ' '))) BETWEEN 8 AND 11
              OR length(replace(replace(replace(replace(e.cnpj_cpf, '.', ''), '/', ''), '-', ''), ' ', '')) <> 11
              OR length(coalesce(nullif(trim(p.razao), ''), '0')) < 2
              OR length(coalesce(nullif(trim(e.endereco), ''), '0')) < 2
              OR coalesce(nullif(trim(p.sexo), ''), '*') = '*'
              OR coalesce(nullif(trim(u.sigla), ''), '*') = '*'
              OR length(coalesce(nullif(trim(e.bairro), ''), '0')) < 2
            THEN 'NAO' ELSE 'SIM' END,
       CASE WHEN length(replace(replace(replace(coalesce(nullif(trim(e.cep), ''), '0'), '.', ''), '-', ''), ' ', '')) <> 8
              OR e.celular IS NULL OR coalesce(nullif(trim(e.celular), ''), '0') = '0'
              OR NOT length(trim(translate(e.celular, '()- ', ' '))) BETWEEN 8 AND 11
              OR length(replace(replace(replace(replace(e.cnpj_cpf, '.', ''), '/', ''), '-', ''), ' ', '')) <> 11
            THEN 'NAO' ELSE 'SIM' END,
       p.razao, e.cnpj_cpf, e.celular, e.telefone, p.dtnascimento, e.cep, e.endereco, e.numero, e.bairro,
       CASE WHEN c.idcidade IS NOT NULL THEN c.cidade ELSE d.cidade END, u.sigla,
       CASE WHEN p.sexo = 'F' THEN 'FEMINONO' WHEN p.sexo = 'M' THEN 'MASCULINO' END, p.ativado, coalesce(p.campanha_izio, 'N'), p.cod_izio
  FROM parceiros p
  JOIN parceiros_end e   ON e.codparceiro = p.codparceiro
  LEFT JOIN cidades c    ON c.idcidade = e.idcidade
  LEFT JOIN cidades d    ON d.cidade = e.cidade AND e.idcidade IS NULL
  LEFT JOIN uf u         ON u.iduf = CASE WHEN c.idcidade IS NOT NULL THEN c.iduf ELSE d.iduf END
 WHERE p.ativado = 'S' AND p.tipofj = 'F' AND p.cli = 'S' AND e.ativado = 'S' AND e.codend = p.codend
   AND length(replace(replace(replace(replace(e.cnpj_cpf, '.', ''), '/', ''), '-', ''), ' ', '')) = 11;
COMMENT ON VIEW get_parceiros_izio IS 'PARCEIROS IZIO';

-- ───────────────────────────────────────────── GET_PARCEIROS_COBRANCA (PARCEIRO COBRANCA) ──────────────────────────────────
CREATE OR REPLACE VIEW get_parceiros_cobranca (razao, fantasia, endereco, bairro, cidade, uf, telefone, celular, fax, cnpj_cpf, rg_insc, codigo, tipo_pessoa,
                                               data_cadastro, data_nascimento, email, credito, obs, bloqueado, comissao, previsao_vencimento,
                                               desconto_padrao, tolerancia, txjuro, cod_referencia, data_ultima_compra, idempresa, imprimir_ecf,
                                               ultima_alteracao, dias_prazo, estado_civil, cargo, cod_convenio, convenio, cli, frn, fun, tra, con, cep,
                                               codend, mes_aniversario, dia_aniversario, aniversario) AS
SELECT p.razao, p.fantasia, pe.endereco, pe.bairro, pe.cidade, pe.uf, pe.telefone, pe.celular, pe.fax, pe.cnpj_cpf, pe.rg_insc, p.codparceiro,
       CASE WHEN p.tipofj = 'F' THEN 'FISICA' WHEN p.tipofj = 'R' THEN 'RURAL' WHEN p.tipofj = 'G' THEN 'GOVERNAMENTAL' WHEN p.tipofj = 'J' THEN 'JURIDICA' END,
       p.dtcadastro, p.dtnascimento, p.email, p.credito, p.obs, p.bloqued, p.comissao, p.venc_prev, p.descpadrao, p.tolerancia, p.txjuro, p.codref,
       p.dtultcompra, p.idempresa, p.printecf, p.ultima_alter, p.diasprazo, CASE p.estado_civil WHEN 'S' THEN 'SOLTEIRO' ELSE 'CASADO' END, p.cargo,
       p.codconvenio, g.razao, p.cli, p.frn, p.fun, p.tra, p.con, pe.cep, pe.codend,
       extract(month FROM p.dtnascimento)::integer, extract(day FROM p.dtnascimento)::integer,
       concat(lpad(extract(day FROM p.dtnascimento)::integer::text, 2, '0'), '/', lpad(extract(month FROM p.dtnascimento)::integer::text, 2, '0'))::varchar(5)
  FROM parceiros p
  LEFT JOIN parceiros_end pe ON pe.codend = p.codend
  LEFT JOIN parceiros g      ON g.codparceiro = p.codconvenio;
COMMENT ON VIEW get_parceiros_cobranca IS 'PARCEIRO COBRANCA';

-- ───────────────────────────────────────────────── GET_PARCEIROSEND (ENDERECOS DO PARCEIRO) ────────────────────────────────
CREATE OR REPLACE VIEW get_parceirosend (razao, fantasia, endereco, bairro, cidade, uf, telefone, celular, fax, cnpj_cpf, rg_insc, codigo, tipo_pessoa,
                                         data_cadastro, data_nascimento, email, credito, obs, bloqueado, comissao, previsao_vencimento, desconto_padrao,
                                         tolerancia, txjuro, cod_referencia, data_ultima_compra, idempresa, imprimir_ecf, ultima_alteracao, dias_prazo,
                                         estado_civil, cargo, cod_convenio, convenio, cli, frn, fun, tra, con, cep, codend, mes_aniversario,
                                         dia_aniversario, aniversario, vencimentos, endereco_padrao, ativado) AS
SELECT p.razao, p.fantasia, pe.endereco, pe.bairro, pe.cidade, pe.uf, pe.telefone, pe.celular, pe.fax, pe.cnpj_cpf, pe.rg_insc, p.codparceiro,
       CASE WHEN p.tipofj = 'F' THEN 'FISICA' WHEN p.tipofj = 'R' THEN 'RURAL' WHEN p.tipofj = 'G' THEN 'GOVERNAMENTAL' WHEN p.tipofj = 'J' THEN 'JURIDICA' END,
       p.dtcadastro, p.dtnascimento, p.email, p.credito, p.obs, p.bloqued, p.comissao, p.venc_prev, p.descpadrao, p.tolerancia, p.txjuro, p.codref,
       p.dtultcompra, p.idempresa, p.printecf, p.ultima_alter, p.diasprazo, CASE p.estado_civil WHEN 'S' THEN 'SOLTEIRO' ELSE 'CASADO' END, p.cargo,
       p.codconvenio, g.razao, p.cli, p.frn, p.fun, p.tra, p.con, pe.cep, pe.codend,
       extract(month FROM p.dtnascimento)::numeric(10), extract(day FROM p.dtnascimento)::numeric(10),
       concat(lpad(extract(day FROM p.dtnascimento)::integer::text, 2, '0'), '/', lpad(extract(month FROM p.dtnascimento)::integer::text, 2, '0'))::varchar(5),
       p.vencimentos, pe.endereco_padrao, pe.ativado
  FROM parceiros p
  LEFT JOIN parceiros_end pe ON pe.codparceiro = p.codparceiro
  LEFT JOIN parceiros g      ON g.codparceiro = p.codconvenio;
COMMENT ON VIEW get_parceirosend IS 'ENDERECOS DO PARCEIRO';

-- ─────────────────────────────────────────────── GET_DEVOLUCAO_VENDAS (DEVOLUCAO VENDAS) ───────────────────────────────────
CREATE OR REPLACE VIEW get_devolucao_vendas (codigo, nropedido, nrocupom, produto, cliente, vendedor, dtvenda, devolucao, codparceiro, idempresa, importado,
                                             codproduto, data_devolucao, codigo_nf, nfe_enviada, qtde_vendida, total_venda_item, qtde_devolvida,
                                             total_devolvido_item, venda_nfc) AS
SELECT v.cupom, v.nropedido, v.nrocupom, pr.descricao, p.razao, ve.razao, v.dtvenda::date, v.devolucao, v.codparceiro, v.idempresa,
       coalesce(v.importado_devolucao, 'N'), v.codproduto, a.datadevolucao::date, coalesce(v.codnfdevolucao, 0)::varchar(15),
       CASE WHEN nf.statusnfe IS NOT NULL AND nf.statusnfe = 'P' AND nf.statusnfe <> 'T' AND nf.chavenfe IS NOT NULL THEN 'S' ELSE 'N' END,
       sum(v.qtde),
       sum(CASE WHEN v.iat = 'A' THEN (v.qtde * v.vrvenda)::numeric(18,2) ELSE trunc(v.qtde * v.vrvenda * 100)::numeric(18,2) / 100 END),
       sum(v.qtde_devolvido), sum(v.total_item_devolvido), v.venda_nfc
  FROM (SELECT v.*, coalesce(v.codvendas_legado, v.codvendas) AS cupom,
               CASE WHEN coalesce(v.importado_devolucao, 'N') = 'S' AND coalesce(v.venda_nfc, 'N') = 'N'
                      THEN (SELECT max(ncr.codnf) FROM nf_cupons_referencia ncr JOIN nf ON nf.codnf = ncr.codnf AND coalesce(nf.cancelada, 'N') = 'N'
                             WHERE ncr.codvendas = coalesce(v.codvendas_legado, v.codvendas) AND ncr.nropedido = v.nropedido AND ncr.nrocupom = v.nrocupom
                               AND ncr.nroecf = CASE WHEN substr(v.nropedido, 1, 2) ~ '^\d+$' THEN substr(v.nropedido, 1, 2)::numeric(10) END
                               AND ncr.finalidade = 'D' AND ncr.venda_nfc = 'N' AND ncr.dtvenda::date = v.dtvenda::date)
                    WHEN coalesce(v.importado_devolucao, 'N') = 'S' AND coalesce(v.venda_nfc, 'N') = 'S'
                      THEN (SELECT max(r.codnf) FROM nf_referencia r
                             WHERE r.codnf_ref = CASE WHEN v.statusnfe = 'P' THEN v.codnfc END AND r.modelo = 65)
               END AS codnfdevolucao
          FROM vendas v) v
  LEFT JOIN devolucao_vendas a  ON a.codvendas = v.cupom AND a.codproduto = v.codproduto AND a.nroitem = v.nroitem
  LEFT JOIN parceiros p         ON p.codparceiro = v.codparceiro
  LEFT JOIN parceiros ve        ON ve.codparceiro = v.codvendedor
  LEFT JOIN produtos pr         ON pr.idproduto = v.codproduto
  LEFT JOIN nf                  ON nf.codnf = v.codnfdevolucao
 WHERE v.devolucao = 'D'
 GROUP BY v.cupom, v.nropedido, v.nrocupom, pr.descricao, p.razao, ve.razao, v.dtvenda::date, v.devolucao, v.codparceiro, v.idempresa,
          v.importado_devolucao, v.codproduto, a.datadevolucao::date, nf.statusnfe, nf.chavenfe, v.codnfdevolucao, v.venda_nfc
 ORDER BY v.cupom;
COMMENT ON VIEW get_devolucao_vendas IS 'DEVOLUCAO VENDAS';
