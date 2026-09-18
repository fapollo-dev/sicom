-- 274 — EXPORTAR PARA BALANÇA, corte-2: o arquivo **INFNUTRI.TXT** (a tabela nutricional da Toledo).
-- Corte-1 na mig 126 (TXITENS/CADASTRO/ITENSMGV). Dossiê: `uExportaBalanca.md` §nutricional.
-- Fecha o "ADIADO: INFNUTRI/TXINFO (corte-2)" declarado no corte-1.
--
-- ── As três colunas que faltavam ──────────────────────────────────────────────────────────────────────
-- A **medida caseira** da porção é gravada em três campos separados em `PRODUTOS` (parte inteira, parte
-- decimal e a medida usada), e a exportação os escreve em posições fixas
-- (`UexportaBalanca.pas:139-141`, idêntico em `UArquivoBalanca.pas:90-92`). No cliente:
--   · `INTEIRAMEDIDA` 1.837 produtos · `PARTEDEC` 1.799 · `USADAMEDIDA` 1.847
--   · `CODINFANUTRI` 1.828 · `EXPDADOSNUTRICIONAIS='S'` **2.774** · com nutriente > 0: **1.474**
-- (as três já existiam em `PRODUTOS` no Oracle — NUMBER(10); no destino não vieram na mig 024.)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS inteiramedida integer;  -- parte INTEIRA da medida caseira
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS partedec      integer;  -- parte DECIMAL da medida caseira
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS usadamedida   integer;  -- código da medida caseira utilizada
COMMENT ON COLUMN produtos.inteiramedida IS 'medida caseira: parte inteira (INFNUTRI.TXT, 2 posições)';
COMMENT ON COLUMN produtos.partedec      IS 'medida caseira: parte decimal (INFNUTRI.TXT, 1 posição)';
COMMENT ON COLUMN produtos.usadamedida   IS 'medida caseira utilizada (INFNUTRI.TXT, 2 posições)';

-- ── O leiaute, e a prova de que os decimais vão SEM separador ─────────────────────────────────────────
-- `VerificaFormato`/`ConcatenaLeft` moram em `FuncoesApollo`, que **não veio no repositório** — então o
-- formato dos campos decimais teria de ser suposto. Não precisa: o próprio legado dá a prova aritmética.
-- Antes de escrever a linha ele testa
--     `if not (copy(LinhaTab, 8, 38) = '00000000000000000000000000000000000000')`
-- — 38 zeros a partir da posição 8. Contando o leiaute a partir dali:
--     reservado 1 + qtde 3 + un.porção 1 + medida (2+1+2) + energético 4 = 14
--     carboidrato 4 + proteína 3 + gord. total 3 + gord. saturada 3 + trans 3 + fibra 3 + sódio 5 = 24
--     14 + 24 = **38** — fecha exatamente, e só fecha se `'000.0'` render **4 dígitos** (e `'00.0'` 3,
--     `'0000.0'` 5), isto é, **sem o ponto**. Se o separador fosse escrito, seriam 44 e o guarda nunca
--     dispararia. É assim que o corte-2 grava.
-- Os dois guardas do legado ficam: linha com todos os 38 zeros não é escrita, e PLU '000000' também não.
