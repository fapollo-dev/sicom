-- 266 — GERAR FINANCEIRO EM LOTE (`FRMGERARFINANCEIROLOTE`, `uGerarFinanceiroLote.pas` 348 linhas +
-- `udmGerarFinanceiroLote`). **8 acessos, 3 operadores** no MENUEXPRESS — e **10.666 títulos gerados em
-- 2026**. Dossiê: `uGerarFinanceiroLote.md`.
--
-- A cobrança mensal dos clientes de valor FIXO: escolhe vários clientes (`CLI='S' AND ATIVADO='S'`, seleção
-- múltipla), uma data de vencimento e um banco, e gera **um `ARECEBER` por cliente** com o valor de
-- `PARCEIROS.FIXO`. O menu conta 8 acessos porque a tela é aberta uma vez por mês — e cada abertura gera
-- ~1.300 títulos.
--
-- ── O que o dado diz (produção, 18/09/2026) ─────────────────────────────────────────────────────────────
--  · `PARCEIROS.FIXO > 0`: **169 clientes**, somando **R$ 182.522,81** (de R$ 100 a R$ 6.800).
--  · títulos com `DUPLICATA = 'DUP 01/01'` (a marca da tela): 2020: 3.397 · 2021: 8.906 · 2022: 11.058 ·
--    2023: 12.619 · 2024: 14.456 · 2025: 15.059 · **2026: 10.666** (≈1.300/mês, R$ 72–94 mil/mês).
--  · por loja em 2026: 7.477 na 1 e 3.189 na 2 — todos `TIPODOC='DUPLICATA'`.
--
-- ── Regras do fonte, copiadas ─────────────────────────────────────────────────────────────────────────
--  · o título nasce `QUITADA='N'`, `GERADO='SISTEMA'`, `NRODUP=1`, `DUPLICATA='DUP 01/01'`,
--    `TXJUROS = EMPRESAS.TXJUROPADRAO`, `IDPGTO` = a forma de pagamento **DUPLICATA** da empresa (se não
--    existir, o legado recusa a tela inteira: "Não existe a forma de pagamento DUPLICATA cadastrada");
--  · `DTVENDA` = hoje, **ou** o dia `PARCEIROS.VENC_PREV` do mês corrente quando "Vencimento do Cliente"
--    está marcado (uGerarFinanceiroLote.pas:186);
--  · **guarda anti-duplicidade**: antes de gravar, o legado procura um `ARECEBER` do mesmo
--    (parceiro, vencimento, valor, empresa, banco) e **descarta** a linha se achar. Preservada — e é o que
--    impede a segunda geração do mesmo mês virar cobrança dobrada. (Mesmo assim há 47 grupos repetidos em
--    2026: vieram por outro caminho, não por esta tela.)
--  · banco é obrigatório.
--
-- `PARCEIROS.FIXO` não existia no destino (a carga trazia `VENC_PREV`, não o valor):
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS fixo numeric(13,2);
-- e o `ARECEBER` do destino não guardava QUEM lançou o título (o legado grava CODOPERADOR + CODOPERADORMAN):
ALTER TABLE areceber ADD COLUMN IF NOT EXISTS codoperador integer;
COMMENT ON COLUMN parceiros.fixo IS 'valor fixo mensal do cliente — a base da geração de financeiro em lote (FRMGERARFINANCEIROLOTE)';

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMGERARFINANCEIROLOTE', 'FRMGERARFINANCEIROLOTE', 7, 1),
  ('FRMGERARFINANCEIROLOTE', 'BTNGERAR',               7, 1)
ON CONFLICT DO NOTHING;
