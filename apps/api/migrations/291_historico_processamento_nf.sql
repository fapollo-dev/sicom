-- 291 — HISTÓRICO DE PROCESSAMENTO DA NF: a auditoria de por que o custo do produto mudou.
-- Tabela viva sem destino, achada na varredura de 22/09/2026. Dossiê: `uHistoricoProcessamentoNF.md`.
-- Contagens no Oracle de produção (só leitura), 23/09/2026.
--
-- ── O que é, e por que não é o kardex ────────────────────────────────────────────────────────────────
-- O kardex (`historico_prod`, mig 248) responde **quanto** entrou e saiu de estoque. Esta tabela responde
-- outra pergunta, que ninguém mais responde no sistema: **por que o custo e o preço do produto mudaram**.
-- Cada processamento de nota grava aqui a escada de custo inteira do produto — custo, custo real, custo de
-- reposição, custo fiscal, CSI, markup, as margens e o lucro — e as flags do que o processamento alterou.
--
-- **863.582 linhas**, 128 mil só em 2026, cobrindo 5.794 produtos e 6.517 notas no ano.
--
-- ── ⚠️ CADA EVENTO GRAVA DUAS LINHAS: `PRODUTO` é o ANTES, `PROCESSAMENTO` é o DEPOIS ────────────────
-- Esta é a regra que faz a tabela valer, e ler só um dos dois dá metade da história. Os totais por ano são
-- idênticos aos pares (2026: 64.209 e 64.209; 2025: 90.101 e 90.101), porque é sempre um par.
--
-- E o par não é decorativo — medido nos **531.650 pares** completos:
--   · **191.695 (36%) mudaram o custo**, somando R$ 111.934,23 de variação;
--   · **20.330 mudaram o preço de venda**, somando R$ 585.336,06;
--   · em 2026 a variação média de custo por processamento é de **18,29%**.
--
-- É o mesmo desenho de procedência que aparece no kardex (`saldo_anterior`/`saldo_novo`) e nos pares
-- `_ORI` da reforma (mig 279): guardar só o resultado apaga a evidência de como se chegou nele.
--
-- ── As flags dizem O QUE mudou ───────────────────────────────────────────────────────────────────────
-- Na linha `PROCESSAMENTO` (a de `PRODUTO` as traz nulas, porque é o estado anterior): em 2026, **60.508
-- dos 64.209** processamentos têm `EXISTEALTERACAOCUSTO='S'` com alteração por decomposição, estoque e
-- CFOP ao mesmo tempo — ou seja, 94% dos processamentos mexem no custo, e as flags dizem por qual caminho.
--
-- ── As chaves ────────────────────────────────────────────────────────────────────────────────────────
-- `codproduto` casa em **863.582 de 863.582** (100%); `codnf` em 861.582 e `codnfprod` em 861.566 — os
-- ~2.000 órfãos são de notas que já não existem, e por isso a FK é só para `produtos`: uma FK para a nota
-- rejeitaria essas linhas e perderia o histórico do produto junto (a lição de `clube_desconto`, mig 285).

CREATE SEQUENCE IF NOT EXISTS seq_historico_processamento_nf;
CREATE TABLE IF NOT EXISTS historico_processamento_nf (
  codhistprocnf integer PRIMARY KEY DEFAULT nextval('seq_historico_processamento_nf'),
  idempresa     integer,
  -- ⚠️ 'PRODUTO' = o estado ANTES; 'PROCESSAMENTO' = o DEPOIS. Sempre em par.
  historico     varchar(20) NOT NULL,
  dthistorico   timestamptz NOT NULL,
  usuhistorico  integer,
  -- o documento e o produto. Sem FK para nf/nf_prod: ~2.000 linhas apontam nota que já não existe,
  -- e o histórico do produto vale mesmo sem ela.
  codnf         integer,
  codnfprod     integer,
  codproduto    integer NOT NULL REFERENCES produtos(idproduto) ON DELETE CASCADE,
  codparceiro   integer,
  unidade       varchar(6),
  fatorembal    numeric(15,4),
  -- a ESCADA DE CUSTO inteira, que é o motivo de a tabela existir
  vrcusto        numeric(15,4),
  vrcustoreal    numeric(15,4),
  vrcustorep     numeric(15,4),
  vrcustofiscal  numeric(15,4),
  vrcustocsi     numeric(15,4),
  vrcustoajuste  numeric(15,4),
  pmz            numeric(15,4),
  vrvenda        numeric(15,4),
  vrvendasug     numeric(15,4),
  markup         numeric(15,4),
  margeml        numeric(15,4),
  margeml2       numeric(15,4),
  margeml2v      numeric(15,4),
  -- o resultado apurado no processamento
  vendaliq       numeric(15,4),
  lucrobrutov    numeric(15,4),
  lucrobrutop    numeric(15,4),
  despopv        numeric(15,4),
  lucroliqv      numeric(15,4),
  lucroliqp      numeric(15,4),
  imprend        numeric(15,4),
  contsocial     numeric(15,4),
  -- os tributos que entraram na conta
  icme           numeric(15,4),
  icmst          numeric(15,4),
  ipi            numeric(15,4),
  vrfcpst        numeric(15,4),
  frete          numeric(15,4),
  frete2         numeric(15,4),
  seguro         numeric(15,4),
  despacessorio  numeric(15,4),
  bonificacao    numeric(15,4),
  creditoicm     numeric(15,4),
  creditopiscofins numeric(15,4),
  debitoicm      numeric(15,4),
  debitopiscofins  numeric(15,4),
  -- ⚠️ as flags do que o processamento ALTEROU (só na linha PROCESSAMENTO; nulas na de PRODUTO)
  existealteracaocusto char(1),
  alteracustodeco      char(1),
  alteracustoesto      char(1),
  alteracustocfop      char(1),
  existealteracaovenda char(1),
  alteravendaonline    char(1),
  alteravendalote      char(1),
  dtcadastro    timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_historico_processamento_nf OWNED BY historico_processamento_nf.codhistprocnf;
-- a consulta que a auditoria faz: a linha do tempo do custo de um produto
CREATE INDEX IF NOT EXISTS ix_hist_proc_nf_produto ON historico_processamento_nf (codproduto, dthistorico);
-- e a de conferência: o que esta nota mudou
CREATE INDEX IF NOT EXISTS ix_hist_proc_nf_nota ON historico_processamento_nf (codnf)
  WHERE codnf IS NOT NULL;
-- o par: casar o ANTES com o DEPOIS do mesmo item
CREATE INDEX IF NOT EXISTS ix_hist_proc_nf_par ON historico_processamento_nf (codnfprod, historico)
  WHERE codnfprod IS NOT NULL;
-- só os processamentos que de fato mexeram no custo (60.508 de 64.209 em 2026)
CREATE INDEX IF NOT EXISTS ix_hist_proc_nf_alterou ON historico_processamento_nf (codproduto, dthistorico)
  WHERE existealteracaocusto = 'S';

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMHISTPROCESSAMENTONF', 'FRMHISTPROCESSAMENTONF', 7, 1)
ON CONFLICT DO NOTHING;
