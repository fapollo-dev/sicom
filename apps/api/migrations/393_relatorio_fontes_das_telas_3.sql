-- 393 — as fontes do catálogo que servem a uma TELA e divergiam da produção: a versão integral do legado em `rel_<fonte>` (o
-- mecanismo da mig 389). A view da tela (mig 202 e anteriores) fica como está — ela entrega o código cru que os filtros e selos da
-- tela usam; o legado entrega o texto decodificado e outras colunas. Conferido contra ALL_VIEWS/ALL_TAB_COLUMNS da produção (só
-- leitura, 29/09/2026): 17 views do catálogo com colunas diferentes das de hoje; aqui as 15 cujas tabelas existem no destino
-- (GET_TROCA e GET_ARECEBERBX dependem de tabelas que a carga não trazia — ITENS_TROCA_QTDE e ARECEBER_BX_SALDO).
-- No fim de cada `rel_`, com o mesmo nome, as colunas da tela que o legado não tem.
--
-- O que é do legado e fica:
--   · GET_BAIRRO: região 'O' sai CENTRO e o segundo 'C' (OESTE) nunca é alcançado — é o CASE da produção; só os não excluídos.
--   · GET_OPERADORES: uma linha por operador × empresa da RELACAO_OPERADOR_EMPRESA; tipo que não é OPE/USU/FOR sai
--     "Supervisor(a)" (nulo incluso); o login SICOM e os excluídos ficam fora.
--   · GET_PLANO_CONTAS: status nulo é ATIVA; a ordem é a do código expandido.
--   · GET_PRODUCAO: CODEMPRESA_PRODUCAO repete a empresa SOLICITANTE (o legado seleciona A.CODEMPRESA duas vezes), mas
--     EMPRESA_PRODUCAO é o nome da de produção (o JOIN usa CODEMPRESA_PRODUCAO) e o JOIN é interno nas duas empresas.
--   · GET_FAMILIAS_PROD: CODIGO_SUBGRUPO é o próprio código da família.
--   · GET_LOTE_COBRANCA: só lote com cobrador (JOIN interno); total = Σ do valor dos títulos do lote.
-- Diferenças deliberadas:
--   · as SENHAS (SENHAADMIN/SENHADESC/SENHACANCEL/SENHAGAVETA da GET_EMPRESAS, SENHA da GET_OPERADORES) existem com o nome, mas
--     saem NULAS: relatório não é lugar de senha (lição 172 — as mesmas colunas são ocultas na leitura dos cadastros).
--   · 'Usu?rio(a)' (o acento perdido quando a view foi criada — é '?' mesmo, U+003F) sai 'Usuário(a)'; 'DEVOLUÃ‡ÃƒO' (o UTF-8 lido
--     como cp1252) sai 'DEVOLUÇÃO'.

-- ─────────────────────────────────────────────── GET_AGENDA_PROMOCAO (AGENDA PROMOCAO) ─────────────────────────────────────
DROP VIEW IF EXISTS rel_get_agenda_promocao;
CREATE VIEW rel_get_agenda_promocao AS
SELECT a.codagenda                                                          AS codigo,
       a.dtiniciopromocao::date                                             AS dt_inicio_promocao,
       a.dtfimpromocao::date                                                AS dt_fim_promocao,
       a.nomepromo                                                          AS nome_promocao,
       a.flagpromocao,
       g.codagenda, g.idempresa, g.nomepromo, g.dtiniciopromocao, g.dtfimpromocao, g.status, g.dataexecucao, g.opcoes, g.obs,
       g.dtencerramento, g.codoperadorenc, g.indr, g.situacao, g.empresas, g.qtde_itens
  FROM agenda_promocao a
  LEFT JOIN get_agenda_promocao g ON g.codagenda = a.codagenda;

