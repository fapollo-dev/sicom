-- 264 — CAIXA DME (`FRMRELATORIOCAIXADME`, `uRelatorioCaixaDME.pas` 246 linhas). **9 acessos, 2 operadores**
-- (último 17/08/2026). Dossiê: `uRelatorioCaixaDME.md`.
--
-- A DME (IN RFB 1.761/2017): operações liquidadas em ESPÉCIE, por pessoa, a partir de R$ 30.000 no mês. A
-- tela soma o CAIXA com `TIPORECURSO='DINHEIRO'` por parceiro NÃO funcionário (`CODPARCEIRO<>0`,
-- `FUN<>'S'`), separa ARECEBER (Σ>0) de APAGAR (Σ<0) pelo sinal e mantém quem passa de `ABS(Σ) > 30.000`
-- no período escolhido. Sintético (uma linha por parceiro × tipo) ou analítico (todos os lançamentos de
-- quem passou). O CNPJ/CPF vem de `PARCEIROS_END`.
--
-- ── O que o dado diz (produção, 18/09/2026) ─────────────────────────────────────────────────────────────
--  · 2026 até hoje, loja 1: 5 fornecedores passam (APAGAR, R$ 478 mil) e 3 clientes (ARECEBER, R$ 525 mil —
--    um deles, JF SUPERMERCADOS, R$ 461 mil recebidos e R$ 44 mil pagos); loja 2: 1 + 2. 2025: 6+2 e 2+2.
--  · `TIPORECURSO` tem a variante **'1 - DINHEIRO'** (1.636 lançamentos em 2026) além de 'DINHEIRO'
--    (10.055): a tela ignora a variante. Aqui as duas contam — dinheiro é dinheiro para a RFB; em 2026 isso
--    não muda quem passa (0 parceiros cruzam só com a variante).
--  · 8.618 lançamentos em dinheiro de 2026 (R$ 3,9 mi) não têm parceiro (CODPARCEIRO 0/nulo) — invisíveis
--    à DME por construção; aqui vêm em `totais.semParceiro` para quem declara saber que existem.
--  · `LEFT JOIN PARCEIROS_END` sem filtro: 24 parceiros têm 2+ endereços (1 cai no recorte de 2026) — a linha
--    dobra e a SOMA dobra. Aqui o endereço é um só (o padrão; senão, o de menor código).
--  · Multi-empresa por `IDEMPRESA IN (...)`; aqui tenant-scoped.
CREATE INDEX IF NOT EXISTS ix_caixa_tiporecurso_data ON caixa (idempresa, tiporecurso, data);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELATORIOCAIXADME', 'FRMRELATORIOCAIXADME', 7, 1)
ON CONFLICT DO NOTHING;
