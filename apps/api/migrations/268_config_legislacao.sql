-- 268 — CONFIGURAÇÃO DE LEGISLAÇÃO DA NF-e (`FRMCONFIGLEGISLACAONFE`, `uConfigLegislacaoNFe.pas` +
-- `uDMConfigLegislacaoNFe`). **5 acessos, 2 operadores.** Dossiê: `uConfigLegislacaoNFe.md`.
--
-- As **mensagens legais que saem nas observações da NF-e** — texto livre (CLOB) endereçado por empresa e,
-- opcionalmente, UF, CFOP, produto e parceiro. O legado lê com
-- `GetConfigLegislacao(UF, CFOP, produto, parceiro)` (udmNF.pas:9628) e escreve o resultado em
-- `mmoInfAdProd` (informação adicional do item, uItensNF.pas:2701), na observação da nota (uNF.pas:4692) e
-- no mapa de carga (UCadMapaDeCarga.pas:1111).
--
-- ── ⚠️ Três defeitos, todos com prova no dado (produção, 18/09/2026) ───────────────────────────────────
-- 1. **A função de resolução nunca acha nada.** O WHERE exige `CODCFOP = <n>` — e **as 18 linhas da tabela
--    têm `CODCFOP` NULO**. Nenhuma NF-e do cliente jamais recebeu mensagem por este caminho.
-- 2. **`if RecordCount = 1`**: se duas linhas casassem, o legado devolveria vazio em silêncio — sem erro,
--    sem mensagem. Aqui a resolução é por **especificidade** (produto > parceiro > UF > geral) e devolve
--    todas as candidatas com a escolhida marcada.
-- 3. **Código Delphi vazado para dentro do dado**: a linha SIMPLES_NACIONAL das empresas 1 e 50 guarda
--    literalmente `'+ sLineBreak +'` no meio do texto — alguém colou a expressão do fonte no campo. Duas
--    outras (`REDUCAO_LANA`) estão com o texto em **mojibake** (`ReduÃ§Ã£o da Base de CÃ¡lculo`).
--    E `BASE_LEGAL_REDUCAOBC` cita o **RCTE/GO** (Goiás) numa casa cujas 5 empresas são de **MG**.
-- As 18 linhas ficam como estão (é dado do cliente); a tela agora MOSTRA os três problemas.
--
-- Conteúdo: 7 chaves por empresa (MENSAGEM_ICMS_DIFAL, REDUCAO_LANA, APROVEITAMENTO_CREDITO, TRIBUTOS,
-- BASE_LEGAL_REDUCAOBC, SIMPLES_NACIONAL, INFORMACOES_OPERADORES) nas empresas 1 e 50, mais 4 de SUFRAMA
-- para UF='AM' (uma delas já excluída, `INDR='E'`). Os textos têm placeholders do legado: `%DIFAL%`,
-- `%PERC_…%`, `$(NF_SUFRAMA)`.
CREATE SEQUENCE IF NOT EXISTS seq_config_legislacao;
CREATE TABLE IF NOT EXISTS config_legislacao (
  codconfiglegislacao integer PRIMARY KEY DEFAULT nextval('seq_config_legislacao'),
  codempresa       integer NOT NULL,
  descricao        varchar(120),          -- a "chave" nomeada (MENSAGEM_ICMS_DIFAL, SUFRAMA…)
  observacoes      text,                  -- CLOB no legado: o texto que vai na NF-e
  uf               char(2),
  codcfop          integer,
  codproduto       integer,
  codparceiro      integer,
  tipo             char(1),
  codoperador      integer,
  indr             char(1) DEFAULT 'I',
  indr_usuario     integer,
  indr_data        timestamptz,
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_config_legislacao OWNED BY config_legislacao.codconfiglegislacao;
CREATE INDEX IF NOT EXISTS ix_config_legislacao_emp ON config_legislacao (codempresa, uf, codcfop);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCONFIGLEGISLACAONFE', 'FRMCONFIGLEGISLACAONFE', 7, 1),
  ('FRMCONFIGLEGISLACAONFE', 'BTNGRAVAR',              7, 1),
  ('FRMCONFIGLEGISLACAONFE', 'BTNEXCLUIR',             7, 1)
ON CONFLICT DO NOTHING;