-- ───────────────────────────────────────────────────── GET_BAIRRO (BAIRROS) ────────────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_bairro;
CREATE VIEW rel_get_bairro AS
SELECT b.descricao,
       b.idbairro                                                           AS codigo,
       b.ativo,
       b.idcidade,
       CASE WHEN b.regiao = 'C' THEN 'CENTRO' WHEN b.regiao = 'N' THEN 'NORTE' WHEN b.regiao = 'S' THEN 'SUL'
            WHEN b.regiao = 'L' THEN 'LESTE' WHEN b.regiao = 'O' THEN 'CENTRO' WHEN b.regiao = 'NL' THEN 'NORDESTE'
            WHEN b.regiao = 'SL' THEN 'SUDESTE' WHEN b.regiao = 'NO' THEN 'NOROESTE' WHEN b.regiao = 'SO' THEN 'SUDOESTE' END AS regiao,
       b.idbairro, b.indr
  FROM bairro b
 WHERE coalesce(b.indr, 'I') <> 'E';

-- ───────────────────────────────────────────── GET_CONTAS_BANCARIAS (CONTAS BANCARIAS) ─────────────────────────────────────
DROP VIEW IF EXISTS rel_get_contas_bancarias;
CREATE VIEW rel_get_contas_bancarias AS
SELECT cb.titular,
       cb.nroconta                                                          AS nro_conta,
       b.agencia,
       b.banco,
       b.codbcoblt                                                          AS nro_banco,
       cb.gerente,
       cb.dtabertura                                                        AS data_abertura,
       cb.fone1                                                             AS telefomne,
       cb.obs,
       cb.codconta                                                          AS codigo,
       cb.codbco                                                            AS codigo_banco,
       cb.idempresa,
       cb.ativo,
       cb.codconta, cb.codbco, cb.nroconta
  FROM contas_bancarias cb
  JOIN bancos b ON b.codbco = cb.codbco;

-- ───────────────────────────────────────────────── GET_LOTE_COBRANCA (LOTE_COBRANCAS) ──────────────────────────────────────
DROP VIEW IF EXISTS rel_get_lote_cobranca;
CREATE VIEW rel_get_lote_cobranca AS
SELECT l.codlotecob                                                         AS codigo,
       l.data                                                               AS data_cobranca,
       co.razao                                                             AS cobrador,
       co.codparceiro                                                       AS cod_cobrador,
       (SELECT sum(coalesce(r.valor, 0)) FROM itens_lotecob i LEFT JOIN areceber r ON r.codrcb = i.codrcb
         WHERE i.codlotecob = l.codlotecob)                                 AS total_lote,
       g.codlotecob, g.codparceiro, g.data, g.razao, g.qtd_itens
  FROM lote_cobranca l
  JOIN parceiros co              ON co.codparceiro = l.codparceiro
  LEFT JOIN get_lote_cobranca g  ON g.codlotecob = l.codlotecob;

-- ────────────────────────────────────────────────────── GET_PERFIL (PERFIL) ────────────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_perfil;
CREATE VIEW rel_get_perfil AS
SELECT p.codperfil                                                          AS codigo,
       p.perfil,
       p.ativo,
       p.tipo,
       g.codperfil, g.indr, g.qtde_operadores
  FROM perfil p
  LEFT JOIN get_perfil g ON g.codperfil = p.codperfil
 WHERE coalesce(p.indr, 'I') = 'I';

-- ───────────────────────────────────────────────────── GET_UNIDADE (UNIDADES) ──────────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_unidade;
CREATE VIEW rel_get_unidade AS
SELECT u.codunidade                                                         AS codigo,
       u.sigla,
       u.descricao,
       u.ativo,
       u.fracionado,
       g.codunidade, g.indr, g.producao
  FROM unidade u
  LEFT JOIN get_unidade g ON g.codunidade = u.codunidade
 WHERE coalesce(u.indr, 'I') <> 'E';

-- ─────────────────────────────────────────────── GET_PLANO_CONTAS (PLANO DE CONTAS) ────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_plano_contas;
CREATE VIEW rel_get_plano_contas AS
SELECT CASE pl.tipo WHEN 'E' THEN 'EMPRESA'::varchar(15) WHEN 'R' THEN 'REFERENCIAL'::varchar(15) END AS tipo,
       pl.codplanocontas                                                    AS codigo,
       pl.codireduzido,
       pl.codiexpandido,
       pl.descricao,
       CASE coalesce(pl.status, 'A') WHEN 'A' THEN 'ATIVA'::varchar(10) WHEN 'D' THEN 'DESATIVADA'::varchar(10) END AS status,
       CASE pl.classe WHEN 'A' THEN 'ANALITICA'::varchar(10) WHEN 'T' THEN 'SINTETICA'::varchar(10) END AS classe,
       g.codplanocontas, g.descricao_completa, g.natureza, g.nivel, g.codpai
  FROM plano_contas pl
  LEFT JOIN get_plano_contas g ON g.codplanocontas = pl.codplanocontas
 ORDER BY pl.codiexpandido;

