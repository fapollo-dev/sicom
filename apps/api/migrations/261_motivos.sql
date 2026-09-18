-- 261 — MOTIVOS DO AJUSTE DE ESTOQUE (`FRMMOTIVO`, `Umotivo.pas` 38 linhas + `UdmMotivos`). **10 acessos,
-- 6 operadores** (último 04/08/2026). Dossiê: `uMotivo.md`.
--
-- ── ⚠️ O Apollo tinha a FK do ajuste de estoque apontando para a tabela ERRADA ─────────────────────────
-- No legado há DUAS tabelas de motivo com nome parecido, e são coisas diferentes:
--  · `MOTIVOS` (3 linhas) — é a que `AJUSTE_ESTOQUE.CODMOTIVO` referencia por FK (USER_CONSTRAINTS), e a que
--    a tela de ajuste lê no combo (`GET_MOTIVOS`, UajusteEstoque.pas:745). É o cadastro DESTA migration.
--  · `MOTIVOS_OPERACAO` (38 linhas, códigos 1–301) — é a do SCRAP (`SCRAP_ITEM.CODMOTIVOOP`, uCadSCRAP.pas:404).
-- A migration 059 modelou `ajuste_estoque.codmotivo REFERENCES motivos_operacao` e semeou 6 motivos
-- inventados; a 171 precisou "criar o 999 em motivos_operacao para a carga não quebrar" — o sintoma do
-- apontamento errado: o 999 sempre existiu, em `MOTIVOS` ('INVENTARIO ROTATIVO').
--
-- ── O que o dado diz (produção, 18/09/2026) ─────────────────────────────────────────────────────────────
--  · `MOTIVOS`: 999 'INVENTARIO ROTATIVO' · 1 'PERCA INDENTIFICADA' (sic, é assim no cadastro) ·
--    41 'APOLLO SISTEMAS' (INDR='E', excluído em 10/03/2025 — teste do fornecedor).
--  · `AJUSTE_ESTOQUE` 2026: 679 ajustes com motivo 999 e 297 com motivo 1 — só os dois vivos.
--
-- Aqui: `motivos` com o conteúdo vivo do legado; a FK do ajuste reapontada; ajustes já gravados no destino
-- com código que não exista em `motivos` têm o código copiado de `motivos_operacao` (descrição preservada)
-- para a FK se sustentar. `motivos_operacao` segue intacta — é do scrap. Exclusão é lógica (INDR='E'),
-- como no legado (o CadMaster não apaga fisicamente).
CREATE SEQUENCE IF NOT EXISTS seq_motivos;
CREATE TABLE IF NOT EXISTS motivos (
  codmotivo        integer PRIMARY KEY DEFAULT nextval('seq_motivos'),
  descricao        varchar(100) NOT NULL,
  indr             char(1) DEFAULT 'I',
  indr_usuario     integer,
  indr_data        timestamptz,
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_motivos OWNED BY motivos.codmotivo;

INSERT INTO motivos (codmotivo, descricao) VALUES
  (999, 'INVENTARIO ROTATIVO'),
  (1,   'PERCA INDENTIFICADA')
ON CONFLICT (codmotivo) DO NOTHING;

-- ajustes já no destino com código fora de `motivos`: copia o código (e o nome que ele tinha) para a FK fechar
INSERT INTO motivos (codmotivo, descricao)
SELECT DISTINCT a.codmotivo, coalesce(mo.descricao, 'MOTIVO ' || a.codmotivo)
  FROM ajuste_estoque a
  LEFT JOIN motivos_operacao mo ON mo.codmotivoop = a.codmotivo
 WHERE NOT EXISTS (SELECT 1 FROM motivos m WHERE m.codmotivo = a.codmotivo)
ON CONFLICT (codmotivo) DO NOTHING;

-- códigos novos nascem acima do 999 do legado
SELECT setval('seq_motivos', (SELECT GREATEST(coalesce(max(codmotivo), 1), 1000) FROM motivos));

-- reaponta a FK: solta a que aponta para motivos_operacao (nome gerado pelo PG), cria a certa
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'ajuste_estoque'::regclass AND con.contype = 'f' AND att.attname = 'codmotivo'
  LOOP
    EXECUTE format('ALTER TABLE ajuste_estoque DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE ajuste_estoque ADD CONSTRAINT fk_ajuste_estoque_motivo FOREIGN KEY (codmotivo) REFERENCES motivos (codmotivo);
END $$;

-- a view que a tela do legado lê
CREATE OR REPLACE VIEW get_motivos AS
  SELECT codmotivo, descricao, indr FROM motivos;

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMMOTIVO', 'FRMMOTIVO',  7, 1),
  ('FRMMOTIVO', 'BTNGRAVAR',  7, 1),
  ('FRMMOTIVO', 'BTNEXCLUIR', 7, 1)
ON CONFLICT DO NOTHING;
