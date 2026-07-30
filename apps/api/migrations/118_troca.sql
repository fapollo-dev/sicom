-- 118 — TROCA DE MERCADORIA COM FORNECEDOR (FRMTROCAMERCADORIAFOR) corte-1: documento + movimento de estoque.
-- Documento mestre-detalhe (troca + itens_troca): mercadoria avariada/vencida que SAI da loja para o fornecedor.
-- No legado o trigger ESTOQUE_TROCA (em ITENS_TROCA) dá baixa em ESTOQUE.QTDE + grava Kardex carimbado com CODTROCA.
-- Aqui a baixa é aplicada por um passo `fechar`/`reabrir` (mov RELATIVO em estoque.qtde + kardex origem='TROCA'),
-- molde do Scrap/ajuste. Valoração = custo (MULTI_PRECO). Supplier-side (NÃO depende do PDV). ADIADO (fiel/inerte
-- neste tenant): balde QTDETROCA (reserva), sub-nível ITENS_TROCA_QTDE (1:1), DEPOSITO/ESTOQUE_DEP, CODSCRAP/
-- ORIGEM_FECHAMENTO (0 linhas), NF de devolução (uImportaTrocaForDevolucao → SPED) e INVENTARIO_ROTATIVO.

-- TROCA (cabeçalho) — status ABERTA/FECHADA é DERIVADO dos itens (TROCA.STATUS do legado é vestigial =0). Sem INDR.
CREATE SEQUENCE IF NOT EXISTS seq_troca;
CREATE TABLE IF NOT EXISTS troca (
  codtroca         integer PRIMARY KEY DEFAULT nextval('seq_troca'),
  idempresa        integer NOT NULL,               -- legado CODEMPRESA, normalizado p/ idempresa (empresaScoped do engine)
  codparceiro      integer NOT NULL,               -- fornecedor (REALIZA_TROCA='S') — soft ref
  data             date DEFAULT current_date,
  descricao        varchar(150),
  usucadastro      integer,
  dtcadastro       timestamptz DEFAULT now(),
  usultalteracao   integer,
  dtultimalteracao timestamptz
);
ALTER SEQUENCE seq_troca OWNED BY troca.codtroca;
CREATE INDEX IF NOT EXISTS ix_troca_empresa ON troca (idempresa);

-- ITENS_TROCA (itens) — 1 linha por produto que sai. FECHADO 'S' = já movimentou/encerrou (baixa aplicada).
CREATE SEQUENCE IF NOT EXISTS seq_itens_troca;
CREATE TABLE IF NOT EXISTS itens_troca (
  coditenstroca    integer PRIMARY KEY DEFAULT nextval('seq_itens_troca'),
  codtroca         integer NOT NULL REFERENCES troca(codtroca) ON DELETE CASCADE,
  idempresa        integer,
  idproduto        integer NOT NULL REFERENCES produtos(idproduto),
  qtde             numeric(13,3) NOT NULL DEFAULT 0,
  vrcusto          numeric(13,2) DEFAULT 0,          -- custo (MULTI_PRECO) — server-authoritative
  vrcustorep       numeric(13,2) DEFAULT 0,          -- custo de reposição
  estoqueretirada  varchar(12) DEFAULT 'LOJA',       -- LOJA/DEPOSITO (só LOJA no golden)
  fechado          char(1) DEFAULT 'N',              -- 'S' = baixa aplicada (encerrado)
  codscrap         integer,                          -- link p/ scrap — inerte neste tenant
  usucadastro      integer,
  dtcadastro       timestamptz DEFAULT now(),
  usultalteracao   integer,
  dtultimalteracao timestamptz
);
ALTER SEQUENCE seq_itens_troca OWNED BY itens_troca.coditenstroca;
CREATE INDEX IF NOT EXISTS ix_itens_troca_troca ON itens_troca (codtroca);

-- View de lista/pesquisa: cabeçalho + fornecedor + nº itens + valor total + status DERIVADO (aberta se há item
-- não-fechado; fechada se todos fechados; espelha o GET_TROCA do legado).
CREATE OR REPLACE VIEW get_troca AS
  SELECT t.codtroca, t.codtroca AS codigo, t.idempresa, t.codparceiro, t.data, t.descricao,
         pa.razao AS fornecedor,
         (SELECT count(*) FROM itens_troca i WHERE i.codtroca = t.codtroca) AS qtde_itens,
         (SELECT COALESCE(SUM(i.qtde * i.vrcusto), 0) FROM itens_troca i WHERE i.codtroca = t.codtroca) AS valor_total,
         (CASE WHEN EXISTS (SELECT 1 FROM itens_troca i WHERE i.codtroca = t.codtroca)
                 AND NOT EXISTS (SELECT 1 FROM itens_troca i WHERE i.codtroca = t.codtroca AND COALESCE(i.fechado,'N') <> 'S')
               THEN 'FECHADA' ELSE 'ABERTA' END) AS status
  FROM troca t
  LEFT JOIN parceiros pa ON pa.codparceiro = t.codparceiro;

-- RBAC (operador 7 empresa 1+2): a tela de troca.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMTROCAMERCADORIAFOR', 'BTNGRAVAR',            7, 1),
  ('FRMTROCAMERCADORIAFOR', 'BTNGRAVAR',            7, 2),
  ('FRMTROCAMERCADORIAFOR', 'BTNEXCLUIR',           7, 1),
  ('FRMTROCAMERCADORIAFOR', 'BTNEXCLUIR',           7, 2),
  ('FRMTROCAMERCADORIAFOR', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMTROCAMERCADORIAFOR', 'BTNEDITAR',            7, 1)
ON CONFLICT DO NOTHING;
