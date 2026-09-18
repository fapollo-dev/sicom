-- 262 — ENTRADAS × FINANCEIRO (`FRMRELENTRADAS_FINAN`, `uRelEntradas_Finan.pas` 233 linhas + `.dfm` +
-- `uDMRelEntradas_Finan`). **11 acessos, 3 operadores.** Dossiê: `uRelEntradas_Finan.md`.
--
-- A pergunta da tela: "das notas de entrada do período, quais têm título a pagar — e quais não têm?"
-- Grid de cima: NF tipo E por DTCONTABIL (NRONF ≠ '0' e não nulo), com TOTALPROD/TOTALNF e o fornecedor;
-- grid de baixo: os títulos de APAGAR com IDNF = CODNF da nota selecionada, com filtro opcional por
-- vencimento; impressão `Notas_fiscais_Entradas_Finan.fr3`.
--
-- ── Defeitos medidos (produção, 18/09/2026) ─────────────────────────────────────────────────────────────
--  · **Sem filtro de empresa**: em 2026 são 6.547 NF de entrada — 4.007 da loja 1, 2.521 da loja 2 e 19 da
--    52 — e a tela mostra tudo junto. Aqui tenant-scoped.
--  · `COALESCE(TOTALPROD, 0.01)` — gambiarra para algum divisor do .fr3; em 2026 não há TOTALPROD nulo.
--    Não replicado (0,01 seria inventar um número).
--  · Não filtra CANCELADA (1 em 2026) — aqui a cancelada vem MARCADA, não escondida.
--  · **O número que a tela existe para achar**: na loja 1, **346 de 4.007** NF de entrada de 2026 (8,6%,
--    R$ 438 mil) não têm NENHUM título a pagar. Aqui vem por nota (`titulos`, `valorTitulos`) e no total
--    (`semTitulo`), com o filtro `somenteSemTitulo`.
-- Colunas que o grid de títulos mostra e o destino não tinha:
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS codoperador integer;
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS nrparcela   varchar(10);
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS gfat        char(1);
CREATE INDEX IF NOT EXISTS ix_apagar_idnf ON apagar (idnf);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELENTRADAS_FINAN', 'FRMRELENTRADAS_FINAN', 7, 1)
ON CONFLICT DO NOTHING;