-- ──────────────────────────────────────────────────── GET_OPERADORAS (OPERADORAS) ──────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_operadoras;
CREATE VIEW rel_get_operadoras AS
SELECT o.codoperadoras                                                      AS codigo,
       p.razao                                                              AS administradora,
       o.codadm,
       o.operadora,
       o.diascomp                                                           AS dias_compensacao,
       o.txadm                                                              AS taxa_administrativa,
       o.ativo,
       g.codoperadoras, g.txadm, g.txadmparc, g.diascomp, g.tipo, g.tipocartao, g.codbandeira, g.codbanco, g.indr
  FROM operadoras o
  LEFT JOIN parceiros p       ON p.codparceiro = o.codadm
  LEFT JOIN get_operadoras g  ON g.codoperadoras = o.codoperadoras;

-- ──────────────────────────────────────────── GET_FAMILIAS_PROD (CATEGORIAS E DEPARTAMENTOS) ───────────────────────────────
DROP VIEW IF EXISTS rel_get_familias_prod;
CREATE VIEW rel_get_familias_prod AS
SELECT f.descricao                                                          AS nome,
       f.codfamilia                                                         AS codigo,
       f.codfamilia                                                         AS codigo_subgrupo,
       CASE WHEN f.tipo = 'D' THEN 'DEPARTAMENTO' WHEN f.tipo = 'G' THEN 'GRUPO' WHEN f.tipo = 'S' THEN 'SUBGRUPO'
            WHEN f.tipo = 'P' THEN 'GRUPO DE PRECO' WHEN f.tipo = 'R' THEN 'PRODUCAO' WHEN f.tipo = 'O' THEN 'SECAO'
            WHEN f.tipo = 'E' THEN 'SETOR' WHEN f.tipo = 'C' THEN 'COTACAO' END AS tipo,
       f.idempresa                                                          AS codempresa,
       f.coddpto                                                            AS codigo_dpto,
       f.codgrupo                                                           AS codigo_grupo,
       f.codsetor                                                           AS codigo_setor,
       f.ativo,
       coalesce(f.codsetor_perda_padrao, 'N')                               AS setor_perda_padrao,
       g.codfamilia, g.descricao, g.coddpto, g.codgrupo, g.codsecao, g.codsetor, g.excluido
  FROM familias_prod f
  LEFT JOIN get_familias_prod g ON g.codfamilia = f.codfamilia;

-- ─────────────────────────────────────────────── GET_FORMAS_PGTO (FORMAS DE PAGAMENTO) ─────────────────────────────────────
DROP VIEW IF EXISTS rel_get_formas_pgto;
CREATE VIEW rel_get_formas_pgto AS
SELECT fp.atalho,
       fp.modalidade,
       CASE fp.destino WHEN 'TEF' THEN 'TEF' WHEN 'CHQ' THEN 'CHEQUE' WHEN 'CXA' THEN 'CAIXA' WHEN 'RCB' THEN 'ARECEBER'
            WHEN 'CRT' THEN 'CARTAO' WHEN 'DEV' THEN 'DEVOLUÇÃO' WHEN 'QUE' THEN 'QUEBRA DE CAIXA' WHEN 'VTR' THEN 'VALE TROCO'
            WHEN 'PIX' THEN 'PIX' WHEN 'NEU' THEN 'NEUTRO' END              AS destino,
       fp.idempresa,
       fp.idpgto                                                            AS codigo,
       fp.plccofre                                                          AS plc,
       fp.codcontacorrente                                                  AS conta_corrente,
       pc.codireduzido                                                      AS conta_contabil,
       e.fantasia                                                           AS empresa_fantasia,
       coalesce(fp.inativo, 'N')                                            AS inativo,
       fp.data_inativo,
       g.idpgto, g.plccofre, g.cofre, g.codcontacorrente, g.codplanocontas, g.recebe_pdv, g.permite_sangria_pdv,
       g.lanc_movimento_individual, g.tipo
  FROM formas_pgto fp
  LEFT JOIN empresas e         ON e.idempresa = fp.idempresa
  LEFT JOIN plano_contas pc    ON pc.codplanocontas = fp.codplanocontas
  LEFT JOIN get_formas_pgto g  ON g.idpgto = fp.idpgto;

