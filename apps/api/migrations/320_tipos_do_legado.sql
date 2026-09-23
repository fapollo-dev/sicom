-- 320 — três colunas com o TIPO errado, que a carga "consertava" perdendo o dado ("tem que ter todos os campos"):
--  · CAIXA.NRPARCELA é VARCHAR2(10) no legado: "parcela/total" ('1/1' em 156.893 linhas, '1/2', '2/3'…). Aqui era
--    integer e a carga cortava no primeiro número — o total de parcelas sumia. O caixa que a NF gera grava '1/1'.
--  · CAIXA.FORMAPGTO é VARCHAR2(30) (o nome da forma); aqui integer, e a carga anulava o que não fosse número.
--  · NF.SEQUENCIA_NFE é CHAR(1), a flag 'S'/'N' de "numerada na sequência da NF-e" (uNF.pas:10863 — 49.540 'S',
--    183 'N'); aqui integer, a carga anulava o 'S' e a transmissão gravava 1.
-- `conferir-tamanhos.py` pulava as três porque a carga as transformava.
SELECT apollo_alterar_tipo('caixa', 'nrparcela', 'varchar(10)');
SELECT apollo_alterar_tipo('caixa', 'formapgto', 'varchar(30)');
SELECT apollo_alterar_tipo('nf', 'sequencia_nfe', 'char(1)');
UPDATE nf SET sequencia_nfe = 'S' WHERE sequencia_nfe = '1';

-- e dois valores que a carga reduzia: o original passa a morar numa coluna própria (a do Apollo segue com o seu papel)
--  · APURACAO_PC_DET.TIPO do legado é o texto da origem ('ENTRADA' 118 · 'SAIDA NF' 27 · 'NFC-e' 48); o nosso `tipo` é o
--    papel C/D e juntava 'SAIDA NF' e 'NFC-e' no mesmo 'D'. `tipo_origem` guarda o texto (a apuração do Apollo grava igual).
--  · CLUBE_DESCONTO.IDEMPRESA do legado é VARCHAR2(30) com a LISTA de lojas ('1,2' em 4 linhas); o nosso é a loja do
--    tenant e a carga ficava com a primeira. `empresas` guarda a lista.
ALTER TABLE apuracao_pc_det ADD COLUMN IF NOT EXISTS tipo_origem varchar(10);
ALTER TABLE clube_desconto ADD COLUMN IF NOT EXISTS empresas varchar(30);

-- texto no legado, inteiro aqui (o dado de hoje é todo numérico, mas o legado aceita texto — conferir-tamanhos, MÉDIO)
SELECT apollo_alterar_tipo('historico', 'coddoc', 'varchar(50)');
SELECT apollo_alterar_tipo('log_impressao_etiqueta', 'codoperador', 'varchar(10)');
