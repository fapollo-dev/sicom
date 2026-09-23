-- 294 — OS ITENS DO HISTÓRICO CONTÁBIL: qual campo preenche cada `*` do texto do razão, na ordem.
-- `ITENS_HISTORICO_CONTABIL` (144 linhas, os 54 históricos), a grade de detalhe do cadastro
-- (`uCadHistoricoContabil.dfm:359`, `udmCadHistoricoContabil.dfm:214`). Achada no inventário completo de
-- tabelas com dado fora do plano (23/09/2026). Contagens no Oracle de produção (só leitura).
--
-- ── É A REGRA, E O RAZÃO PROVA ───────────────────────────────────────────────────────────────────────
-- A migration 229 trouxe os TEMPLATES (`NOTA FISCAL COMPRA .: * CNPJ * FORNECEDOR *`) e reconstruiu do dado
-- quem preenche cada `*`, porque `FuncoesApollo` não veio no fonte. Os itens são essa lista, cadastrada:
-- histórico, ORDEM, TABELA, CAMPO. E não são documentação — o texto gravado segue os itens mesmo quando
-- eles contradizem o rótulo do template:
--
--   62 · `CREDITO ICMS NFISCAL COMPRA .: * CNPJ.: * PARCEIRO.:*`   itens: NRO_NF, CFOP, CNPJ_CPF, PARCEIRO
--        razão: 'CREDITO ICMS NFISCAL COMPRA .: 007922433 CNPJ.: 1403 PARCEIRO.:23.814.940/0010-00'
--        → o CFOP cai no rótulo "CNPJ" e o CNPJ no rótulo "PARCEIRO": a ordem é a dos itens.
--   66 · `DEBITO ICMS NFISCAL PERDA .: * CFOP .: *LOJA .: *`       itens: CFOP, IDEMPRESA, NRO_NF
--        razão: 'DEBITO ICMS NFISCAL PERDA .: 5927 CFOP .: 001LOJA .: 000004412'
--
-- Montando o texto pelos itens, as NOTAS batem em **32.731 de 32.894** linhas do razão desde 2025 (99,5%),
-- nos 17 históricos de nota; as 163 restantes são parceiro renomeado depois do lançamento (o razão guarda o
-- nome da época) e uma linha corrompida do próprio legado.
--
-- ── A LACUNA QUE ISSO FECHA ──────────────────────────────────────────────────────────────────────────
-- A contabilização da NF (`nf-contabilizacao.service.ts`) gravava `diario.codhist` e deixava
-- `diario.deschist` NULO — o mesmo defeito que a 229 corrigiu no motor da integração contábil, mas que ficou
-- no caminho da nota. No cliente são **14.322 linhas de razão de nota só em 2026, todas com texto**.
--
-- Formatos, medidos no razão: número da nota com 9 dígitos (`000004413`), loja com 3 (`LOJA .: 001`), CFOP
-- cru (`5927`), CNPJ como está gravado no endereço (`23.814.940/0010-00`).
--
-- ── O mapa medido continua valendo ───────────────────────────────────────────────────────────────────
-- Onde `historico-contabil.args.ts` já tem o histórico (medido contra o razão), ele vence: no 89 os itens
-- dizem `ARECEBER.OBS` e o razão mostra a descrição do centro de custo em 5.895 de 5.895 linhas — o nome do
-- campo é o do dataset interno do legado, não o da coluna. Os itens entram onde o mapa não tem entrada.
--
-- Sem FK para `historico_contabil`: o Oracle não tem (só NOT NULL), e o cadastro do legado apaga o
-- histórico sem apagar os itens.

CREATE SEQUENCE IF NOT EXISTS seq_itens_historico_contabil START 1000;
CREATE TABLE IF NOT EXISTS itens_historico_contabil (
  coditemhistcontabil integer PRIMARY KEY DEFAULT nextval('seq_itens_historico_contabil'),
  codhistcontabil     integer NOT NULL,
  -- ⚠️ a ORDEM decide qual `*` o campo preenche — não o rótulo do template
  ordem               integer,
  posicao             integer,
  -- o nome do DATASET do legado ('MOVIMENTO DE CAIXA', 'ADIANTAMENTO PARA PARCEIROS'), não o da tabela física
  tabela              varchar(200),
  campo               varchar(200),
  tipo_dados          varchar(20),
  status              char(1) NOT NULL DEFAULT 'S',
  deschist            varchar(200),
  usultalteracao      integer,
  dtultimalteracao    timestamptz,
  dtcadastro          timestamptz DEFAULT now(),
  CONSTRAINT ck_itens_hist_contabil_status CHECK (status IN ('S', 'N'))
);
ALTER SEQUENCE seq_itens_historico_contabil OWNED BY itens_historico_contabil.coditemhistcontabil;
CREATE INDEX IF NOT EXISTS ix_itens_hist_contabil ON itens_historico_contabil (codhistcontabil, ordem);

