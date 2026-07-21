-- 105 — VENDAS (item de cupom do PDV) — corte-1 do épico PDV/VENDAS. Subset FISCAL + elegibilidade que o
-- SPED EFD-Contribuições lê para apurar o DÉBITO de PIS/COFINS da SAÍDA (M200/M210 · M600/M610) e o Caixa 2d-c.
-- A tabela real (Oracle VENDAS, 11,9M linhas/236 col) é 1 linha por ITEM de cupom, com o fiscal já computado no
-- PDV. Aqui trazemos o mínimo do corte-1: o fiscal por item (pis/cofins/icms) + elegibilidade. Como a loja é
-- 100% NFC-e (mod 65) e REDUCAOZ está VAZIA no golden, a saída vem DIRETO dos itens de VENDAS (não ECF).
-- Denormalizamos CHAVENFE/STATUSNFE do cabeçalho NFC-e (o header NFC + docs C100/C175 do bloco C são o corte-2).
CREATE SEQUENCE IF NOT EXISTS seq_vendas;
CREATE TABLE IF NOT EXISTS vendas (
  codvendas       bigint PRIMARY KEY DEFAULT nextval('seq_vendas'),
  idempresa       integer NOT NULL,               -- escopo tenant/empresa
  dtvenda         timestamptz,                     -- data/hora da venda
  nropedido       varchar(20),                     -- pedido/venda do PDV
  nroserie        varchar(10),                     -- série do documento
  nrocupom        integer,                         -- nº do cupom/NFC-e
  nroitem         integer,                         -- nº do item no cupom
  codproduto      integer,
  qtde            numeric(15,3) DEFAULT 0,
  vrvenda         numeric(15,2) DEFAULT 0,          -- valor unitário de venda
  iat            char(1),                           -- 'A' arredonda / else trunca (VL_OPR do legado — uso no corte-1b)
  cfop            integer,
  aliquota        char(3),                          -- código da alíquota (T=tributado…) da venda
  cancelado       char(1) DEFAULT 'N',              -- item cancelado
  devolucao       char(1) DEFAULT 'N',              -- item de devolução
  venda_nfc       char(1) DEFAULT 'N',              -- 'S' = virou NFC-e (trilha viva); 'N' = ECF (não usado)
  chavenfe        varchar(44),                      -- chave NFC-e (denormalizada do header; elegibilidade)
  statusnfe       char(1),                          -- ''/P(autorizada)/C(cancelada)/… (denormalizada)
  -- fiscal PIS/COFINS já computado no PDV (base do débito de saída):
  pis_cst         char(2),
  pis_bcalculo    numeric(15,2) DEFAULT 0,
  pis_aliquota    numeric(13,4) DEFAULT 0,
  pis_valor       numeric(15,2) DEFAULT 0,
  cofins_cst      char(2),
  cofins_bcalculo numeric(15,2) DEFAULT 0,
  cofins_aliquota numeric(13,4) DEFAULT 0,
  cofins_valor    numeric(15,2) DEFAULT 0,
  icms_cst        char(2),
  icms_valor      numeric(15,2) DEFAULT 0,
  -- VL_OPR (reconstrução do legado: IAT/descontos/abatimento-ICMS) — trazidos p/ o corte-1b; hoje não usados.
  desc_promocao      numeric(15,2) DEFAULT 0,
  desc_departamento  numeric(15,2) DEFAULT 0,
  desc_acre_medio    numeric(15,2) DEFAULT 0,
  desc_acre_item     numeric(15,2) DEFAULT 0,
  debitopiscofins numeric(15,2) DEFAULT 0           -- valor de rentabilidade (mig 093) — referência
);
ALTER SEQUENCE seq_vendas OWNED BY vendas.codvendas;
CREATE INDEX IF NOT EXISTS ix_vendas_empresa_data ON vendas (idempresa, dtvenda);
CREATE INDEX IF NOT EXISTS ix_vendas_cupom ON vendas (idempresa, nroserie, nrocupom);
