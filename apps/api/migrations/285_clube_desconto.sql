-- 285 — CLUBE DE DESCONTO: as colunas que a carga perdia, a FK que rejeitaria 98,5% e as 3 tabelas irmãs.
-- A tabela `clube_desconto` existe desde a **mig 112** (como detalhe da promoção). Esta migration não a
-- cria: conserta o que a varredura de 22/09/2026 mediu nela e acrescenta a família que ficou de fora.
-- Dossiê: `uClubeDesconto.md`. Contagens no Oracle de produção (só leitura).
--
-- ── ⚠️ 1. A CARGA PERDIA O PRODUTO DE 3.104 DAS 3.111 REGRAS ─────────────────────────────────────────
-- `CLUBE_DESCONTO.BARRAS` diz sobre QUAL PRODUTO a regra age, está preenchido em **3.104 de 3.111 (99,8%)**
-- e **não existe no destino**. Sem ela, toda regra de preço do clube chega sem saber a que produto se
-- aplica — não é perda parcial, é a regra inteira virando inútil. São 388 produtos distintos.
-- Outras 9 colunas também ficavam para trás; destas, só `venda_estoque` tem uso real (1.013 linhas).
-- As demais vêm porque é barato e o leiaute as prevê: `pdv` (6), `hora` (5), `dtalteracao`,
-- `indr_usuario`, `indr_data`, `descricao` (0), `vrcusto` (0), `vrcustorep` (0).
--
-- ── ⚠️ 2. A CHAVE ESTRANGEIRA REJEITARIA 98,5% DA CARGA ──────────────────────────────────────────────
-- A mig 112 modelou `clube_desconto` como detalhe de `promocao` e criou
-- `idpromocao ... REFERENCES promocao(idpromocao)`. O dado desmente: das **3.111** regras, só **47 (1,5%)**
-- têm `IDPROMOCAO` existente em `PROMOCAO` — **3.064 são órfãs**. Em `CLUBE_DESCONTO_EXT` são **40 de 40**.
-- O `IDPROMOCAO` do clube é o identificador da promoção **no sistema do clube**, não a nossa promoção.
-- A tabela está no `plano-tabelas.json`, então a carga **falharia inteira** nela — não perderia linhas em
-- silêncio, o que é melhor, mas pararia a madrugada.
-- A FK sai. O índice fica, e o número fica escrito aqui para ninguém "consertar" isso de volta.
-- (Mesma família da armadilha `MOTIVOS` × `MOTIVOS_OPERACAO`: o nome sugere um vínculo que o dado nega.)
--
-- ── ⚠️ 3. TRÊS TABELAS DA FAMÍLIA ESTAVAM FORA DO PLANO ──────────────────────────────────────────────
--   `CLUBE_DESCONTO_MOV`   **3.118.725** linhas — **824.491 em 2026**, crescendo todo ano desde 2021
--                          (201k → 417k → 385k → 595k → 693k → 824k). É o uso da regra no cupom.
--   `CLUBE_DESCONTO_EXT`   40 — os itens extras da regra (leve X, leve Y de outro produto)
--   `CLUBE_DESCONTO_PROD`  273 — a fila de produtos a sincronizar
--
-- ── Fold declarado: as integrações com CRM externo estão MORTAS ──────────────────────────────────────
-- `CLUBE_DESCONTO_MOV` tem colunas para quatro integradores (Izio, Mercafácil, Cresce Vendas e "sistema"),
-- e o status de **todos os quatro é nulo nas 3.118.725 linhas**. Nunca foram usados. As colunas vêm para
-- que a carga não perca o leiaute, mas nenhuma regra depende delas.
--
-- ── Escopo: a REGRA é retaguarda, o MOVIMENTO é PDV ──────────────────────────────────────────────────
-- Quem cadastra a regra é o operador da retaguarda, e é o que a tela deste corte faz. O movimento é
-- registrado no PDV, que está **fora de escopo por instrução**: a tabela entra como dado histórico, com
-- destino e carga, sem tela.

-- ── 1. as colunas que faltavam ───────────────────────────────────────────────────────────────────────
ALTER TABLE clube_desconto ADD COLUMN IF NOT EXISTS barras        varchar(20);
ALTER TABLE clube_desconto ADD COLUMN IF NOT EXISTS descricao     varchar(200);
ALTER TABLE clube_desconto ADD COLUMN IF NOT EXISTS pdv           integer;
ALTER TABLE clube_desconto ADD COLUMN IF NOT EXISTS hora          time;
ALTER TABLE clube_desconto ADD COLUMN IF NOT EXISTS vrcusto       numeric(15,4);
ALTER TABLE clube_desconto ADD COLUMN IF NOT EXISTS vrcustorep    numeric(15,4);
ALTER TABLE clube_desconto ADD COLUMN IF NOT EXISTS venda_estoque numeric(15,3);
ALTER TABLE clube_desconto ADD COLUMN IF NOT EXISTS dtalteracao   timestamptz;
ALTER TABLE clube_desconto ADD COLUMN IF NOT EXISTS indr_usuario  integer;
ALTER TABLE clube_desconto ADD COLUMN IF NOT EXISTS indr_data     timestamptz;
COMMENT ON COLUMN clube_desconto.barras IS
  'o produto sobre o qual a regra age (99,8% das regras do cliente). Nulo só nas de cupom inteiro.';

