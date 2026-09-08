-- 202 — CONSTRUTOR DE RELATÓRIOS (`FRMRELATORIO`) corte-1: o CATÁLOGO DE FONTES e a definição do relatório.
-- Dossiê: `uRelatorio-construtor.md`. Decisão do usuário (08/09): *"isso já funciona 100%, só analisar nosso
-- banco de dados"* — e é literalmente isso: o catálogo do legado **não é uma tabela**, é o COMENTÁRIO das
-- views. `GET_CARTAOBX` tem `COMMENT` = `';CARTOES BAIXADOS'`, e é esse rótulo que aparece no combo de fontes
-- da tela e no campo `TABELA` de cada definição salva pelo cliente.
--
-- São **198 das 417 views `GET_*`** que têm rótulo — as com rótulo são as ofertadas. Destas, **28 já existem
-- no Apollo**, e é o que este corte habilita. As demais entram junto com as telas que as originam.
--
-- ── 1. Os rótulos, copiados do cliente ─────────────────────────────────────────────────────────────────────
-- Mantidos como ele escreveu, acento e tudo (é o que o operador reconhece na lista). O `;` do começo é
-- convenção do legado e não faz parte do nome.
COMMENT ON VIEW get_agenda_promocao IS 'AGENDA PROMOCAO';
COMMENT ON VIEW get_apagar IS 'CONTAS A PAGAR';
COMMENT ON VIEW get_bairro IS 'BAIRROS';
COMMENT ON VIEW get_bancos IS 'BANCOS';
COMMENT ON VIEW get_cartao IS 'CARTAO';
COMMENT ON VIEW get_cidades IS 'CIDADES';
COMMENT ON VIEW get_contas_bancarias IS 'CONTAS BANCARIAS';
COMMENT ON VIEW get_empresas IS 'EMPRESAS';
COMMENT ON VIEW get_estoque IS 'ESTOQUE';
COMMENT ON VIEW get_familias_prod IS 'CATEGORIAS E DEPARTAMENTOS';
COMMENT ON VIEW get_formas_pgto IS 'FORMAS DE PAGAMENTO';
COMMENT ON VIEW get_hist_vendas IS 'HISTÓRICO DE VENDA(S)/PEDIDO(S) REALIZADO(S)';
COMMENT ON VIEW get_inventario_livro IS 'LIVRO INVENTARIO';
COMMENT ON VIEW get_lote_cobranca IS 'LOTE_COBRANCAS';
COMMENT ON VIEW get_nf IS 'NF';
COMMENT ON VIEW get_operadoras IS 'OPERADORAS';
COMMENT ON VIEW get_operadores IS 'OPERADORES';
COMMENT ON VIEW get_parceiros IS 'PARCEIROS';
COMMENT ON VIEW get_pedidocompra IS 'PEDIDO DE COMPRA';
COMMENT ON VIEW get_pedido_devolucao_compra IS 'DEVOLUCAO COMPRA';
COMMENT ON VIEW get_perfil IS 'PERFIL';
COMMENT ON VIEW get_plano_contas IS 'PLANO DE CONTAS';
COMMENT ON VIEW get_producao IS 'PRODUCAO';
COMMENT ON VIEW get_produtos IS 'PRODUTOS';
COMMENT ON VIEW get_promocao IS 'PROMOÇÕES';
COMMENT ON VIEW get_scrap IS 'SCRAP';
COMMENT ON VIEW get_troca IS 'TROCAS';
COMMENT ON VIEW get_unidade IS 'UNIDADES';
-- ── 2. A definição do relatório ────────────────────────────────────────────────────────────────────────────
-- No legado é um XML de 4 KB gravado em `RELATORIOS_CUSTOMIZADOS`, sem histórico: se alguém quebra o
-- relatório do contador, não há como saber o que mudou. Aqui é JSON, com autor e data.
--
-- A forma do JSON é a MESMA do legado, campo a campo (decodificado de `GET_CARTAOBX_CARTAO TAXA.XML`):
--   { "titulo", "paisagem", "somenteAgrupamento", "quebraPagina", "agruparPor",
--     "colunas":   [ { "campo" | "calculado": {campo1, operacao, campo2}, "titulo", "largura",
--                      "posicao", "totalizar", "percentual", "formato" } ],
--     "condicoes": [ { "campo", "operador", "valor" } ],
--     "ordem":     [ { "campo", "direcao" } ] }
--
-- `fonte` é o nome da view e é validado contra o catálogo a cada execução — nunca interpolado direto.
CREATE SEQUENCE IF NOT EXISTS seq_relatorio_definicao;
CREATE TABLE IF NOT EXISTS relatorio_definicao (
  codrelatoriodef  integer PRIMARY KEY DEFAULT nextval('seq_relatorio_definicao'),
  idempresa        integer NOT NULL,
  nome             varchar(120) NOT NULL,
  fonte            varchar(63)  NOT NULL,          -- a view do catálogo (ex.: 'get_apagar')
  definicao        jsonb NOT NULL,
  -- de onde veio: 'LEGADO' quando importado do XML do cliente, 'APOLLO' quando montado aqui.
  origem           varchar(10) NOT NULL DEFAULT 'APOLLO',
  usucadastro      integer,
  dtcadastro       timestamptz NOT NULL DEFAULT now(),
  usultalteracao   integer,
  dtultimalteracao timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_relatorio_def_nome ON relatorio_definicao (idempresa, upper(nome));

-- histórico: uma linha por versão salva. É o que o XML do legado não tem.
CREATE SEQUENCE IF NOT EXISTS seq_relatorio_definicao_hist;
CREATE TABLE IF NOT EXISTS relatorio_definicao_hist (
  codhist         integer PRIMARY KEY DEFAULT nextval('seq_relatorio_definicao_hist'),
  codrelatoriodef integer NOT NULL REFERENCES relatorio_definicao(codrelatoriodef) ON DELETE CASCADE,
  definicao       jsonb NOT NULL,
  codoperador     integer,
  dtalteracao     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_relatorio_def_hist ON relatorio_definicao_hist (codrelatoriodef, dtalteracao DESC);

-- ── 3. RBAC ────────────────────────────────────────────────────────────────────────────────────────────────
-- O legado concede o gate da tela (`FRMRELATORIO`) e o do cadastro (`FRMCADASTRORELATORIO`) separadamente —
-- rodar um relatório e criar um relatório são coisas diferentes, e o cliente separa: 1.251 acessos contra 73.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELATORIO', 'FRMRELATORIO', 7, 1),
  ('FRMCADASTRORELATORIO', 'FRMCADASTRORELATORIO', 7, 1)
ON CONFLICT DO NOTHING;

-- um relatório de exemplo sobre uma fonte que existe em qualquer instalação, para a tela nunca abrir vazia.
INSERT INTO relatorio_definicao (idempresa, nome, fonte, definicao, origem)
SELECT 1, 'Contas a pagar em aberto', 'get_apagar', '{
  "titulo": "Contas a pagar em aberto",
  "paisagem": false,
  "colunas": [
    {"campo": "codapg",     "titulo": "Código",    "largura": 8,  "posicao": 1},
    {"campo": "duplicata",  "titulo": "Duplicata", "largura": 16, "posicao": 2},
    {"campo": "dtvenc",     "titulo": "Vencimento","largura": 12, "posicao": 3, "formato": "data"},
    {"campo": "valor",      "titulo": "Valor",     "largura": 14, "posicao": 4, "formato": "moeda", "totalizar": true}
  ],
  "condicoes": [{"campo": "quitada", "operador": "=", "valor": "N"}],
  "ordem": [{"campo": "dtvenc", "direcao": "asc"}]
}'::jsonb, 'APOLLO'
WHERE NOT EXISTS (SELECT 1 FROM relatorio_definicao WHERE idempresa = 1 AND upper(nome) = 'CONTAS A PAGAR EM ABERTO');
