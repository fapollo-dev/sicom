-- 232 — ATUALIZAÇÃO AUTOMÁTICA DE PRODUTOS (`FRMMULTATUALIZACAO`, `uMultAtualizacao.pas`, 1.145 linhas).
-- **60 acessos, 6 operadores.** Dossiê: `uMultAtualizacao.md`.
--
-- Escolhe produtos, escolhe UM campo, escolhe uma operação, e aplica em todos de uma vez. É a tela que sobe
-- 10% no preço de uma família inteira, troca o subgrupo de duzentos itens ou desativa uma linha de produtos.
-- Poderosa e perigosa na mesma medida — e é por isso que ela tem as travas que tem.
--
-- ── As seis colunas que faltavam em `produtos` ────────────────────────────────────────────────────────
-- Todas existem no legado e têm dado; a grade da tela as mostra e o combo de campos deixa alterá-las.
--   `DESCMAX`       numeric(15,6) — **40.897** de 47.712 preenchidos
--   `COMISSAO`      numeric(13,2) — **40.503**
--   `COMPQTDE`      numeric(13,2) — **47.712** (todos)
--   `COMPFATOR`     numeric(13,4) — **47.712** (todos)
--   `TIPOPIS`       char(1)       — **29.142**
--   `ESPECIFICACAO` varchar(300)  — **48** (⚠️ quase vazia, mas é campo de texto livre que o operador usa)
-- ⚠️ `CODAUXILIAR` aparece na grade do legado mas **não existe em `PRODUTOS`** no Oracle: é coluna calculada
-- do dataset da tela. Não entra.
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS descmax       numeric(15,6);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS comissao      numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS compqtde      numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS compfator     numeric(13,4);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tipopis       char(1);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS especificacao varchar(300);

-- o gate de tela, e a gravação com opção própria: ver e simular é uma coisa, escrever em N produtos é outra
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMMULTATUALIZACAO', 'FRMMULTATUALIZACAO', 7, 1),
  ('FRMMULTATUALIZACAO', 'BTNGRAVAR',          7, 1)
ON CONFLICT DO NOTHING;

-- ── A hierarquia de família mora na PRÓPRIA `FAMILIAS_PROD` ───────────────────────────────────────────
-- Quando o operador troca o SUBGRUPO de um produto, o legado busca grupo, departamento e seção **no próprio
-- registro do subgrupo** (`sqqComplemento`: `SELECT CODDPTO, CODGRUPO, CODSECAO FROM FAMILIAS_PROD WHERE
-- CODFAMILIA = :x AND TIPO = 'S'`) e os grava junto — a hierarquia não pode ficar inconsistente.
--
-- Medido no cliente: das 520 famílias de tipo `S`, **505 têm CODGRUPO e CODDPTO**. Os outros tipos não têm
-- nenhum (é o subgrupo que aponta para cima). ⚠️ `CODSECAO` está preenchido em **1** linha de 520 — a coluna
-- existe, o legado a copia, e o valor é nulo em praticamente tudo: cópia fiel, inclusive no vazio.
ALTER TABLE familias_prod ADD COLUMN IF NOT EXISTS codgrupo integer;
ALTER TABLE familias_prod ADD COLUMN IF NOT EXISTS coddpto  integer;
ALTER TABLE familias_prod ADD COLUMN IF NOT EXISTS codsecao integer;
