-- 170 — INVENTÁRIO ROTATIVO (`FRMRELINVENTARIOROTATIVO`) corte-1: o LOTE e seu ciclo (abrir/fechar).
-- Dossiê: docs/04-screen-dossier/dossiers/retaguarda/uRelatorioInventarioRotativo.md
--
-- É o alvo com movimento MAIS RECENTE do tenant (31/07/2026): 82 lotes, 4 empresas, 1.399 linhas.
-- ⚠️ UMA TABELA, DOIS PAPÉIS (medido no golden): `OPERACAO` = 'ABERTO'/'FECHADO' são **cabeçalho de lote**
-- (73/22 linhas) e 'SUBSTITUIR'/'AUMENTAR' são **movimento coletado** (1.176/128). E o estado do lote é uma
-- LINHA NOVA, não um UPDATE: fechar INSERE uma linha 'FECHADO' ao lado da 'ABERTO'
-- (uRelatorioInventarioRotativo.pas:227-339) ⇒ "lote aberto" = existe ABERTO e **não** existe FECHADO.
CREATE SEQUENCE IF NOT EXISTS seq_inventario_rotativo;
-- o número do lote é uma sequência PRÓPRIA no legado (`GetID('CODLOTE_INV_ROTATIVO')`), separada do id da linha
-- (`GetID('INV_ROTATIVO')`) — duas linhas (ABERTO/FECHADO) compartilham o mesmo LOTE.
CREATE SEQUENCE IF NOT EXISTS seq_lote_inv_rotativo;

CREATE TABLE IF NOT EXISTS inventario_rotativo (
  codinv_rotativo   bigint PRIMARY KEY DEFAULT nextval('seq_inventario_rotativo'),
  idempresa         integer NOT NULL,
  lote              integer,               -- NULL = coleta órfã, que o fechamento "carimba" (ver §2 do dossiê)
  nomelote          varchar(100),          -- obrigatório na abertura ("Informe o nome do lote."), 73/73 no golden
  operacao          varchar(20),           -- 'ABERTO' | 'FECHADO' (cabeçalho) · 'SUBSTITUIR' | 'AUMENTAR' (coleta)
  tipo              char(1),               -- 'R' rotativo · 'G' geral
  data              timestamptz,
  data_finalizada   timestamptz,
  operador          integer,
  -- filtros do lote: no fonte vêm de `StrToIntDef(...,0)`, mas no golden são **NULL** (grupo em 3 de 73, zero em
  -- NENHUMA linha) ⇒ gravamos NULL quando vazio, não 0.
  codgrupo          integer,
  codsubgrupo       integer,
  codsecao          integer,
  codforn           integer,
  exigeconfirmacao  char(1),               -- usado: 58/73 abertos e 15/22 fechados
  almoxarifado_padrao varchar(50),
  produtoinativo    char(1),
  produto_inativo   char(1),               -- as DUAS existem no golden (nomes quase iguais; não unificar)
  busca_inativo     varchar(10),
  destino           varchar(10),           -- 'LOJA' | 'E' (nas coletas)
  qtd_anterior      numeric(13,3),
  qtd_atual         numeric(13,3),
  qtd_coletada      numeric(13,3),
  idproduto         integer,
  -- ponte com a NF (corte-3): quem carimba é a TELA DE NF (uNF.pas:5267/5280), com gate anti-reimporte e
  -- estorno no cancelamento (udmNF.pas:3418-3457).
  importado_perdas  char(1),
  codnf_perdas      integer,
  importado_sobras  char(1),
  codnf_sobras      integer,
  -- ⛔ o elo com o BALANÇO existe no dado (8 linhas apontando p/ as fotos BALANCO_GERAL_*) e **não** no fonte
  -- clonado (2020): colunas entram para a carga não perder o vínculo, SEM lógica (lição 35).
  codbalanco_inicial integer,
  codbalanco_final   integer
);
ALTER SEQUENCE seq_inventario_rotativo OWNED BY inventario_rotativo.codinv_rotativo;
CREATE INDEX IF NOT EXISTS ix_inv_rotativo_emp_lote ON inventario_rotativo (idempresa, lote);
CREATE INDEX IF NOT EXISTS ix_inv_rotativo_lote_op ON inventario_rotativo (lote, operacao);
CREATE INDEX IF NOT EXISTS ix_inv_rotativo_orfa ON inventario_rotativo (idempresa) WHERE lote IS NULL;

-- vários departamentos por lote (22 linhas em 22 lotes no golden = 1 por lote, mas o modelo é N)
CREATE TABLE IF NOT EXISTS inventario_rotativo_dpto (
  codinv_rotativo bigint NOT NULL REFERENCES inventario_rotativo(codinv_rotativo) ON DELETE CASCADE,
  coddpto         integer NOT NULL,
  PRIMARY KEY (codinv_rotativo, coddpto)
);

-- RBAC — as 3 opções reais do golden (34 linhas / 15 operadores cada).
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT v.form, v.opcao, v.codoperador, v.codempresa
FROM (VALUES
  ('FRMRELINVENTARIOROTATIVO', 'FRMRELINVENTARIOROTATIVO', 7, 1),
  ('FRMRELINVENTARIOROTATIVO', 'FRMRELINVENTARIOROTATIVO', 7, 2),
  ('FRMRELINVENTARIOROTATIVO', 'BTNNOVOLOTE',              7, 1),
  ('FRMRELINVENTARIOROTATIVO', 'BTNNOVOLOTE',              7, 2),
  ('FRMRELINVENTARIOROTATIVO', 'BTNFECHARINVENTARIO',      7, 1),
  ('FRMRELINVENTARIOROTATIVO', 'BTNFECHARINVENTARIO',      7, 2)
) AS v(form, opcao, codoperador, codempresa)
WHERE NOT EXISTS (
  SELECT 1 FROM permissoes p
  WHERE p.form = v.form AND p.opcao = v.opcao AND p.codoperador = v.codoperador AND p.codempresa = v.codempresa
);
