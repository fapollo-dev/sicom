-- 292 — A ESTEIRA DA NOTA: as dez etapas do manifesto à devolução.
-- Última tabela viva com valor sem destino. Dossiê: `uNfStatusProcesso.md`.
-- Contagens no Oracle de produção (só leitura), 23/09/2026.
--
-- ── O que é ──────────────────────────────────────────────────────────────────────────────────────────
-- `NF_STATUS_PROCESSO` tem **440.571 linhas** para **44.054 chaves de NF-e**: são sempre as MESMAS DEZ
-- etapas por nota, na mesma ordem, e cada uma com o seu status. É o workflow de entrada de mercadoria
-- inteiro, e ele começa **antes de a nota existir no sistema** — a chave casa com `nfe_nao_cadastradas`
-- em 438.731 linhas e com `nf` em 420.769, porque a nota chega pelo manifesto e só vira NF mais adiante.
--
--   ordem  processo              o que é
--     1    stManifesto           Manifesto Destinatário
--     2    stCiencia             Ciência da operação
--     3    stCruzamentoPedido    Cruzamento com pedido de compra
--     4    stConfirmacaoOp       Confirmação da operação
--     5    stRepasseItens        Lançamento de nota fiscal, repasse
--     6    stColeta              Coleta
--     7    stConferencia         Conferência (coleta)
--     8    stProcessarFaturar    Processar, Faturar
--     9    stGerarFinanceiro     Gerar financeiro
--    10    stDevolucao           Devolução
--
-- Cada etapa aparece 44.057 vezes (a de ciência, 44.058): a esteira é criada inteira quando a nota é
-- manifestada, e as etapas vão sendo marcadas conforme acontecem.
--
-- ── ⚠️ `P` (PENDENTE) NÃO TEM DATA, E ISSO É O ESTADO — NÃO FALTA DE DADO ────────────────────────────
-- Status no cliente: **R** (realizado) 237.036 · **P** (pendente) **201.557** · **A** 1.978.
-- As 201.557 linhas pendentes têm `DATAPROCESSO` **nula** — e tem de ser assim: a etapa foi criada e
-- ainda não aconteceu. Preencher a data com a criação da esteira afirmaria que a etapa ocorreu; deixar a
-- linha de fora perderia a informação de que ela **está prevista e parada**. É por isso que a coluna de
-- data é nullable aqui e o índice de pendência não a usa.
--
-- É também o que dá valor operacional à tabela: com 44 mil notas × 10 etapas, a pergunta que importa é
-- **em que etapa cada nota travou** — e ela só tem resposta porque o pendente é registrado.
--
-- ── A chave é a CHAVE DE ACESSO, não o codnf ─────────────────────────────────────────────────────────
-- A esteira acompanha a nota desde o manifesto, quando ela ainda não tem `codnf`. Por isso a tabela é
-- indexada por `chavenfe` e **não tem FK para `nf`**: 19.802 linhas (4,5%) são de notas que nunca viraram
-- NF no sistema — manifestadas, talvez recusadas, e a esteira delas é justamente o registro disso.
-- Uma FK rejeitaria essas linhas e apagaria o histórico do que NÃO entrou, que é metade do que a
-- conferência de entrada precisa saber.

CREATE SEQUENCE IF NOT EXISTS seq_nf_status_processo;
CREATE TABLE IF NOT EXISTS nf_status_processo (
  codnfstatuspro integer PRIMARY KEY DEFAULT nextval('seq_nf_status_processo'),
  idempresa      integer NOT NULL,
  -- ⚠️ a chave é a CHAVE DE ACESSO: a esteira começa antes de a nota existir. Sem FK para `nf`.
  chavenfe       varchar(44) NOT NULL,
  ordem          integer NOT NULL,
  processo       varchar(40) NOT NULL,
  processo_desc  varchar(120),
  -- R = realizado · P = pendente (sem data, de propósito) · A = outro estado do legado
  status         char(1) NOT NULL DEFAULT 'P',
  -- ⚠️ NULA quando pendente: a etapa está prevista e não aconteceu. Não preencher com a criação.
  dataprocesso   timestamptz,
  codoperador    integer,
  dtcadastro     timestamptz DEFAULT now(),
  CONSTRAINT ck_nf_status_processo_status CHECK (status IN ('R', 'P', 'A'))
);
ALTER SEQUENCE seq_nf_status_processo OWNED BY nf_status_processo.codnfstatuspro;
-- a esteira de uma nota, na ordem
CREATE UNIQUE INDEX IF NOT EXISTS ux_nf_status_processo
  ON nf_status_processo (idempresa, chavenfe, ordem);
-- ⚠️ o painel que importa: onde as notas estão PARADAS. Não usa a data, porque pendente não tem data.
CREATE INDEX IF NOT EXISTS ix_nf_status_processo_pendente
  ON nf_status_processo (idempresa, ordem, processo) WHERE status = 'P';
CREATE INDEX IF NOT EXISTS ix_nf_status_processo_data
  ON nf_status_processo (idempresa, dataprocesso) WHERE dataprocesso IS NOT NULL;

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMNFSTATUSPROCESSO', 'FRMNFSTATUSPROCESSO', 7, 1)
ON CONFLICT DO NOTHING;
