-- 237 — CONFIGURAÇÕES DO PLANO DE CONTAS (`FRMCADCONFPLANOCONTAS`, `uCadConfPlanoContas.pas`).
-- **45 acessos, 2 operadores.** A tabela veio nas migrations 103 e 108; entram a tela e uma correção.
--
-- ── ⚠️ A MÁSCARA ESTAVA ERRADA, e o dado prova ────────────────────────────────────────────────────────
-- A migration 103 semeou `'1,1,2,2,4'` a partir de um exemplo (`'1.1.03.01.0002'`) e já registrava a dúvida:
-- *"o dado real tem exceções, ex.: '2.1.01.01.14822' com 5 dígitos no último nível"*. Medido agora no plano
-- inteiro, a exceção **é a regra**:
--
--   último nível com **5 dígitos: 10.653 contas**  ·  com 4 dígitos: **297**
--
-- E o cadastro concorda: `CONFIG_PLANO_CONTAS.NDIG_5 = 5`. A máscara correta é **`1,1,2,2,5`** — as 297 de
-- quatro dígitos são as antigas. Com a máscara errada, o auto-código sugeriria um código curto em 97,3% dos
-- casos, e o contador teria de corrigir à mão toda conta nova.
UPDATE config_plano_contas SET mascara = '1,1,2,2,5' WHERE tipo = 'E' AND mascara = '1,1,2,2,4';

-- os oito níveis do legado (`NDIG_1..NDIG_8`) viram um CSV de larguras; o cliente usa cinco e deixa os três
-- últimos nulos. A tela edita nível a nível, como o original.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADCONFPLANOCONTAS', 'FRMCADCONFPLANOCONTAS', 7, 1),
  ('FRMCADCONFPLANOCONTAS', 'BTNGRAVAR',             7, 1)
ON CONFLICT DO NOTHING;

-- ── O código hierárquico da conta faltava no destino ──────────────────────────────────────────────────
-- `PLANO_CONTAS.CODIEXPANDIDO` é o código que a máscara desta tela produz (`1.1.01.01.00001`) — sem ele não
-- há como mostrar a hierarquia nem conferir a máscara contra o que já existe. Medido: **11.028 de 11.028**
-- contas o têm, e o mesmo vale para `CODIREDUZIDO` e `CODEXPINTEIRO`.
-- ⚠️ `NIVEL` está preenchido em apenas **387** das 11.028 — o legado deixou de gravá-lo em algum momento, e o
-- nível real se lê contando os pontos do código expandido. A coluna entra por cópia fiel, mas não se confia
-- nela: a tela conta os pontos.
ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS codiexpandido varchar(30);
ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS codireduzido  varchar(10);
ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS codexpinteiro varchar(30);
ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS nivel         integer;
CREATE INDEX IF NOT EXISTS ix_plano_contas_codiexp ON plano_contas (codiexpandido);