-- ──────────────────────────────────────────────── GET_INVENTARIO_LIVRO (LIVRO INVENTARIO) ──────────────────────────────────
DROP VIEW IF EXISTS rel_get_inventario_livro;
CREATE VIEW rel_get_inventario_livro AS
SELECT i.codinvent, i.idempresa, i.dtinicial, i.dtinventario, i.tipoinventario, i.modeloinventario, i.paginas, i.dtiniciolivro,
       i.dtfimlivro, i.atividadecomercial, i.atividadeprimaria, i.atividadesecundaria, i.nroabertura, i.nrofechamento, i.nrolivro,
       i.produtos_ativos                                                    AS produtosativos,
       i.apenas_estoque                                                     AS apenasestoque,
       g.descricao, g.produtos_ativos, g.apenas_estoque, g.indr, g.usucadastro, g.dtcadastro, g.usultalteracao,
       g.dtultimalteracao, g.qtde_itens
  FROM inventario_livro i
  LEFT JOIN get_inventario_livro g ON g.codinvent = i.codinvent;

-- ──────────────────────────────────────────────────── GET_OPERADORES (OPERADORES) ──────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_operadores;
CREATE VIEW rel_get_operadores AS
SELECT o.nome,
       o.login,
       NULL::varchar                                                        AS senha,
       o.codoperador                                                        AS codigo,
       r.codempresa                                                         AS codigo_empresa,
       CASE WHEN o.tipoop = 'OPE' THEN 'Operador(a)' WHEN o.tipoop = 'USU' THEN 'Usuário(a)'
            WHEN o.tipoop = 'FOR' THEN 'Fornecedor(a)' ELSE 'Supervisor(a)' END AS tipoop,
       p.codparceiro                                                        AS codigo_vendedor,
       p.razao                                                              AS vendedor,
       coalesce(o.desabilitado, 'N')                                        AS desabilitado,
       o.tipoop                                                             AS tipo_sigla,
       o.ativo,
       g.codoperador, g.idgrupo, g.grupo, g.codparceiro, g.parceiro, g.idsupervisor, g.supervisor, g.desabilita_operacoes_basicas,
       g.desabilita_desconto_pdv, g.solicitar_alteracao_senha, g.codigoauxiliar, g.indr
  FROM operadores o
  LEFT JOIN relacao_operador_empresa r ON r.codoperador = o.codoperador
  LEFT JOIN parceiros p                ON p.codparceiro = o.codparceiro
  LEFT JOIN get_operadores g           ON g.codoperador = o.codoperador
 WHERE o.login <> 'SICOM' AND coalesce(o.indr, 'I') <> 'E';

-- ─────────────────────────────────────────── GET_PEDIDO_DEVOLUCAO_COMPRA (DEVOLUCAO COMPRA) ─────────────────────────────────
-- (os JOINs de endereço e operador do legado não levam coluna nenhuma; o do endereço repete a devolução por endereço ativo)
DROP VIEW IF EXISTS rel_get_pedido_devolucao_compra;
CREATE VIEW rel_get_pedido_devolucao_compra AS
SELECT pe.codpeddevcompra                                                   AS codigo,
       pe.codparceiro,
       pe.codoperador,
       pe.idempresa                                                         AS codempresa,
       pe.codnf_emitida                                                     AS codigo_nota_fiscal_emitida,
       pe.cnpj_cpf                                                          AS cnpjcpf,
       pe.data::date                                                        AS data,
       pe.status                                                            AS status_pedido,
       p.razao,
       g.codpeddevcompra, g.idempresa, g.fornecedor, g.status, g.codnf_emitida, g.obs, g.indr, g.total, g.qtde_itens
  FROM pedido_devolucao_compra pe
  LEFT JOIN parceiros p                      ON p.codparceiro = pe.codparceiro
  LEFT JOIN parceiros_end e                  ON e.codparceiro = p.codparceiro AND coalesce(e.ativado, 'S') = 'S'
  LEFT JOIN get_pedido_devolucao_compra g    ON g.codpeddevcompra = pe.codpeddevcompra;

