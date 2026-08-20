-- 169 — RASTREABILIDADE DE LOTE/VALIDADE NA NF (`NF_PROD_LOTE`) corte-1: a última tabela com volume da varredura
-- por dado (56.521 linhas) — e, ao contrário do que o volume sugeria, **não é resíduo: é regra fiscal**.
--
-- Procedência do que a torna viva:
--   • `NFe.pas:1796-1819` — na EMISSÃO ela vira o grupo **`rastro`** do XML da NF-e: `nLote` = LOTE,
--     `qLote` = QUANTIDADE do item ÷ **QTDLOTE** (a contagem de lotes daquele item — o legado divide a quantidade
--     igualmente entre os lotes), `dFab` = DTFABRICACAO, `dVal` = DTVALIDADE.
--   • `NFe.pas:4212-4225` — na IMPORTAÇÃO de XML o caminho é o inverso: para cada `rastro` do item ele faz
--     `Locate('CODNFPROD;LOTE')` e EDITA se achou, senão INSERE. É esse o corte-1 aqui (o Apollo já importa XML).
--   • `uItensNF.pas:1908-1923` grava/limpa os lotes junto com o item; `uNFLoteValidade.pas` é a tela dos lotes.
--   • `PRODUTOS.CONTROLE_VALIDADE = 'S'` em **41.540 de 43.116** produtos (96%) — a operação inteira controla
--     validade, então qualquer NF de saída futura de produto controlado precisa do grupo.
--
-- O dado para em **fev/2024** (2023-11: 3.489 · 2023-12: 2.333 · 2024-01: 2.209 · **2024-02: 521** · depois nada),
-- a mesma data-marco de outros clusters do tenant — e é coerente com o fato de o tenant emitir quase só NFC-e
-- (99,8% do detalhe de saída da apuração de ICMS). O dado histórico é sujo: **38.914 das 56.521 linhas têm LOTE
-- em branco** e 5 têm validade absurda (ano 4790) ⇒ **nenhuma validação retroativa** (a carga tem de aceitar).
CREATE SEQUENCE IF NOT EXISTS seq_nf_prod_lote;
CREATE TABLE IF NOT EXISTS nf_prod_lote (
  codnfprodlote bigint PRIMARY KEY DEFAULT nextval('seq_nf_prod_lote'),
  codnfprod     integer NOT NULL REFERENCES nf_prod(codnfprod) ON DELETE CASCADE, -- o ITEM da NF (não a NF)
  idempresa     integer NOT NULL,
  idproduto     integer,
  lote          varchar(60),      -- pode vir em branco (69% do golden) — sem NOT NULL, sem trim obrigatório
  dtvalidade    date,
  dtfabricacao  date              -- só 6.981 das 56.521 linhas têm data de fabricação
);
ALTER SEQUENCE seq_nf_prod_lote OWNED BY nf_prod_lote.codnfprodlote;
CREATE INDEX IF NOT EXISTS ix_nf_prod_lote_item ON nf_prod_lote (codnfprod);
CREATE INDEX IF NOT EXISTS ix_nf_prod_lote_prod ON nf_prod_lote (idproduto, idempresa);
-- a chave que o legado usa para decidir entre editar e inserir (`Locate('CODNFPROD;LOTE')`, NFe.pas:4217).
-- `coalesce` porque LOTE em branco/nulo é a maioria do golden e precisa continuar caindo em UMA linha por item.
CREATE UNIQUE INDEX IF NOT EXISTS ux_nf_prod_lote_item_lote ON nf_prod_lote (codnfprod, coalesce(lote, ''));
