-- 063 — RECEBIMENTO corte-3: DE-PARA de fornecedor (CODREFERENCIA_FOR). Mapeia o código/EAN do fornecedor
-- ao nosso IDPRODUTO, por CODFOR (fornecedor). É o que torna o import de XML usável de verdade: itens que o
-- match por EAN não resolve (ou resolve ambíguo) são vinculados aqui e o próximo import casa sozinho.
--
-- Fonte Delphi (retaguarda-master/fonte): match = GetProduto(codigo, CODPARCEIRO) — tenta cEAN, depois cProd,
-- SEMPRE escopado ao fornecedor (CODFOR); TIPOREF ('E' EAN / 'P' código do produto) é DESCRITIVO (não filtra o
-- match). Na resolução (frmProdNC/uNF) o legado insere DOIS registros: 'E' (cEAN) e 'P' (cProd). O guard do
-- legado é a TRIPLA (IDPRODUTO, CODREF, CODFOR) (UCadProduto.pas:5357) — PERMITE o mesmo (CODFOR, CODREF)
-- apontar p/ produtos DIFERENTES (77 casos reais). Aqui UNIQUE (CODFOR, CODREF): mais ESTRITO DE PROPÓSITO
-- (de-para determinística: 1 código de fornecedor → 1 produto — mata a ambiguidade que a de-para resolve). A
-- tabela migrada nasce VAZIA; o cutover das 16.229 linhas exige de-dup das 77 colisões multi-produto — adiado.
-- FATOR_EMBALAGEM: 98,3% nulo no legado e o import lê o fator de CODAUXILIAR (não daqui) → migrado por
-- fidelidade mas NÃO cabeado no custo/estoque no corte-3. Tabela GLOBAL (como o legado; sem IDEMPRESA — o
-- escopo de empresa vem transitivamente por CODFOR, que é um parceiro de uma empresa).

CREATE SEQUENCE IF NOT EXISTS seq_codreferencia_for;
CREATE TABLE IF NOT EXISTS codreferencia_for (
  codreferencia_for integer PRIMARY KEY DEFAULT nextval('seq_codreferencia_for'),
  idproduto         integer NOT NULL REFERENCES produtos(idproduto) ON DELETE CASCADE,
  codfor            integer NOT NULL REFERENCES parceiros(codparceiro),  -- fornecedor (PARCEIROS.FRN='S')
  codref            varchar(60) NOT NULL,                                -- código/EAN do fornecedor (normalizado)
  tiporef           char(1) DEFAULT 'E' CHECK (tiporef IN ('E', 'P')),   -- 'E' EAN / 'P' código do produto (descritivo)
  fator_embalagem   numeric(15,3),                                       -- pack (near-dead no legado; não cabeado)
  usucadastro       integer,
  dtcadastro        timestamptz DEFAULT now(),
  usultalteracao    integer,
  dtultimalteracao  timestamptz
);
ALTER SEQUENCE seq_codreferencia_for OWNED BY codreferencia_for.codreferencia_for;
-- chave de upsert/identidade: um código-de-fornecedor resolve p/ 1 produto por fornecedor.
CREATE UNIQUE INDEX IF NOT EXISTS ux_codref_for ON codreferencia_for (codfor, codref);
CREATE INDEX IF NOT EXISTS ix_codref_for_prod ON codreferencia_for (idproduto);

-- RBAC: vincular produto do fornecedor (resolução de pendências do import).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMPEDIDOCOMPRA', 'BTNVINCULARPRODUTO', 7, 1),
  ('FRMPEDIDOCOMPRA', 'BTNVINCULARPRODUTO', 7, 2)
ON CONFLICT DO NOTHING;
