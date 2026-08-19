-- 157 — PENDÊNCIAS/ANÁLISE corte-2b: o MOTOR (NovaAnalise + ProcessarAnalise). O corte-2a trouxe a análise
-- persistida só p/ LEITURA; para CALCULAR faltavam os ITENS da nota (o lado NF da comparação) e as 3 configs
-- de tolerância. Procedência: `UAnalisePedidosNF.pas` — `GetQryProdutosNF` lê
-- `NFE_NAO_CADASTRADAS_ITENS` (os itens do XML da fila do manifesto) e `GetQryProdutosPedido` lê o pedido.
--
-- 1) NFE_NAO_CADASTRADAS_ITENS — 125.886 itens no golden (122.835 com IDPRODUTO casado; 100% com FATOREMBAL).
--    28 colunas, fiéis ao Oracle. A chave de ligação com o cabeçalho é a CHAVENFE (não o id).
CREATE SEQUENCE IF NOT EXISTS seq_nfe_naocad_item;
CREATE TABLE IF NOT EXISTS nfe_nao_cadastradas_itens (
  codnfenaocadit  integer PRIMARY KEY DEFAULT nextval('seq_nfe_naocad_item'),
  chavenfe        varchar(50) NOT NULL,
  codprod         varchar(60),                    -- o código do produto NO FORNECEDOR (do XML)
  ean             varchar(20),
  descricao       varchar(255),
  nroitem         integer,
  ncm             varchar(10),
  cfop            integer,
  unidade         varchar(10),
  quantidade      numeric(15,4),
  fatorembal      numeric(15,4),                  -- unidades por embalagem (o XML traz a embalagem)
  vrunitario      numeric(15,6),
  vrtotal         numeric(15,2),
  eantrib         varchar(20),
  unidadetrib     varchar(10),
  quantidadetrib  numeric(15,4),
  vrunitariotrib  numeric(15,6),                  -- é ESTE que o motor usa como base do custo
  vrfrete         numeric(15,2),
  vrseg           numeric(15,2),
  vrdesc          numeric(15,2),
  vroutro         numeric(15,2),
  indtot          integer,
  idproduto       integer,                        -- o casamento com o nosso catálogo (nulo = não casado)
  vrbasest        numeric(15,2),
  vricmst         numeric(15,2),
  vrunitario_trib numeric(15,6),
  ipi_nota        numeric(15,2),
  vrfcpst         numeric(15,2)
);
ALTER SEQUENCE seq_nfe_naocad_item OWNED BY nfe_nao_cadastradas_itens.codnfenaocadit;
CREATE INDEX IF NOT EXISTS ix_nfe_naocad_itens_chave ON nfe_nao_cadastradas_itens (chavenfe);
CREATE INDEX IF NOT EXISTS ix_nfe_naocad_itens_prod ON nfe_nao_cadastradas_itens (idproduto);

-- 2) as 3 TOLERÂNCIAS do motor (ids e valores REAIS do Oracle — todas em 0 no golden, ou seja: hoje qualquer
--    diferença é divergência). A assimetria é regra de negócio: a variação POSITIVA é em VALOR absoluto e a
--    NEGATIVA é em PERCENTUAL (UAnalisePedidosNF.AnalisaProdutosDivergencia).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (187, 'VARIACAO_POSITIVA_NF',            '0,00', 'Float',   'Modulo;Empresa;Grupo;Usuario', 'Tolerância em VALOR (R$) quando o custo da NF é MAIOR que o do pedido; acima disso é divergência.'),
  (188, 'VARIACAO_NEGATIVA_NF',            '0',    'Integer', 'Modulo;Empresa;Grupo;Usuario', 'Tolerância em PERCENTUAL quando o custo da NF é MENOR que o do pedido; acima disso é divergência.'),
  (334, 'DIFERENCA_MAXIMA_ACEITA_QTDE_KG', '0',    'Float',   'Modulo;Empresa;Grupo;Usuario', 'Tolerância em PERCENTUAL na diferença de quantidade de produto vendido por KG (as demais unidades não têm tolerância).')
ON CONFLICT (id) DO NOTHING;