-- ────────────────────────────────────────────────────── GET_PRODUCAO (PRODUCAO) ────────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_producao;
CREATE VIEW rel_get_producao AS
SELECT a.codproducao                                                        AS codigo,
       a.data::date                                                         AS data,
       a.idempresa                                                          AS codempresa_solicitante,
       s.razao_social                                                       AS empresa_solicitante,
       a.idempresa                                                          AS codempresa_producao,
       p.razao_social                                                       AS empresa_producao,
       a.codoperador,
       b.nome                                                               AS operador,
       (SELECT sum(aa.qtde * aa.vrcusto) FROM itens_producao aa WHERE aa.codproducao = a.codproducao) AS totalcusto,
       (SELECT sum(aa.qtde * aa.vrvenda) FROM itens_producao aa WHERE aa.codproducao = a.codproducao) AS totalvenda,
       CASE WHEN coalesce(a.status, 'A') = 'A' THEN 'ABERTA' ELSE 'PROCESSADA' END AS status,
       g.codproducao, g.idempresa, g.codparceiro, g.codplc, g.dtprocessamento, g.status_label, g.qtde_itens, g.total_custo,
       g.total_venda, g.parceiro
  FROM producao a
  JOIN empresas s          ON s.idempresa = a.idempresa
  JOIN empresas p          ON p.idempresa = a.codempresa_producao
  LEFT JOIN operadores b   ON b.codoperador = a.codoperador
  LEFT JOIN get_producao g ON g.codproducao = a.codproducao;

-- ────────────────────────────────────────────────────── GET_EMPRESAS (EMPRESAS) ────────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_empresas;
CREATE VIEW rel_get_empresas AS
SELECT e.razao_social                                                       AS razao,
       e.fantasia,
       e.idempresa                                                          AS codigo,
       e.cnpj,
       e.insc,
       e.endereco,
       e.bairro,
       e.cidade,
       e.uf,
       e.classfiscal,
       NULL::varchar                                                        AS senhaadmin,
       NULL::varchar                                                        AS senhadesc,
       NULL::varchar                                                        AS senhacancel,
       NULL::varchar                                                        AS senhagaveta,
       e.txjuropadrao,
       e.cep,
       e.fone1,
       e.fone2,
       e.responsavel,
       e.mascaraplc,
       e.descmax                                                            AS desconto_maximo,
       e.contribuinte_icms,
       p.codparceiro,
       coalesce(p.fantasia, p.razao)                                        AS nome_parceiro,
       g.idempresa, g.razao_social, g.figurafiscal, g.serie_nfe, g.despoperacional
  FROM empresas e
  LEFT JOIN parceiros p     ON p.codparceiro = e.codparceiro
  LEFT JOIN get_empresas g  ON g.idempresa = e.idempresa;

