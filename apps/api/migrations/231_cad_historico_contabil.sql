-- 231 — CADASTRO DE HISTÓRICO CONTÁBIL (`FRMCADHISTORICOCONTABIL`, `uCadHistoricoContabil.pas`).
-- 62 acessos, 3 operadores. A tabela e os 54 templates vieram na migration 229, com a integração contábil;
-- aqui entra a TELA que os mantém — quem escreve o texto que o razão vai imprimir.
--
-- ⚠️ o código é gerado por sequence. No cliente os códigos vão de 1 a 261 com saltos largos (1, 21, 41, 61…
-- 112, depois 121, 141, 161, 181, 201, 221, 261) — o legado dava passo de 20 em parte das inclusões. Aqui a
-- sequence é de 1 em 1, começando depois do maior código já carregado: o número não tem significado, só o
-- texto tem, e nenhuma regra do razão depende do intervalo entre eles.
CREATE SEQUENCE IF NOT EXISTS seq_historico_contabil START 1;
ALTER TABLE historico_contabil ALTER COLUMN codhistcontabil SET DEFAULT nextval('seq_historico_contabil');
ALTER SEQUENCE seq_historico_contabil OWNED BY historico_contabil.codhistcontabil;
SELECT setval('seq_historico_contabil', coalesce((SELECT max(codhistcontabil) FROM historico_contabil), 0) + 1, false);

-- `STATUS` é o ativo/inativo do cadastro: 'S' nos 54 do cliente. O inativo some das escolhas mas continua
-- valendo para o razão já gravado, que guarda o CÓDIGO e não o texto.
ALTER TABLE historico_contabil ALTER COLUMN status SET DEFAULT 'S';
UPDATE historico_contabil SET status = 'S' WHERE status IS NULL;

CREATE OR REPLACE VIEW get_historico_contabil AS
  SELECT h.codhistcontabil AS codigo,
         h.codhistcontabil,
         h.deschist,
         h.status,
         -- quantos buracos o template tem: é o que diz quantos argumentos a contabilização precisa passar,
         -- e o que separa um rótulo fixo (0) de um template (1 ou mais)
         (length(coalesce(h.deschist, '')) - length(replace(coalesce(h.deschist, ''), '*', '')))::int AS coringas,
         h.dtultimalteracao,
         h.dtcadastro
    FROM historico_contabil h;

-- o gate de tela veio na 229; gravar e excluir têm opção própria, como em todo cadastro que passa pela engine
-- (`BTNGRAVAR` / `BTNEXCLUIR` do form-base do legado).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADHISTORICOCONTABIL', 'BTNGRAVAR',  7, 1),
  ('FRMCADHISTORICOCONTABIL', 'BTNEXCLUIR', 7, 1)
ON CONFLICT DO NOTHING;
