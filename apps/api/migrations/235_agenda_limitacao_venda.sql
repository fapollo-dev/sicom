-- 235 — AGENDA DE LIMITAÇÃO DE VENDA (`FRMCADAGENDALIMITACAOVENDA`, `uCadAgendaLimitacaoVenda.pas`).
-- **51 acessos, 6 operadores.**
--
-- Limita **quanto de um produto cada cliente pode levar** num período. No cliente o uso é sazonal e casado
-- com o "DIA D" (o dia de promoção forte): das **11 agendas** cadastradas, 8 têm o nome ligado a isso
-- (`DIA D`, `LIMITACAO DIA D`, `LIMITAÇOES DIA D`) e as outras limitam um item específico (`HEINEKEN`,
-- `LEITE PORTO ALEGRE 1L`). Vão de **21/12/2020 a 29/09/2023**, com **92 itens** no total — a maior tem 41
-- produtos. Não é mecanismo morto: é mecanismo que só se usa quando há promoção que atrai atravessador.
--
-- ⚠️ **`AGENDA_PRODUTO_ITEM.CODGRUPO` é o grupo de PREÇO, não o de produto**: o legado preenche a coluna com
-- `COD_GRUPOPRECO` do pesquisador de produtos (`:119`). Confundir os dois limitaria a família errada.
--
-- ⚠️ **`ESTATUS = 'F'` (fechada) impede alteração** — `'Agenda Fechada. Impossível alterar.'` (`:147`). No
-- cliente **as 11 estão fechadas**, porque todas já passaram.
CREATE SEQUENCE IF NOT EXISTS seq_agenda_produto START 1;
CREATE SEQUENCE IF NOT EXISTS seq_agenda_produto_item START 1;

CREATE TABLE IF NOT EXISTS agenda_produto (
  codagenda_produto integer PRIMARY KEY DEFAULT nextval('seq_agenda_produto'),
  codempresa        integer NOT NULL,
  dtinicio          date NOT NULL,
  dtfim             date NOT NULL,
  -- 'Q' (quantidade) nas 11 do cliente; a coluna existe porque o legado a tem
  tipo              char(1) DEFAULT 'Q',
  -- 'A' aberta · 'F' fechada. Fechada não se altera.
  estatus           char(1) DEFAULT 'A',
  descricao         varchar(150),
  -- a lista de lojas participantes, no formato ';1;2;' do legado — obrigatória antes de adicionar item
  empresas          varchar(200),
  dataexecucao      timestamp,
  usultalteracao    integer,
  dtultimalteracao  timestamp,
  dtcadastro        timestamp DEFAULT now(),
  indr              char(1),
  indr_usuario      integer,
  indr_data         timestamp
);
ALTER SEQUENCE seq_agenda_produto OWNED BY agenda_produto.codagenda_produto;
CREATE INDEX IF NOT EXISTS ix_agenda_produto_periodo ON agenda_produto (dtinicio, dtfim);

CREATE TABLE IF NOT EXISTS agenda_produto_item (
  codagenda_produto_item integer PRIMARY KEY DEFAULT nextval('seq_agenda_produto_item'),
  codagenda_produto      integer NOT NULL REFERENCES agenda_produto(codagenda_produto) ON DELETE CASCADE,
  idproduto              integer NOT NULL,
  quantidade             numeric(13,3) NOT NULL,
  -- 'S' limita o GRUPO DE PREÇO inteiro, não só este produto — 2 dos 92 itens do cliente
  atualizacao_grupo      char(1) DEFAULT 'N',
  -- ⚠️ o grupo de PREÇO (`COD_GRUPOPRECO`), não o grupo de produto
  codgrupo               integer,
  ativo                  char(1) DEFAULT 'S',
  usultalteracao         integer,
  dtultimalteracao       timestamp,
  dtcadastro             timestamp DEFAULT now(),
  indr                   char(1),
  indr_usuario           integer,
  indr_data              timestamp
);
ALTER SEQUENCE seq_agenda_produto_item OWNED BY agenda_produto_item.codagenda_produto_item;
-- o pesquisador do legado já exclui o que está na agenda (`NOT (CODIGO IN ...)`, :97); aqui o índice garante
CREATE UNIQUE INDEX IF NOT EXISTS ux_agenda_produto_item ON agenda_produto_item (codagenda_produto, idproduto);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADAGENDALIMITACAOVENDA', 'FRMCADAGENDALIMITACAOVENDA', 7, 1),
  ('FRMCADAGENDALIMITACAOVENDA', 'BTNGRAVAR',                  7, 1),
  ('FRMCADAGENDALIMITACAOVENDA', 'BTNEXCLUIR',                 7, 1)
ON CONFLICT DO NOTHING;

-- ⚠️ o pesquisador de produtos da tela filtra `ATIVO='S' AND IMPRIMIRCOMP='N'` (`:104`) — item de composição
-- não entra em limitação de venda, porque ele não é vendido sozinho. A coluna não existia no destino.
-- Medido: **46.906** produtos com 'N', **804** nulos e apenas **2** com 'S'. O filtro é real mas raso, e o
-- nulo precisa passar (senão 804 produtos sumiriam do pesquisador).
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS imprimircomp char(1);

-- ⚠️ não existe cadastro de GRUPO DE PREÇO no legado: `CODGRUPOPRECO` é só um número que agrupa produtos
-- (9.554 dos 47.712 o têm). É por ele que o flag `ATUALIZACAO_GRUPO='S'` estende a limitação à família.
