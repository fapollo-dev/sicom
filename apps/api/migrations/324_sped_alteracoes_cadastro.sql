-- 324 — AS ALTERAÇÕES DE CADASTRO DO SPED (TB_SPEED_AUX): o registro 0205 (o produto mudou a descrição ou o código de barras)
-- e o 0175 (o participante mudou nome, CNPJ/CPF, município, endereço, número, complemento ou bairro). O legado grava ao
-- salvar o produto (`UCadProduto.pas:3072` → `udmPrincipal.RegistroSPEED0205`) e o parceiro (`uCadClientes.pas:2113`,
-- `RegistroSPEED0175`/`…Endereco`), e o SPED Fiscal emite os pendentes sob o 0200/0150 e os marca como informados
-- (`Uspedfiscal.pas:1548-1600`, `:1725-1750`; a consulta `sqqSpeedAux` em `UdmSpedFiscal.dfm:7705`). 7.796 linhas em
-- produção, 1.474 ainda não informadas. A tabela veio na mig 311; aqui a sequência (o `GetID('COD_SPEED_AUX')`).
CREATE SEQUENCE IF NOT EXISTS seq_cod_speed_aux;
ALTER SEQUENCE seq_cod_speed_aux OWNED BY tb_speed_aux.cod_speed_aux;
SELECT setval('seq_cod_speed_aux', (coalesce((SELECT max(cod_speed_aux) FROM tb_speed_aux), 0) + 1)::bigint, false);
ALTER TABLE tb_speed_aux ALTER COLUMN cod_speed_aux SET DEFAULT nextval('seq_cod_speed_aux');
CREATE INDEX IF NOT EXISTS ix_tb_speed_aux_registro ON tb_speed_aux (tipo_registro, codigo_registro, reg_informado);
