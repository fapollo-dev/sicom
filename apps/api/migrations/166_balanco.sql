-- 166 — INVENTÁRIO / **BALANÇO** corte-1: a foto de estoque (`BALANCO` + `BALANCOITENS`) e os dois comandos do
-- popup que a produzem/consomem — "Gerar Balanco à partir do Inventário" (uInventario.pas:1218-1299) e
-- "Importar Balanço" (uInventario.pas:1343-1483). Dossiê:
-- docs/04-screen-dossier/dossiers/retaguarda/uInventario-balanco.md
--
-- Golden: 24 cabeçalhos (2 empresas) × 980.574 itens — as fotos de 2026 têm **43.071 itens cada** (a base inteira
-- de produtos da empresa), **942.437 itens (96,1%) com QTDE = 0** e 3.742 negativos. `ATIVO` é NULL nas 24 linhas
-- e o legado lê `(ATIVO IS NULL OR ATIVO='S')` ⇒ NULL = ativo (não inventar default 'S').

CREATE SEQUENCE IF NOT EXISTS seq_balanco;
CREATE TABLE IF NOT EXISTS balanco (
  codbalanco       integer PRIMARY KEY DEFAULT nextval('seq_balanco'),
  descricao        varchar(100),
  data             date NOT NULL,
  codoperador      integer,                 -- quem gerou (o legado grava o operador logado)
  codempresa       integer NOT NULL,
  ativo            char(1),                 -- NULL = ativo (fiel: `ATIVO IS NULL OR ATIVO='S'`)
  usultalteracao   integer,
  dtcadastro       timestamptz DEFAULT now(),
  dtultimalteracao timestamptz
);
ALTER SEQUENCE seq_balanco OWNED BY balanco.codbalanco;
-- (data, codempresa) é a chave que "Gerar Balanço" consulta (sqqBalanco) — mas NÃO é única no golden: em
-- 28/01/2026 há 5 fotos por empresa no mesmo dia (tentativas repetidas). Índice, não UNIQUE.
CREATE INDEX IF NOT EXISTS ix_balanco_data_emp ON balanco (codempresa, data DESC);

CREATE SEQUENCE IF NOT EXISTS seq_balancoitens;
CREATE TABLE IF NOT EXISTS balancoitens (
  codbalancoitens  bigint PRIMARY KEY DEFAULT nextval('seq_balancoitens'),
  codbalanco       integer NOT NULL REFERENCES balanco(codbalanco) ON DELETE CASCADE,
  codempresa       integer NOT NULL,
  idproduto        integer NOT NULL,
  idproduto_filho  integer,               -- resíduo: 131 de 980.574 linhas no golden; nenhum dataset o lê
  qtde             numeric(13,3) NOT NULL DEFAULT 0
);
ALTER SEQUENCE seq_balancoitens OWNED BY balancoitens.codbalancoitens;
CREATE INDEX IF NOT EXISTS ix_balancoitens_bal ON balancoitens (codbalanco, codempresa);
CREATE INDEX IF NOT EXISTS ix_balancoitens_prod ON balancoitens (idproduto, codempresa);

-- o lookup do legado é uma view (`GET_BALANCO`, existe em USER_VIEWS): `select codbalanco, descricao, data,
-- codempresa from balanco` — sem filtro de ATIVO (quem filtra é o call site, por IDEMPRESA).
CREATE OR REPLACE VIEW get_balanco AS
SELECT b.codbalanco AS codigo, b.codbalanco, b.descricao, b.data, b.codempresa AS idempresa
FROM balanco b;