-- ── 2. a FK que o dado desmente ──────────────────────────────────────────────────────────────────────
ALTER TABLE clube_desconto DROP CONSTRAINT IF EXISTS clube_desconto_idpromocao_fkey;
ALTER TABLE clube_desconto ALTER COLUMN idpromocao DROP NOT NULL;
COMMENT ON COLUMN clube_desconto.idpromocao IS
  'id da promoção NO SISTEMA DO CLUBE — NÃO é FK para promocao: 3.064 das 3.111 regras do cliente são órfãs.';

-- o índice que a operação usa: o que vale AGORA para este produto
CREATE INDEX IF NOT EXISTS ix_clube_desconto_barras ON clube_desconto (idempresa, barras)
  WHERE barras IS NOT NULL AND coalesce(indr, 'I') <> 'E';
CREATE INDEX IF NOT EXISTS ix_clube_desconto_vigente ON clube_desconto (idempresa, data_inicio, data_fim)
  WHERE ativo = 'S' AND coalesce(indr, 'I') <> 'E';

-- ── 3. as três tabelas da família ────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_clube_desconto_ext;
CREATE TABLE IF NOT EXISTS clube_desconto_ext (
  idclubedescontoext integer PRIMARY KEY DEFAULT nextval('seq_clube_desconto_ext'),
  idempresa    integer,
  idpromocao   integer NOT NULL,   -- idem: id do clube, sem FK
  loja         integer NOT NULL DEFAULT 1,
  operacao     varchar(30) NOT NULL,
  ativo        char(1) NOT NULL DEFAULT 'S',
  barras       varchar(20) NOT NULL,
  quantidade   numeric(15,3) NOT NULL,
  valor        numeric(15,4),
  tipo         char(1),
  encerrada    char(1) NOT NULL DEFAULT 'F',
  origem       varchar(2) NOT NULL DEFAULT 'S',
  dtcadastro   timestamptz NOT NULL DEFAULT now(),
  dtalteracao  timestamptz
);
ALTER SEQUENCE seq_clube_desconto_ext OWNED BY clube_desconto_ext.idclubedescontoext;
CREATE INDEX IF NOT EXISTS ix_clube_desconto_ext_prom ON clube_desconto_ext (idempresa, idpromocao);

-- o USO da regra no cupom: 3,1 milhões de linhas, 824 mil só em 2026
CREATE SEQUENCE IF NOT EXISTS seq_clube_desconto_mov;
CREATE TABLE IF NOT EXISTS clube_desconto_mov (
  idclubedescontomov integer PRIMARY KEY DEFAULT nextval('seq_clube_desconto_mov'),
  idempresa    integer,
  loja         integer,
  pdv          integer,
  tipo         char(1),
  nrodocumento integer,
  movimento    varchar(60),    -- a chave do cupom (ex.: 51NFCE31210637954975000169)
  nome         varchar(60),
  dtmovimento  timestamptz,
  dtcadastro   timestamptz,
  dtarquivo    timestamptz,
  chave        varchar(60),
  versao       varchar(20),
  situacao     char(1),
  nropedido    varchar(30),
  cpfcnpj      varchar(20),
  origem       varchar(2),
  -- ⚠️ os quatro integradores de CRM: status NULO nas 3.118.725 linhas. Nunca usados.
  mov_izio             text,  dtmov_izio     timestamptz, status_izio     varchar(20),
  mov_sistema          text,  dtmov_sistema  timestamptz, status_sistema  varchar(20),
  mov_cresce_vendas    text,  status_cresce_vendas varchar(20),
  mov_mercafacil       text,  status_mercafacil    varchar(20),
  indr         varchar(1),
  indr_usuario integer,
  indr_data    timestamptz
);
ALTER SEQUENCE seq_clube_desconto_mov OWNED BY clube_desconto_mov.idclubedescontomov;
CREATE INDEX IF NOT EXISTS ix_clube_desconto_mov_dia ON clube_desconto_mov (idempresa, dtmovimento);
CREATE INDEX IF NOT EXISTS ix_clube_desconto_mov_doc ON clube_desconto_mov (movimento);
CREATE INDEX IF NOT EXISTS ix_clube_desconto_mov_cpf ON clube_desconto_mov (cpfcnpj)
  WHERE cpfcnpj IS NOT NULL;

-- a fila de produtos a sincronizar com o clube
CREATE TABLE IF NOT EXISTS clube_desconto_prod (
  idproduto   integer NOT NULL,
  dtmovimento timestamptz NOT NULL,
  PRIMARY KEY (idproduto, dtmovimento)
);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCLUBEDESCONTO', 'FRMCLUBEDESCONTO', 7, 1),
  ('FRMCLUBEDESCONTO', 'BTNGRAVAR',        7, 1),
  ('FRMCLUBEDESCONTO', 'BTNEXCLUIR',       7, 1)
ON CONFLICT DO NOTHING;