-- ─────────────────────────────────────────────────────── GET_TROCA (TROCAS) ────────────────────────────────────────────────
-- O status do legado conta os STATUS distintos da ITENS_TROCA_QTDE (o sub-nível 1:1 do item): 2 → ABERTA, 0 (troca sem item) →
-- FECHADA, 1 → o próprio (A → ABERTA, F → FECHADA). Aqui o sub-nível não existe — é cópia 1:1 de itens_troca na produção
-- (conferir-tabelas-fora.py: EQUIVALENTE; STATUS 'F' exatamente onde FECHADO = 'S', 179 de 179; o resto nulo/'A') — então o
-- status do item é o FECHADO dele. A diferença para a view da tela é a troca SEM item: aqui FECHADA, como o legado.
DROP VIEW IF EXISTS rel_get_troca;
CREATE VIEW rel_get_troca AS
SELECT p.razao                                                              AS fornecedor,
       t.data,
       t.codtroca                                                           AS codigo,
       t.codparceiro                                                        AS codigo_parceiro,
       t.descricao,
       CASE (SELECT count(DISTINCT CASE WHEN i.fechado = 'S' THEN 'F' ELSE 'A' END) FROM itens_troca i WHERE i.codtroca = t.codtroca)
            WHEN 2 THEN 'ABERTA' WHEN 0 THEN 'FECHADA'
            ELSE CASE (SELECT DISTINCT CASE WHEN i.fechado = 'S' THEN 'F' ELSE 'A' END FROM itens_troca i WHERE i.codtroca = t.codtroca)
                      WHEN 'A' THEN 'ABERTA' ELSE 'FECHADA' END END        AS status,
       t.idempresa                                                          AS empresa,
       g.codtroca, g.idempresa, g.codparceiro, g.qtde_itens, g.valor_total
  FROM troca t
  LEFT JOIN parceiros p  ON p.codparceiro = t.codparceiro
  LEFT JOIN get_troca g  ON g.codtroca = t.codtroca;

-- ──────────────────────────────────────────────────── GET_PROMOCAO (PROMOÇÕES) ─────────────────────────────────────────────
DROP VIEW IF EXISTS rel_get_promocao;
CREATE VIEW rel_get_promocao AS
SELECT p.descricao                                                          AS promocao,
       p.datainicio                                                         AS data_inicial,
       p.datafim                                                            AS data_final,
       p.empresas,
       p.idpromocao                                                         AS codigo,
       CASE p.opcao WHEN 'V' THEN 'Rebaixa por vencimento' WHEN 'E' THEN 'Rebaixa por excesso' WHEN 'A' THEN 'Rebaixa avariada'
            WHEN 'S' THEN 'Rebaixa sem giro' WHEN 'I' THEN 'Rebaixa inativo' END AS opcao,
       CASE p.tipo WHEN 'C' THEN 'CATEGORIA' WHEN 'S' THEN 'SCANNTECH' WHEN 'O' THEN 'COMBO' END AS tipo,
       CASE p.destino WHEN 'C' THEN 'Clientes' WHEN 'F' THEN 'Funcionários' WHEN 'V' THEN 'Clube de vantagens' END AS destino,
       g.idpromocao, g.idempresa, g.descricao, g.datainicio, g.datafim, g.valorcombo, g.tipocombo, g.valor_minimo_compra, g.indr,
       g.qtde_itens, g.usucadastro, g.dtcadastro, g.usultalteracao, g.dtultimalteracao
  FROM promocao p
  LEFT JOIN get_promocao g ON g.idpromocao = p.idpromocao;

-- ──────────────────────────────────── GET_ARECEBERBX: os nomes LITERAIS das colunas da produção ────────────────────────────
-- A lista de colunas da view de lá tem "COD_DESCONTO_TITULO " (com o espaço) e "X.TXMULTA", "X.VALOR_PERC_MULTA", "X.MULTA"
-- (com o alias da tabela no nome). É o nome que o relatório do cliente grava; o construtor cita o identificador inteiro (sql.id).
-- O outro ramo do UNION (ARECEBER_BX_SALDO, "BAIXA COM SALDO") tem 0 linhas na produção e não existe aqui (uConsRCBbx.md).
ALTER VIEW get_areceberbx RENAME COLUMN cod_desconto_titulo TO "cod_desconto_titulo ";
ALTER VIEW get_areceberbx RENAME COLUMN txmulta TO "x.txmulta";
ALTER VIEW get_areceberbx RENAME COLUMN valor_perc_multa TO "x.valor_perc_multa";
ALTER VIEW get_areceberbx RENAME COLUMN multa TO "x.multa";

-- o rótulo do combo é o COMMENT sem o ';' do início: ';PEDIDO DE COMPRA;' → 'PEDIDO DE COMPRA;' (a mig 202 tirou os dois)
COMMENT ON VIEW get_pedidocompra IS 'PEDIDO DE COMPRA;';
