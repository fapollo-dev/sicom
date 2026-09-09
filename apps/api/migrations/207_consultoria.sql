-- 207 — CONSULTORIA APOLLO (`FRMCONSULTORIAATM`). Dossiê: `uConsultoriaATM.md`.
-- 440 acessos. A tela não tem lista fixa de relatórios: varre `Relatorios\at&m_*.fr3` e monta o combo com o
-- que achar (`uConsultoriaATM.pas:389`). Em produção são **15 layouts distintos**, todos sobre participação e
-- rentabilidade por nível da árvore de famílias — por isso o corte-1 porta O CÁLCULO, parametrizado pelo
-- nível, em vez de um relatório de cada vez.
--
-- Nada de schema é preciso: `vendas`, `produtos` e `familias_prod` já têm todas as colunas do cálculo. Só o
-- gate de acesso.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES ('FRMCONSULTORIAATM', 'FRMCONSULTORIAATM', 7, 1)
ON CONFLICT DO NOTHING;
