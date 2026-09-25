-- 346 — o CADASTRO DE CFOP inteiro. A tela editava 11 das 45 colunas (o TIPO — NOT NULL no Oracle — nem era gravado num CFOP novo),
-- e os operadores do cliente mudam as outras: PROC_FINANCEIRO (51 vezes na LOG), NAO_GERA_APURACAO_ICMS (22), TIPO_CFOP (10),
-- PROC_QTDE (9), DISPENSADO_COLETA (8), NAOALIMENTADRE (6), DEVOLUCAO, NAO_GERA_SPED, ALTERA_CUSTO_NF, PRECO_CUSTO, ABATER_CFOP…
-- Os CFOPs que as migrations semearam na base de desenvolvimento nasceram sem TIPO: vem do 1º dígito (a carga traz o do cliente).
UPDATE cfop SET tipo = CASE WHEN left(codcfop, 1) IN ('1', '2', '3') THEN 'E' ELSE 'S' END WHERE tipo IS NULL;

-- a lista (e o picker do CFOP de devolução, que filtra DEVOLUCAO='S' do mesmo destino) precisa do tipo, do destino e da flag
CREATE OR REPLACE VIEW get_cfop AS
  SELECT codcfop, codcfop AS codigo, descricao, tipo, tipoestado, devolucao FROM cfop;
