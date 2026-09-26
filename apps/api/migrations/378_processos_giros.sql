-- 378 — PROCESSOS e a rotina GIROS (a MOVIMENTACAO_DIARIA que ninguém regenerava).
--
-- A MOVIMENTACAO_DIARIA (venda por produto e por dia: o DDE, o comparativo de mix × giros, a cobertura) é gerada no legado pela
-- procedure `GERA_MOVIMENTACAO_DIARIA`, chamada todo dia pelo processo GIROS de um executável que não está no fonte (PROCESSOS.GIROS:
-- 25/09/2026 05:33:44 → 05:40:46; a tabela vai até 24/09, o dia anterior). Conferido na produção (só leitura): a fórmula da procedure
-- reproduz a tabela em 100% das linhas de set/2026, jun/2026, jan/2026, jun/2025 e mar/2021 (o que difere: 3 linhas de 17/08/2026 com
-- venda alterada depois — a janela do processo é curta — e a loja 51, que o GIROS nunca rodou). O Apollo carregava a tabela na virada e
-- ninguém a atualizava depois: o DDE e o giro congelariam no dia da carga. A rotina agora está no `rotinas-do-banco.agendador.ts`.
--
-- PROCESSOS guarda a execução: as telas mostram "Última execução do giros" (uProdutosRel.pas:241, uAnaliseComportamento.pas:71,
-- URelAnaliseComportamentoPeriodo.pas:138) a partir de INICIOEXECUCAO. As outras linhas da tabela do legado são travas de processos do
-- PDV/servidor (ATIVACAO_ONLINE_n, MONITORNOTAFICAL…) — ficam de fora da carga; a do GIROS o Apollo mantém.
CREATE TABLE IF NOT EXISTS processos (
  nomeprocesso   varchar(100) PRIMARY KEY,
  status         integer,        -- 1 rodando · 0 terminou
  inicioexecucao timestamptz,
  fimexecucao    timestamptz,
  versao         varchar(30)
);
