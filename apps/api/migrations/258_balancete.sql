-- 258 — BALANCETE DE VERIFICAÇÃO (`FRMRELBALANCETE`, `uRelBalancete.pas` 384 linhas). **14 acessos, 4 operadores.**
--
-- Por conta do plano: saldo anterior (Σ débitos − Σ créditos antes do período), débitos e créditos do período e
-- saldo atual; faixa de contas, nível máximo, "descrições em degrau", imprimir analíticas, sintéticas em negrito
-- e "imprimir contas sem movimento". O legado monta a partir de `DIARIO` (1,77 milhão de lançamentos; 131 mil
-- em 2026) e `PLANO_CONTAS`, e faz o ROLL-UP das contas sintéticas em memória: para cada nível de baixo para
-- cima, soma nos pais os filhos por `CODPAI`.
--
-- ── ⚠️ O roll-up do legado só anda sobre contas com NIVEL preenchido — e são 387 de 11.028 ─────────────
-- `PLANO_CONTAS.NIVEL` está **NULL em 10.641** contas (todas analíticas, código de 15 posições
-- `2.1.01.01.NNNNN`). Das **658 contas com lançamento** no cliente, **520 não têm nível** — o `for vNivel :=
-- vUltimoNivel-1 downto 1` nunca as visita, e os totais dos pais ficam sem a maior parte do movimento.
-- Aqui o nível sai do **código expandido** (1 → nível 1, `1.1` → 2, `1.1.01` → 3, `1.1.01.01` → 4, 15 posições →
-- 5), e o roll-up é por PREFIXO do código — alcança as 11.028 contas, com ou sem NIVEL.
--
-- ── Folds ───────────────────────────────────────────────────────────────────────────────────────────────
--  • Tenant-scoped (o legado monta `D.CODEMPRESA IN (lista)`). O plano é global.
--  • "Degrau" e "negrito" são apresentação do `.fr3`; o retorno traz `nivel` e `sintetica` para a tela desenhar.

CREATE INDEX IF NOT EXISTS ix_diario_emp_datalan ON diario (codempresa, datalan);
CREATE INDEX IF NOT EXISTS ix_diario_contadebito ON diario (contadebito);
CREATE INDEX IF NOT EXISTS ix_diario_contacredito ON diario (contacredito);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELBALANCETE', 'FRMRELBALANCETE', 7, 1)
ON CONFLICT DO NOTHING;
