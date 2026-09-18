-- 263 — EXTRATO DE FUNCIONÁRIO (`FRMRELFUNCIONARIO`, `URelFuncionario.pas` + `UFuncionario.pas`).
-- **9 acessos, 4 operadores.** Dossiê: `uRelFuncionario.md`.
--
-- O extrato do convênio de funcionários: por funcionário (parceiro FUN='S'), os DÉBITOS (ARECEBER: compras
-- no convênio, quebras de caixa, estornos) e os CRÉDITOS (APAGAR: adiantamentos, acertos), no período, por
-- convênio (`PARCEIROS.CODCONVENIO`) e por operador (`OPERADORES.CODPARCEIRO` do funcionário). Três saídas:
-- "1 - Extrato" (sintético por funcionário × tipo × dia, com sinal), "2 - analítico" (linha a linha, com
-- centro de custo) e "3 - sintético" (o mesmo SQL do analítico com o .fr3 agrupado).
--
-- ── Regras do fonte (UFuncionario.pas) ────────────────────────────────────────────────────────────────────
--  · TIPO vem do TEXTO da OBS: 'CONTA ORIGINADA DE VENDAS'→Compras · 'ADIANTAMENTO' · 'QUEBRA' ·
--    'ESTORNO%INDEVIDO' · senão 'Convênio de Funcionários'. No analítico, TIPO = descrição do PLC (AR por
--    CODPLC; AP por CODPLCFUNCIONARIOS), senão a OBS, senão 'Convênios de funcionários'.
--  · AP entra com sinal '+' (a favor do funcionário), AR com '−'. Exclui agrupados: AR `AGRUPADO<>'S'`;
--    AP `AGRUPADO<>'S' AND CODCXAGRUPAMENTOCR=0`.
--  · Operador do funcionário = `MAX(CODOPERADOR)` entre os operadores ATIVOS do parceiro.
--  · Situação: quitados / abertos / todos (QUITADA). Filtro de tipo: o mesmo LIKE na OBS.
--  · O terceiro ramo do UNION lê `AGRUPARECEBER` — **0 linhas na produção** (nunca usada): não replicado.
--
-- ── O que o dado diz (produção, 18/09/2026) ─────────────────────────────────────────────────────────────
--  · Funcionários: 1.271 (FUN='S'), em 21 convênios; 386 parceiros CON='S'.
--  · 2026: AR de funcionários **10.109** títulos — **7.490 (74%, R$ 314 mil) com AGRUPADO='S'**, fora do
--    extrato por regra; ficam 2.619 (R$ 175 mil). AP: 185 títulos (R$ 530 mil), 30 agrupados.
--  · Dos AR que ficam, 152 têm OBS nula (R$ 82 mil) → caem em 'Convênio de Funcionários': são os títulos
--    consolidados do agrupamento. O "tipo" do extrato depende de texto livre — aqui igual, documentado.
--  · **Sem filtro de empresa** (`FiltraEmpresa := False`): AP de funcionários em 2026 está em 4 empresas
--    (1: 136 · 2: 22 · 50: 9 · 52: 19) e AR em 2 (1: 1.849 · 2: 769). Aqui tenant-scoped.
--  · 7 parceiros têm 2+ operadores ativos — o MAX escolhe um arbitrário; aqui idem, e vem `operadores` (n).
-- Colunas do legado que o destino não tinha:
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS codcxagrupamentocr integer;
ALTER TABLE apagar ADD COLUMN IF NOT EXISTS codplcfuncionarios integer;

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELFUNCIONARIO', 'FRMRELFUNCIONARIO', 7, 1)
ON CONFLICT DO NOTHING;
