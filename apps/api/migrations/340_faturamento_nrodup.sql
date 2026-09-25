-- 340 — FATURAMENTO DA NOTA, corte A: a nota volta a gravar as PARCELAS (FATURAMENTO) e o botão "Gerar sequência de duplicatas"
-- (btnGerarSeqFinClick, uNF.pas:2856) tira o próximo número do gerador do legado, `GetID('NRODUP')` — a sequência Oracle
-- ID_NRODUP (1081 na produção em 25/09/2026). Só a NF a usa, e nenhuma duplicata gravada na produção tem a forma que ela gera
-- (`<nº><aa><letra>`, modelo 1 sem separador: 0 linhas em FATURAMENTO) — então não há dado de onde a carga reposicionar a
-- sequência; ela nasce no 1 e segue dali.
CREATE SEQUENCE IF NOT EXISTS seq_nrodup START 1;
