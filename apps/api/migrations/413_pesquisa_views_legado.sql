-- 413 — PESQUISA, corte B5 (docs/04-screen-dossier/dossiers/retaguarda/uPesquisa-corteB-views.md §2.8, §2.10, §2.12, §4): as 6
-- views da Pesquisa que não tinham a versão integral do legado no destino. Conferidas contra ALL_VIEWS/ALL_TAB_COLUMNS da produção
-- (só leitura, 07/10/2026) — nome, ordem e tipo de cada coluna; nenhuma das 6 tem COMMENT na produção (não são fontes do construtor).
--
--  · GET_PLC e GET_CFOP: a view da tela (`get_plc` mig 349, `get_cfop` mig 346) é lida pelo CRUD com outros nomes e outro recorte —
--    o legado vive ao lado em `rel_<view>` (o mecanismo da mig 389), SEM COMMENT, com as colunas do Apollo no fim (as que os campos de
--    lookup da web e o CRUD usam: codplc/desccodplc…, codcfop/tipoestado…).
--  · GET_PRECO, GET_MOTIVOS_OPERACAO, GET_HISTORICO_CONTABIL, GET_OPERACOES_CONTA: só falta UMA coluna do legado — entra NO FIM da
--    view da tela (o CREATE OR REPLACE do PG só aceita acrescentar no fim; nenhuma view depende delas).

-- ───────────────────────────────────────────────────────── GET_PLC (332 linhas) ──────────────────────────────────────────────
-- Produção: DESCRICAO, CODIGO_EXTENSO (DESCCODPLC), CODIGO (CODPLC), CODIGO_PAI, TIPO_CONTA (CASE TPCONTA 0/1/2 → RECEITA/DESPESA/
-- NEUTRA, VARCHAR2(7)), NIVEL_CONTA, PERDA (FLG_PERDA), OBRIGA_MOTIVO_PERDA; WHERE CHARACTER_LENGTH(DESCCODPLC) > 5 AND
-- COALESCE(INDR,'I') <> 'E' (o CHARACTER_LENGTH da produção é uma função do schema: `return Length(A)` — o nulo fica fora).
DROP VIEW IF EXISTS rel_get_plc;
CREATE VIEW rel_get_plc AS
SELECT p.descricao,
       p.desccodplc                                                         AS codigo_extenso,
       p.codplc                                                             AS codigo,
       p.codpai                                                             AS codigo_pai,
       (CASE p.tpconta WHEN 0 THEN 'RECEITA' WHEN 1 THEN 'DESPESA' WHEN 2 THEN 'NEUTRA' END)::varchar(7) AS tipo_conta,
       p.nivelconta                                                         AS nivel_conta,
       p.flg_perda                                                          AS perda,
       p.plc_obriga_motivo_perda                                            AS obriga_motivo_perda,
       p.codplc, p.desccodplc, p.tpconta, p.nivelconta, p.codcontabil
  FROM plc p
 WHERE char_length(p.desccodplc) > 5
   AND coalesce(p.indr, 'I') <> 'E';

-- ──────────────────────────────────────────────────────── GET_CFOP (398 linhas) ──────────────────────────────────────────────
-- Produção: CFOP (NUMBER — o CODCFOP), DESCRICAO, TIPO, ESTADO (TIPOESTADO), PRECESSA_QTDE (sic — PROC_QTDE), PROCESSA_FINANCEIRO,
-- PROCESSA_TRANSFERENCIA, PROCESSA_CUPOM, CODCONTABIL, DESCODCONTABIL (LEFT JOIN CODCONTABIL). A tabela CODCONTABIL está VAZIA na
-- produção (0 linhas) e não existe no destino: DESCODCONTABIL sai nula, como lá. O CODCFOP do destino é char(4): o número só quando
-- ele é só dígitos (o cast defensivo da rel_get_nf, mig 389).
DROP VIEW IF EXISTS rel_get_cfop;
CREATE VIEW rel_get_cfop AS
SELECT CASE WHEN btrim(b.codcfop) ~ '^\d+$' THEN btrim(b.codcfop)::numeric(10, 0) END AS cfop,
       b.descricao,
       b.tipo,
       b.tipoestado                                                         AS estado,
       b.proc_qtde                                                          AS precessa_qtde,
       b.proc_financeiro                                                    AS processa_financeiro,
       b.proc_transf                                                        AS processa_transferencia,
       b.proc_cupom                                                         AS processa_cupom,
       b.codcontabil,
       NULL::varchar(100)                                                   AS descodcontabil,
       b.codcfop, b.codcfop AS codigo, b.tipoestado, b.devolucao
  FROM cfop b;

-- ─────────────────────────────────────────── as 4 que só precisam de UMA coluna do legado (no fim) ─────────────────────────────
-- GET_PRECO: CODIGO = ID_PRECO (o WHERE INDR = 'I' do legado continua pelo INDR que a view expõe — a Pesquisa filtra)
CREATE OR REPLACE VIEW get_preco AS
SELECT id_preco, descricao, valor_reajuste, reajuste, ativo, indr,
       id_preco AS codigo
  FROM preco;

-- GET_MOTIVOS_OPERACAO: PERDA_PADRAO = COALESCE(MOTIVO_OPERACAO_PERDA_PADRAO, 'N') (1 'S' na produção)
CREATE OR REPLACE VIEW get_motivos_operacao AS
  SELECT codmotivoop, codmotivoop AS codigo, descricao, tipo_operacao, indr,
         coalesce(motivo_operacao_perda_padrao, 'N') AS perda_padrao
    FROM motivos_operacao;

-- GET_HISTORICO_CONTABIL: DESC_HISTORICO = DESCHIST (o retorno 2 dos lookups do legado — UCadSituacaoNF.pas:284)
CREATE OR REPLACE VIEW get_historico_contabil AS
  SELECT h.codhistcontabil AS codigo,
         h.codhistcontabil,
         h.deschist,
         h.status,
         -- quantos buracos o template tem: é o que diz quantos argumentos a contabilização precisa passar,
         -- e o que separa um rótulo fixo (0) de um template (1 ou mais)
         (length(coalesce(h.deschist, '')) - length(replace(coalesce(h.deschist, ''), '*', '')))::int AS coringas,
         h.dtultimalteracao,
         h.dtcadastro,
         h.deschist AS desc_historico
    FROM historico_contabil h;

-- GET_OPERACOES_CONTA: CODIGO = CODOPCONTA (o retorno padrão do cadastro — uCadMaster.pas:1063-1064)
CREATE OR REPLACE VIEW get_operacoes_conta AS
SELECT descricao, codopconta,
       CASE tipo WHEN 'C' THEN 'CREDITO' ELSE 'DEBITO' END AS tipo,
       codopconta AS codigo
FROM operacoes_conta;
