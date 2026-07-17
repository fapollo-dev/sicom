-- INVENTÁRIO (contagem física de estoque) — corte-1 (núcleo + importar-produtos). Fiel ao legado uInventario:
-- header INVENTARIO_LIVRO + itens INVENTARIO (uma linha por produto; QTDE = contado). O legado NÃO tem máquina de
-- estado nem kardex — é uma planilha; a diferença (sistema − contado) é CALCULADA ao vivo (não persistida); a
-- efetivação (AtualizaEstoque1Click, uInventario.pas:515-555) SOBRESCREVE ESTOQUE.QTDE = contado, item a item,
-- gated por SenhaAdministrativa('ADM'). Reproduzimos FIEL (decisão do usuário): sem kardex, sem estado, rerodável.

-- Header (livro de inventário). Sem coluna de STATUS (fiel — o legado não tem). empresaScoped.
CREATE TABLE IF NOT EXISTS inventario_livro (
  codinvent            bigserial PRIMARY KEY,
  idempresa            integer NOT NULL,
  descricao            varchar(120),
  dtinventario         date NOT NULL DEFAULT current_date,   -- data da contagem
  dtinicial            date,
  tipoinventario       integer DEFAULT 1,                    -- tipo SPED (bloco H)
  modeloinventario     varchar(20),
  produtos_ativos      char(1) DEFAULT 'S',                  -- escopo: só produtos ativos
  apenas_estoque       char(1) DEFAULT 'N',                  -- escopo: só produtos com saldo
  indr                 char(1) DEFAULT 'I',                  -- soft-delete (I/E)
  usucadastro          integer,
  dtcadastro           timestamptz DEFAULT now(),
  usultalteracao       integer,
  dtultimalteracao     timestamptz
);

-- Itens (a folha de contagem). Uma linha por produto no inventário. QTDE = quantidade CONTADA.
CREATE TABLE IF NOT EXISTS inventario (
  sequencia            bigserial PRIMARY KEY,
  codinvent            bigint NOT NULL REFERENCES inventario_livro(codinvent) ON DELETE CASCADE,
  idempresa            integer NOT NULL,
  idproduto            integer NOT NULL,
  codbarra             varchar(20),
  descricao            varchar(120),
  unidade              varchar(6),
  codsubgrupo          integer,
  aliquota             varchar(3),
  qtde                 numeric(13,3) NOT NULL DEFAULT 0,     -- CONTADO (o operador digita)
  vrcusto              numeric(13,4) DEFAULT 0,              -- snapshot do custo (valoração fiscal)
  vrvenda              numeric(13,4) DEFAULT 0,              -- snapshot do preço
  tipo                 char(1) DEFAULT 'P',
  usucadastro          integer,
  dtcadastro           timestamptz DEFAULT now(),
  usultalteracao       integer,
  dtultimalteracao     timestamptz
);
-- uma linha por (inventário, produto) — permite upsert na contagem/importação (chave lógica do legado).
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventario_produto ON inventario (codinvent, idproduto);
CREATE INDEX IF NOT EXISTS ix_inventario_codinvent ON inventario (codinvent);

-- view de leitura do header (lista/pesquisa) + contagem de itens.
CREATE OR REPLACE VIEW get_inventario_livro AS
  SELECT l.*, (SELECT count(*) FROM inventario i WHERE i.codinvent = l.codinvent) AS qtde_itens
  FROM inventario_livro l;

-- RBAC (FRMINVENTARIO). Seed p/ o operador 7 (smoke). BTNAPLICARESTOQUE = a efetivação (gated tb por senha ADM).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMINVENTARIO', 'BTNGRAVAR', 7, 1), ('FRMINVENTARIO', 'BTNEXCLUIR', 7, 1),
  ('FRMINVENTARIO', 'BTNIMPORTARPRODUTOS', 7, 1), ('FRMINVENTARIO', 'BTNAPLICARESTOQUE', 7, 1),
  ('FRMINVENTARIO', 'BTNGRAVAR', 7, 2), ('FRMINVENTARIO', 'BTNEXCLUIR', 7, 2),
  ('FRMINVENTARIO', 'BTNIMPORTARPRODUTOS', 7, 2), ('FRMINVENTARIO', 'BTNAPLICARESTOQUE', 7, 2)
ON CONFLICT DO NOTHING;