-- a cópia fiel dos 144 itens da produção, para o Apollo escrever o razão antes da primeira carga (mesmo
-- motivo do seed dos templates na 229)
INSERT INTO itens_historico_contabil (coditemhistcontabil, codhistcontabil, ordem, posicao, campo, tabela, tipo_dados, status) VALUES
  (1,1,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (2,1,2,NULL,'CNPJ_CPF','NF','VARCHAR','S'),
  (3,1,3,NULL,'PARCEIRO','NF','VARCHAR','S'),
  (4,21,1,NULL,'CODIGO','APAGAR','NUMERIC','S'),
  (5,21,2,NULL,'CNPJ_CPF','NF','VARCHAR','S'),
  (6,21,3,NULL,'FORNECEDOR','APAGAR','VARCHAR','S'),
  (7,21,4,NULL,'TIPO_DOCUMENTO','APAGAR','VARCHAR','S'),
  (21,41,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (22,41,2,NULL,'PARCEIRO','NF','VARCHAR','S'),
  (23,41,3,NULL,'CFOP','NF','NUMERIC','S'),
  (41,61,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (42,61,2,NULL,'CFOP','NF','NUMERIC','S'),
  (43,61,3,NULL,'CNPJ_CPF','NF','VARCHAR','S'),
  (44,61,4,NULL,'PARCEIRO','NF','VARCHAR','S'),
  (45,62,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (46,62,2,NULL,'CFOP','NF','NUMERIC','S'),
  (47,62,3,NULL,'CNPJ_CPF','NF','VARCHAR','S'),
  (48,62,4,NULL,'PARCEIRO','NF','VARCHAR','S'),
  (49,63,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (52,63,2,NULL,'IDEMPRESA','NF','NUMERIC','S'),
  (53,63,3,NULL,'CFOP','NF','NUMERIC','S'),
  (54,63,4,NULL,'CNPJ_CPF','NF','VARCHAR','S'),
  (55,63,5,NULL,'PARCEIRO','NF','VARCHAR','S'),
  (56,64,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (57,64,2,NULL,'CFOP','NF','NUMERIC','S'),
  (58,64,3,NULL,'IDEMPRESA','NF','NUMERIC','S'),
  (59,65,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (61,65,2,NULL,'CNPJ_CPF','NF','VARCHAR','S'),
  (62,65,3,NULL,'PARCEIRO','NF','VARCHAR','S'),
  (63,66,1,NULL,'CFOP','NF','NUMERIC','S'),
  (64,66,2,NULL,'IDEMPRESA','NF','NUMERIC','S'),
  (65,66,3,NULL,'NRO_NF','NF','NUMERIC','S'),
  (66,67,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (67,67,2,NULL,'CFOP','NF','NUMERIC','S'),
  (68,67,3,NULL,'IDEMPRESA','NF','NUMERIC','S'),
  (69,68,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (70,68,2,NULL,'CFOP','NF','NUMERIC','S'),
  (71,69,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (72,69,2,NULL,'CNPJ_CPF','NF','VARCHAR','S'),
  (73,69,3,NULL,'PARCEIRO','NF','VARCHAR','S'),
  (74,70,1,NULL,'CFOP','NF','NUMERIC','S'),
  (75,70,2,NULL,'NRO_NF','NF','NUMERIC','S'),
  (76,71,1,NULL,'CODIGO','MOVIMENTO DE CAIXA','NUMERIC','S'),
  (77,71,2,NULL,'LOTE','MOVIMENTO DE CAIXA','NUMERIC','S'),
  (78,71,3,NULL,'PARCEIRO','MOVIMENTO DE CAIXA','VARCHAR','S'),
  (79,71,4,NULL,'CENTRO_DE_CUSTO','MOVIMENTO DE CAIXA','VARCHAR','S'),
  (80,71,5,NULL,'OBS','MOVIMENTO DE CAIXA','VARCHAR','S'),
  (81,81,1,NULL,'NRO_SERIE','PDV','VARCHAR','S'),
  (82,81,2,NULL,'DESCRICAO','PDV','VARCHAR','S'),
  (83,82,1,NULL,'NRO_SERIE','PDV','VARCHAR','S'),
  (84,82,2,NULL,'DESCRICAO','PDV','VARCHAR','S'),
  (85,83,1,NULL,'NROPDV','VENDAS','NUMERIC','S'),
  (86,83,2,NULL,'NOME','VENDAS','VARCHAR','S'),
  (87,83,3,NULL,'TIPORECURSO','VENDAS','VARCHAR','S'),
  (88,84,1,NULL,'NROPDV','VENDAS_SOBRAS','NUMERIC','S'),
  (89,84,2,NULL,'NOME','VENDAS_SOBRAS','VARCHAR','S'),
  (90,85,1,NULL,'NROPDV','VENDAS_SOBRAS','NUMERIC','S'),
  (91,85,2,NULL,'NOME','VENDAS_SOBRAS','VARCHAR','S'),
  (92,86,1,NULL,'TITULAR','MOV_CONTAS_BANCARIAS','VARCHAR','S'),
  (93,86,2,NULL,'HISTORICO','MOV_CONTAS_BANCARIAS','VARCHAR','S'),
  (94,86,3,NULL,'IDLOTE','MOV_CONTAS_BANCARIAS','VARCHAR','S'),
  (95,87,1,NULL,'CODPARCEIRO','ADIANTAMENTO PARA PARCEIROS','NUMERIC','S'),
  (96,87,2,NULL,'PARCEIRO','ADIANTAMENTO PARA PARCEIROS','VARCHAR','S'),
  (97,87,3,NULL,'CODIGO','ADIANTAMENTO PARA PARCEIROS','NUMERIC','S'),
  (98,88,1,NULL,'PARCEIRO','MOVIMENTO DE CAIXA','VARCHAR','S'),
  (99,88,2,NULL,'CODIGO','MOVIMENTO DE CAIXA','NUMERIC','S'),
  (100,88,3,NULL,'LOTE','MOVIMENTO DE CAIXA','NUMERIC','S'),
  (101,88,4,NULL,'CENTRO_DE_CUSTO','MOVIMENTO DE CAIXA','VARCHAR','S'),
  (102,89,1,NULL,'CODIGO','ARECEBER','NUMERIC','S'),
  (103,89,2,NULL,'OBS','ARECEBER','VARCHAR','S'),
  (104,89,3,NULL,'CLIENTE','ARECEBER','VARCHAR','S'),
  (105,90,1,NULL,'LOTE','APAGAR_BX','NUMERIC','S'),
  (106,90,2,NULL,'NR_NF','APAGAR_BX','VARCHAR','S'),
  (107,90,3,NULL,'FORNECEDOR','APAGAR_BX','VARCHAR','S'),
  (108,91,1,NULL,'LOTE','APAGAR_BX','NUMERIC','S'),
  (109,91,2,NULL,'TIPO_DOCUMENTO','APAGAR_BX','VARCHAR','S'),
  (110,91,3,NULL,'CODIGO_DOCUMENTO','APAGAR_BX','NUMERIC','S'),
  (111,91,4,NULL,'NR_NF','APAGAR_BX','VARCHAR','S'),
  (112,91,5,NULL,'FORNECEDOR','APAGAR_BX','VARCHAR','S'),
  (113,92,1,NULL,'HISTORICO','MOV_CONTAS_BANCARIAS','VARCHAR','S'),
  (116,93,1,NULL,'LOTE','ARECEBER_BX','NUMERIC','S'),
  (117,93,2,NULL,'CLIENTE','ARECEBER_BX','VARCHAR','S'),
  (118,93,3,NULL,'OPERADOR_BAIXA','ARECEBER_BX','VARCHAR','S'),
  (119,94,1,NULL,'LOTE','CARTAO_BX','NUMERIC','S'),
  (120,95,1,NULL,'LOTE','CARTAO_BX','NUMERIC','S'),
  (121,95,2,NULL,'OPERADORA','CARTAO_BX','VARCHAR','S'),
  (122,96,1,NULL,'LOTE','CARTAO_BX','NUMERIC','S'),
  (123,96,2,NULL,'OPERADORA','CARTAO_BX','VARCHAR','S'),
  (124,97,1,NULL,'HISTORICO','MOV_CONTAS_BANCARIAS','VARCHAR','S'),
  (125,98,1,NULL,'NRO_SERIE','PDV','VARCHAR','S'),
  (126,98,2,NULL,'MODELO','PDV','VARCHAR','S'),
  (127,99,1,NULL,'NRO_SERIE','PDV','VARCHAR','S'),
  (128,99,2,NULL,'MODELO','PDV','VARCHAR','S'),
  (129,100,1,NULL,'MODELO','PDV','VARCHAR','S'),
  (130,100,2,NULL,'NRO_SERIE','PDV','VARCHAR','S'),
  (141,101,1,NULL,'FORNECEDOR','APAGAR','VARCHAR','S'),
  (142,101,2,NULL,'CODIGO','APAGAR','NUMERIC','S'),
  (143,102,1,NULL,'FORNECEDOR','APAGAR','VARCHAR','S'),
  (144,102,2,NULL,'CODIGO','APAGAR','NUMERIC','S'),
  (145,103,1,NULL,'CODIGO','APAGAR','NUMERIC','S'),
  (146,103,2,NULL,'FORNECEDOR','APAGAR','VARCHAR','S'),
  (147,103,3,NULL,'OBSERVACAO','APAGAR','VARCHAR','S'),
  (148,104,1,NULL,'CODIGO','ARECEBER','NUMERIC','S'),
  (149,105,1,NULL,'CODIGO','ARECEBER','NUMERIC','S'),
  (150,105,2,NULL,'CLIENTE','ARECEBER','VARCHAR','S'),
  (151,106,1,NULL,'CODIGO_DOCUMENTO','APAGAR_BX','NUMERIC','S'),
  (152,106,2,NULL,'FORNECEDOR','APAGAR_BX','VARCHAR','S'),
  (153,106,3,NULL,'OBSERVACAO','APAGAR_BX','VARCHAR','S'),
  (154,107,1,NULL,'CODIGO_DOCUMENTO','APAGAR_BX','NUMERIC','S'),
  (155,107,2,NULL,'FORNECEDOR','APAGAR_BX','VARCHAR','S'),
  (156,107,3,NULL,'HISTORICO','APAGAR_BX','VARCHAR','S'),
  (157,108,1,NULL,'PARCEIRO','NF','VARCHAR','S'),
  (158,108,2,NULL,'NRO_NF','NF','NUMERIC','S'),
  (159,109,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (160,109,2,NULL,'PARCEIRO','NF','VARCHAR','S'),
  (161,110,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (162,110,2,NULL,'PARCEIRO','NF','VARCHAR','S'),
  (163,111,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (164,111,2,NULL,'CNPJ_CPF','NF','VARCHAR','S'),
  (165,111,3,NULL,'PARCEIRO','NF','VARCHAR','S'),
  (166,112,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (167,112,2,NULL,'CNPJ_CPF','NF','VARCHAR','S'),
  (168,112,3,NULL,'PARCEIRO','NF','VARCHAR','S'),
  (181,121,1,NULL,'CODIGO','MOVIMENTO DE CAIXA','NUMERIC','S'),
  (182,121,2,NULL,'LOTE','MOVIMENTO DE CAIXA','NUMERIC','S'),
  (183,121,3,NULL,'CENTRO_DE_CUSTO','MOVIMENTO DE CAIXA','VARCHAR','S'),
  (184,121,4,NULL,'PARCEIRO','MOVIMENTO DE CAIXA','VARCHAR','S'),
  (185,121,5,NULL,'OBS','MOVIMENTO DE CAIXA','VARCHAR','S'),
  (201,141,1,NULL,'NRO_NF','NF','NUMERIC','S'),
  (202,141,2,NULL,'CFOP','NF','NUMERIC','S'),
  (221,161,1,NULL,'LOTE','ARECEBER_BX','NUMERIC','S'),
  (222,161,2,NULL,'CODIGO_DOCUMENTO','ARECEBER_BX','NUMERIC','S'),
  (223,161,3,NULL,'CLIENTE','ARECEBER_BX','VARCHAR','S'),
  (241,181,1,NULL,'FORNECEDOR','APAGAR','VARCHAR','S'),
  (242,181,2,NULL,'OBSERVACAO','APAGAR','VARCHAR','S'),
  (243,182,1,NULL,'CODIGO','APAGAR','NUMERIC','S'),
  (244,182,2,NULL,'TIPO_DOCUMENTO','APAGAR','VARCHAR','S'),
  (245,182,3,NULL,'FORNECEDOR','APAGAR','VARCHAR','S'),
  (246,182,4,NULL,'OBSERVACAO','APAGAR','VARCHAR','S'),
  (261,201,1,NULL,'FORNECEDOR','APAGAR','VARCHAR','S'),
  (285,221,1,NULL,'HISTORICO','MOV_CONTAS_BANCARIAS','VARCHAR','S'),
  (301,261,1,NULL,'CODIGO','APAGAR','NUMERIC','S'),
  (302,261,2,NULL,'TIPO_DOCUMENTO','APAGAR','VARCHAR','S'),
  (303,261,3,NULL,'OBSERVACAO','APAGAR','VARCHAR','S')
ON CONFLICT DO NOTHING;
