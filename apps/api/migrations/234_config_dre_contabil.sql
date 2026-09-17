-- 234 — CONFIGURADOR DO DRE CONTÁBIL (`FRMCONFIGDRECONTABIL`, `UFrmCadConfigDREContabil.pas`).
-- **51 acessos, 3 operadores.** É o corte-2 que a migration 047 deixou declarado por escrito:
-- *"o editor da estrutura é corte-2 (aqui a estrutura é semeada, fiel ao modelo)"*.
--
-- As tabelas (`dre_estrutura`, `dre_conta`) e o motor de cálculo já existem desde a 047; entra aqui a tela
-- que edita a árvore — e é ela que define **como o DRE é somado**. Mexer aqui muda todo relatório de
-- resultado que o contador lê.
--
-- ── O que o cliente tem ───────────────────────────────────────────────────────────────────────────────
-- `CONFIG_DRE_CONTABIL`: **98 linhas em 3 níveis** — 6 raízes, 14 no nível 2, 78 no nível 3 —, **todas
-- ativas**. `VINCULO_PLC_CFG_DRE`: **10.439 vínculos** conta→linha.
--
-- ⚠️ **a classe é consequência do tipo, e o dado não deixa dúvida**: as **78** linhas `P` são todas classe
-- `A` (analíticas, recebem conta) e as **20** sintéticas (19 `F` + 1 `E`) são todas `S`. Deixar escolher
-- livre criaria uma linha analítica que nunca recebe conta, ou uma sintética que soma duas vezes.
--
-- ⚠️ existe **uma única expressão** no cliente: `<01>+<03>+<04>` no LUCRO BRUTO COMERCIAL. É a sintaxe que o
-- avaliador do `dre.service` já entende.
--
-- As travas da tela saem do que o motor de cálculo precisa para não mentir:
--   · não se apaga linha com filha, com conta vinculada ou referenciada por uma expressão — o roll-up some
--     com o ramo sem avisar e o DRE passa a fechar menor, sem nada indicando o porquê
--   · a expressão não pode referenciar a si mesma nem um código que não existe (o avaliador é recursivo)
--   · só linha analítica recebe conta, e **uma conta só pode estar em uma linha** — senão entra duas vezes
--   · o filho é sempre um nível abaixo do pai, que é o que faz o roll-up terminar
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCONFIGDRECONTABIL', 'FRMCONFIGDRECONTABIL', 7, 1),
  ('FRMCONFIGDRECONTABIL', 'BTNGRAVAR',            7, 1),
  ('FRMCONFIGDRECONTABIL', 'BTNEXCLUIR',           7, 1)
ON CONFLICT DO NOTHING;

-- ⚠️ uma conta em duas linhas analíticas entra duas vezes no DRE. O legado não trava; aqui o índice trava.
CREATE UNIQUE INDEX IF NOT EXISTS ux_dre_conta_conta ON dre_conta (codplanocontas);
