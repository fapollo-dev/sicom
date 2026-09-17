-- 248 — CADASTRO DO INDEXADOR TRIBUTÁRIO (`FRMCADINDEXADORTRIBUTARIO`, `uCadIndexadorTributario.pas`).
-- **23 acessos, 4 operadores.** A tabela existe desde a migration 008, ganhou a chave certa na 034 e os
-- parâmetros de ST profundo na 031; faltavam a **tela** e sete colunas.
--
-- É o cadastro que diz, para cada combinação de **figura fiscal · tipo · origem · destino · CFOP** — e, dentro
-- dela, EAN, NCM ou fornecedor —, qual alíquota, MVA e redução aplicar. É de onde sai o ICMS-ST de toda
-- entrada de nota.
--
-- ── O tamanho real do cadastro ────────────────────────────────────────────────────────────────────────
-- **12.053 indexadores** no cliente, **atualizados hoje**. E a chave é mesmo composta: são apenas **1.075
-- NCMs distintos**, com **748 deles tendo mais de um indexador** — o NCM `19053100` tem **285**. Por isso a
-- PK é `CODINDEXADORTRIBUTARIO` (corrigido na migration 034) e a resolução é multi-chave com desempate por
-- especificidade (`tributacao.repository.ts`), e não uma busca simples por NCM.
--
-- Preenchimento medido: `ALIQUOTA`, `MVA`, `REDCOM` e `ICM_FONTE` em **100%** · `CNPJ_CPF` e `CODPARCEIRO` em
-- 99,7% · `NCM` em 88,9% · `CODBARRA` em 68,9% · as duas flags de base em 24% · `ALIQUOTA_FEM` em **0,7%**.
-- Por tipo de cadastro: **F** (fornecedor) 11.550 · **C** (cliente) 503.
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS basesemreducao      char(1);
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS base_st_com_reducao char(1);
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS usultalteracao      integer;
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS dtultimalteracao    timestamp;
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS dtcadastro          timestamp DEFAULT now();
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS indr_usuario        integer;
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS indr_data           timestamp;

-- os índices da resolução multi-chave e da busca da tela
CREATE INDEX IF NOT EXISTS ix_indexador_figura ON indexador_tributario (codfigurafiscal, tp_cadastro, origem, destino, codcfop);
CREATE INDEX IF NOT EXISTS ix_indexador_ncm    ON indexador_tributario (ncm);
CREATE INDEX IF NOT EXISTS ix_indexador_ean    ON indexador_tributario (codbarra);
CREATE INDEX IF NOT EXISTS ix_indexador_parc   ON indexador_tributario (codparceiro);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADINDEXADORTRIBUTARIO', 'FRMCADINDEXADORTRIBUTARIO', 7, 1),
  ('FRMCADINDEXADORTRIBUTARIO', 'BTNGRAVAR',                 7, 1),
  ('FRMCADINDEXADORTRIBUTARIO', 'BTNEXCLUIR',                7, 1)
ON CONFLICT DO NOTHING;
