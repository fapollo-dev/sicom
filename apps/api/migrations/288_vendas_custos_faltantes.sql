-- 288 — VENDAS: as duas escadas de custo e o que foi lido no caixa (R$ 396 milhões + 19 milhões de NCMs).
-- Terceiro achado do sentido origem → destino do `conferir-colunas-orfas.py`, depois das migs 286 e 287.
-- Contagens no Oracle de produção (só leitura), 22/09/2026. `VENDAS` tem **18.995.349 linhas**.
--
-- ── O mesmo padrão, agora na maior tabela do sistema ─────────────────────────────────────────────────
-- Cabeçalho da nota (mig 286), item da nota (mig 287) e agora a venda: o destino trouxe o essencial e
-- deixou a escada de custo. Aqui o volume multiplica o efeito.
--
--   coluna              vendas ≠ 0        soma              o que é
--   vrproduto           14.527.218   R$ 172.748.041,54   valor do produto na venda
--   vrcustoreal         16.378.032   R$ 112.180.725,27   **custo REAL** da venda
--   vrcustocsi          16.301.522   R$ 111.496.471,56   **custo CSI** da venda
--   margem_comissao        220.328   R$     660.984,00
--   vrfcpst              1.253.770   R$     135.567,38   FCP-ST
--   vrcustoajuste              278   R$        -751,59
--   ──────────────────────────────────────────────────────────────
--   total                            **R$ 397.221.038,16**
--
-- ⚠️ **Sem `vrcustoreal` e `vrcustocsi` não há margem no histórico.** O destino tinha `vrcusto` e
-- `vrcustorep`, que são outros degraus: todo relatório de rentabilidade sobre as 18,9 milhões de vendas
-- ficaria sem o custo que o legado de fato usou para apurar o resultado. É a mesma meia-escada da mig 287,
-- com 38× mais linhas.
--
-- ── E o que foi LIDO NO CAIXA ────────────────────────────────────────────────────────────────────────
--   ncmsh              19.021.932 linhas,     963 NCMs distintos — o NCM congelado no momento da venda
--   cest               13.580.609,            492 distintos
--   codigo_informado   12.246.066,        405.681 distintos — **o código que o operador leu/digitou**
--   codigo_tipo        12.246.541,              4 distintos — como foi informado (CB = código de barras)
--   vrvenda_tipo       14.524.116,              4 distintos — de que preço veio a venda
--   codfor             18.657.242 com valor — o fornecedor do produto na venda
--   codsecao                4.835
--
-- `CODIGO_INFORMADO` é o que o caixa realmente leu, com 405.681 valores distintos — mais do que o cadastro
-- tem de produtos. É a evidência de como a venda aconteceu (código de barras, balança, digitação), e sem
-- ela não há como auditar divergência entre o que foi lido e o produto que saiu.
--
-- ── O que fica de fora, com prova ────────────────────────────────────────────────────────────────────
-- `crescevendas_qtde` e `crescevendas_valor`: a integração Cresce Vendas tem 14.612 linhas de 18,9 milhões
-- (**0,08%**) e R$ 39 mil somados — e o status dessa integração está nulo nas 3,1 milhões de linhas de
-- `CLUBE_DESCONTO_MOV` (mig 285), ou seja, o mecanismo nunca foi usado de verdade. Declaradas no conferidor.

-- a escada de custo da venda
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS vrcustoreal    numeric(15,4);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS vrcustocsi     numeric(15,4);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS vrcustoajuste  numeric(15,4);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS vrproduto      numeric(15,4);
COMMENT ON COLUMN vendas.vrcustoreal IS
  'custo REAL da venda — sem ele e sem vrcustocsi não há margem no histórico de 18,9 milhões de vendas';

-- tributo e comissão
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS vrfcpst         numeric(15,4);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS margem_comissao numeric(15,4);

-- o que foi lido no caixa, e a classificação fiscal congelada na venda
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS ncmsh            varchar(10);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cest             varchar(10);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS codigo_informado varchar(30);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS codigo_tipo      varchar(4);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS vrvenda_tipo     varchar(4);
COMMENT ON COLUMN vendas.codigo_informado IS
  'o código que o operador leu ou digitou no caixa: 405.681 valores distintos em 12,2 milhões de vendas';

-- origem do produto na venda
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS codfor   integer;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS codsecao integer;