-- ESTOQUE DE DEPÓSITO: "Importar Balanço" soma `COALESCE(E.QTDE,0) + COALESCE(D.QTDE,0)` (ESTOQUE + ESTOQUE_DEP,
-- uInventario.pas:1349/1357). No golden a tabela tem 137.524 linhas mas só **4 com qtde <> 0** (soma −10): a
-- regra é real e praticamente inerte. Criada para que a regra seja fiel e a carga tenha destino.
CREATE TABLE IF NOT EXISTS estoque_dep (
  idproduto integer NOT NULL REFERENCES produtos(idproduto) ON DELETE CASCADE,
  idempresa integer NOT NULL,
  qtde      numeric(13,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (idproduto, idempresa)
);

-- CUSTO FISCAL: o inventário usa `MULTI_PRECO.VRCUSTOFISCAL` quando a config diz FISCAL, com **fallback** para
-- VRCUSTO quando o fiscal é nulo (uInventario.pas:1419-1427 / 1568-1576 / 1754 / 2121). Materialíssimo no golden:
-- 105.730 de 137.526 linhas de multi_preco têm VRCUSTOFISCAL preenchido (77%) ⇒ é coluna de CARGA.
ALTER TABLE multi_preco ADD COLUMN IF NOT EXISTS vrcustofiscal numeric(15,4);

-- a config que decide (id/valor/whitelist do golden — CONFIGURACOES.ID 468, valor 'PRODUTO', o caminho FISCAL
-- existe no código e está DESLIGADO hoje).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, obsoleto)
VALUES (468, 'VRCUSTO_INVENTARIO', 'PRODUTO', 'String',
        'Define no inventário se será usado o valor do custo do produto ou a média das notas fiscals.',
        'FISCAL;PRODUTO|FISCAL;PRODUTO', 'Modulo;Empresa;Grupo;Usuario', 'F')
ON CONFLICT (id) DO NOTHING;

-- RBAC — **fold de paridade**: a mig 090 semeou nomes INVENTADOS (`BTNIMPORTARPRODUTOS`, `BTNAPLICARESTOQUE`) e o
-- golden usa os do popup do Delphi (`IMPORTARPRODUTOS1`, `ATUALIZAESTOQUE1`, cada um com 34 linhas/15 operadores).
-- Com os nomes inventados, os grants reais do cliente não casariam com os nossos decorators no cutover.
UPDATE permissoes SET opcao = 'IMPORTARPRODUTOS1' WHERE form = 'FRMINVENTARIO' AND opcao = 'BTNIMPORTARPRODUTOS';
UPDATE permissoes SET opcao = 'ATUALIZAESTOQUE1' WHERE form = 'FRMINVENTARIO' AND opcao = 'BTNAPLICARESTOQUE';

-- as opções do golden que o corte usa: GERARBALANCO1 (comando 6) e o gate da própria tela (FRMINVENTARIO) —
-- "Importar Balanço"/"Importar Balanço e Atualizar Estoque" **não têm opção própria** no golden (as 12 opções de
-- FRMINVENTARIO estão no dossiê §1c), logo respondem ao gate da tela. FRMCADBALANCO entra com as 6 do golden.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT v.form, v.opcao, v.codoperador, v.codempresa
FROM (VALUES
  ('FRMINVENTARIO', 'FRMINVENTARIO',        7, 1), ('FRMINVENTARIO', 'FRMINVENTARIO',        7, 2),
  ('FRMINVENTARIO', 'GERARBALANCO1',        7, 1), ('FRMINVENTARIO', 'GERARBALANCO1',        7, 2),
  ('FRMINVENTARIO', 'SINCRONIZARINVENTRIO1',7, 1), ('FRMINVENTARIO', 'SINCRONIZARINVENTRIO1',7, 2),
  ('FRMCADBALANCO', 'FRMCADBALANCO',        7, 1), ('FRMCADBALANCO', 'FRMCADBALANCO',        7, 2),
  ('FRMCADBALANCO', 'BTNADICIONARREGISTRO', 7, 1), ('FRMCADBALANCO', 'BTNADICIONARREGISTRO', 7, 2),
  ('FRMCADBALANCO', 'BTNGRAVAR',            7, 1), ('FRMCADBALANCO', 'BTNGRAVAR',            7, 2),
  ('FRMCADBALANCO', 'BTNEDITAR',            7, 1), ('FRMCADBALANCO', 'BTNEDITAR',            7, 2)
) AS v(form, opcao, codoperador, codempresa)
WHERE NOT EXISTS (
  SELECT 1 FROM permissoes p
  WHERE p.form = v.form AND p.opcao = v.opcao AND p.codoperador = v.codoperador AND p.codempresa = v.codempresa
);
