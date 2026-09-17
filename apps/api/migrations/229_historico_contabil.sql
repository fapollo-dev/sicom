-- 229 — HISTÓRICO CONTÁBIL (`HISTORICO_CONTABIL`, `udmCadHistoricoContabil.pas`): a tabela que faltava no
-- destino, e o texto que o razão do Apollo não estava escrevendo.
--
-- ── A lacuna ──────────────────────────────────────────────────────────────────────────────────────────
-- A integração contábil (migrations 199-201) foi dada por completa, mas o motor grava `diario.codhist` e
-- deixa `diario.deschist` NULO. No cliente, **1,43 milhão de linhas do razão TÊM o texto** — é ele que a
-- tela de lançamentos (`lancamentos-contabeis.service.ts:85`) mostra e o que o contador lê no livro. Os
-- lançamentos que o Apollo gerasse sairiam mudos ao lado dos do legado.
--
-- ── Os históricos são TEMPLATES, e o `*` é o buraco ───────────────────────────────────────────────────
-- Não é um rótulo fixo: o cadastro guarda `'TAXA DE CARTAO BAIXADOS LOTE .: * OPERADORA .: *'` (código 96) e
-- o razão grava `'TAXA DE CARTAO BAIXADOS LOTE .: 90886 OPERADORA .: ALELO ALIMENTACA - CODREDE 5'`. Cada
-- `*` é substituído, **na ordem**, por um argumento que quem contabiliza fornece.
--
-- ⚠️ **procedência**: quem faz a substituição mora em `FuncoesApollo`, pacote que NÃO veio no fonte clonado
-- — o mesmo buraco que obrigou a reconstruir o motor do razão a partir do DADO. A regra abaixo saiu de
-- confrontar os 54 templates com o razão real, origem por origem.
--
-- ⚠️ **número vira 9 dígitos com zeros à esquerda** (o `FormatFloat('000000000')` do Delphi), texto vai cru.
-- Medido: `A RECEBER DOCTO .: 000130582` para `DOCUMENTO='130582'` em **5.895 de 5.895** linhas da origem 14,
-- e `AGRUPAMENTO CONVENIO .: 000117847` em **15.089 de 15.089** da origem 65. Já o lote vai cru
-- (`RECEBTO LOTE .: 90790`): é argumento de texto, não de documento. Quem não recebe argumento imprime
-- `000000000` ou vazio — e o razão do cliente tem essas linhas (origem 64, histórico 1).
--
-- A tabela é cadastro (54 linhas na produção) e entra no plano de carga; o seed abaixo é a cópia fiel dela,
-- para o Apollo saber escrever o razão antes da primeira carga.
CREATE TABLE IF NOT EXISTS historico_contabil (
  codhistcontabil   integer PRIMARY KEY,
  deschist          text,
  status            char(1) DEFAULT 'S',
  usultalteracao    text,
  dtultimalteracao  timestamp,
  dtcadastro        timestamp DEFAULT now()
);

INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (1,'NOTA FISCAL COMPRA .: * CNPJ * FORNECEDOR *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (21,'DOCTO.: * CNPJ.: * PARCEIRO.: * TIPO DOCTO.: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (41,'NOTA FISCAL DESPESAS * FORNECEDOR * CFOP *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (61,'NOTA FISCAL.: * CFOP.: *CNPJ.: *PARCEIRO.: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (62,'CREDITO ICMS NFISCAL COMPRA .: * CNPJ.: * PARCEIRO.:*','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (63,'NOTA FISCAL *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (64,'NOTA FISCAL PERDA.: *CFOP .: *LOJA .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (65,'CREDITO ICMS NFISCAL BONIFICACAO .: * CNPJ.: *PARCEIRO.: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (66,'DEBITO ICMS NFISCAL PERDA .: * CFOP .: *LOJA .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (67,'NOTA FISCAL CONSUMO INTERNO .: * CFOP-*LOJA-*','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (68,'DEBITO ICMS NFISCAL VENDA .: * CFOP.: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (69,'NOTA FISCAL VENDA.: *CNPJ.: * CLIENTE.: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (70,'CUSTO VENDA NFISCAL .:*CFOP .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (71,'RECEBTO DOCTO.: * LOTE.: *PARCEIRO.: * * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (81,'VENDAS NFC SERIE * * NDATA','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (82,'CUSTO VENDAS NFC SERIE * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (83,'FECHAMENTO CAIXA NFC * OPERADOR * ESPECIE *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (84,'SOBRA CAIXA NFC * OPERADOR *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (85,'QUEBRA DE CAIXA NFC * OPERADOR *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (86,'CREDITO CONTA .: * DA CONTA .: * LOTE .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (87,'ADIANT P/ PARCEIRO .: * DOCTO .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (88,'PGTO .: * DOCTO .: * LOTE .: * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (89,'A RECEBER DOCTO .: * VERBA .: * PARCEIRO .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (90,'DESCONTO OBTIDO LOTE .: * NOTA FISCAL .: * FORNECEDOR .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (91,'PAGTO LOTE .: * DOCTO .: * - * NOTAFISCAL .: * PARCEIRO .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (92,'*','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (93,'RECEBTO LOTE .: * CLIENTE .: * BAIXADO POR .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (94,'RECEBTO CARTAO LOTE .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (95,'RECEBTO CARTAO LOTE .: * OPERADORA .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (96,'TAXA DE CARTAO BAIXADOS LOTE .: * OPERADORA .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (97,'RECEBTO .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (98,'ICMS VENDAS NFC SERIE * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (99,'DEBITO PIS VENDAS NFC SERIE .: * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (100,'DEBITO COFINS VENDAS NFC .: * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (101,'RESCISAO A PAGAR .: * DOCTO .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (102,'FGTS RESCISORIO .: * DOCTO .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (103,'APAGAR DOCTO .: * * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (104,'AGRUPAMENTO CONVENIO .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (105,'AGRUPAMENTO CONVENIO .: *  *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (106,'DESCONTO OBTIDO .: * * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (107,'JUROS PAGOS .* * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (108,'DEVOLUCAO COMPRA .: *  NOTAFISCAL .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (109,'DEBITO PIS DEVOLUCAO COMPRA NOTA FISCAL .: * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (110,'DEBITO COFINS DEVOLUCAO COMPRAS NOTA FISCAL .: * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (111,'NOTA FISCAL DESPESA TELEFONIA .: * * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (112,'NOTA FISCAL DESPESA .: *  CNPJ .: * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (121,'DOCTO.: *LOTE.: * * PARCEIRO.: * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (141,'NOTA FISCAL DEVOLUCAO VENDA .: * CFOP .:','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (161,'DESCONTO CONCEDIDO LOTE.: * DOCTO.: * CLIENTE.: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (181,'TROCO SOLIDARIO À PAGAR * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (182,'A PAGAR DOCTO.: *DOCTO.: *FORNECEDOR.: *-*','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (201,'FÉRIAS A PAGAR .: *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (221,'PAGTO * *','S') ON CONFLICT DO NOTHING;
INSERT INTO historico_contabil (codhistcontabil,deschist,status) VALUES (261,'APAGAR INSS DOCTO .: * TIPO .: * *','S') ON CONFLICT DO NOTHING;

-- a tela de cadastro do legado (`FRMCADHISTORICOCONTABIL`), para quem mantém os textos.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMCADHISTORICOCONTABIL', 'FRMCADHISTORICOCONTABIL', 7, 1)
ON CONFLICT DO NOTHING;

-- o `NOTAFISCAL .: *` do histórico 91 (`PAGTO LOTE .: * DOCTO .: * - * NOTAFISCAL .: * PARCEIRO .: *`) sai de
-- `APAGAR.DOCNF`, coluna que existia só no A RECEBER aqui (migration 153). ⚠️ cópia-fiel-negativa: no cliente
-- ela está NULA nas **55.204** linhas de `APAGAR`, e é por isso que as 43.121 linhas da origem 15 no razão
-- mostram `NOTAFISCAL .: ` vazio. A coluna entra porque a regra existe e o dado pode mudar.
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS docnf varchar(20);

-- o `OPERADORA .: *` do histórico 96 (a maior população do razão, 1,33 milhão de linhas) sai da própria linha
-- do cartão: `CARTAO.OPERADORA` mais o `CODREDE`, montados como 'ALELO ALIMENTACA - CODREDE 5'. Nenhuma das
-- duas estava no destino. No cliente: 2.038.896 cartões com operadora e 2.061.076 com rede, de 2.062.109.
ALTER TABLE cartao ADD COLUMN IF NOT EXISTS operadora varchar(50);
ALTER TABLE cartao ADD COLUMN IF NOT EXISTS codrede   integer;
