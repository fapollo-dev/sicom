-- 284 — REFORMA corte-7: o SPLIT PAYMENT (recolhimento na liquidação).
-- Cortes 1-6 nas migrations 278-283. Dossiê: `uCadIBSCBS.md` §18.
-- DESENVOLVIDO (novo). Mesma procedência do corte-6: o legado não tem nada disto e **não há dado do
-- cliente para conferir** — a fonte é a LC 214/2025 (arts. 31 a 35) e a aritmética está provada no smoke.
--
-- ── O que o split muda, e por que ele não é "mais um campo" ──────────────────────────────────────────
-- No regime atual o vendedor recebe o valor cheio e recolhe o imposto depois, na apuração. No split o
-- imposto é **separado no momento da liquidação financeira** e vai direto ao fisco: o vendedor recebe
-- líquido. Portanto o split não altera o imposto devido — altera **quem paga e quando**, e cria uma
-- terceira coisa no título: o valor retido.
--
--   valor do título  =  valor líquido ao fornecedor  +  IBS retido  +  CBS retido
--
-- ⚠️ E o retido ABATE o que se recolhe na apuração. Se a apuração ignorar a retenção, o contribuinte
-- **paga duas vezes**: uma no split, na liquidação, e outra na guia do período. Por isso a apuração do
-- corte-3 ganha aqui as colunas de retido, e o resultado passa a ser
--       a recolher = débito − crédito − crédito presumido − saldo anterior − **retido no split**.
--
-- ── As três modalidades da LC, e por que as três precisam existir ────────────────────────────────────
-- (a) **Inteligente** (art. 32): o prestador de serviço de pagamento consulta o valor exato do imposto
--     daquele documento e separa esse valor. É o padrão, e o percentual é irrelevante — o valor vem do
--     próprio grupo IBS/CBS já calculado (cortes 2-6).
-- (b) **Simplificada** (art. 33): quando a consulta não é possível, retém-se um **percentual do valor da
--     operação**, definido em regulamento, e a diferença se acerta na apuração.
-- (c) **Manual** (art. 34): o contribuinte informa o valor a separar — usada quando a liquidação não passa
--     por prestador de pagamento (dinheiro, compensação).
-- Uma implementação só com percentual representaria (b) e erraria (a), que é o caso normal e o único em
-- que o valor retido bate exatamente com o imposto do documento.
--
-- ── ⚠️ O que NÃO é retido ────────────────────────────────────────────────────────────────────────────
-- Só se retém o que é devido: item imune, isento, monofásico ou **suspenso** não gera retenção, porque não
-- gera imposto a pagar naquela operação. Isso sai de graça do corte-2 e do corte-6 — a retenção é
-- calculada sobre `vibs`/`vcbs` **efetivamente apurados**, e esses já são zero nesses casos. O suspenso,
-- que fica em coluna própria, é justamente o exemplo de por que não se pode retê-lo: o imposto existe,
-- mas não é devido agora.

CREATE TABLE IF NOT EXISTS split_payment_config (
  idempresa        integer PRIMARY KEY,
  modalidade       varchar(12) NOT NULL DEFAULT 'inteligente',  -- inteligente | simplificada | manual
  perc_simplificado numeric(7,4) NOT NULL DEFAULT 0,            -- usado só na modalidade simplificada
  ativo            char(1) NOT NULL DEFAULT 'N',
  vigencia_inicio  date,
  fonte            varchar(200),
  dtultimalteracao timestamptz,
  CONSTRAINT ck_split_modalidade CHECK (modalidade IN ('inteligente', 'simplificada', 'manual'))
);

-- a retenção por documento. Uma linha por nota e direção: é o que permite conferir o que o banco separou
-- contra o que a nota mandava separar.
CREATE SEQUENCE IF NOT EXISTS seq_split_payment;
CREATE TABLE IF NOT EXISTS split_payment (
  codsplit        integer PRIMARY KEY DEFAULT nextval('seq_split_payment'),
  idempresa       integer NOT NULL,
  codnf           integer NOT NULL REFERENCES nf(codnf) ON DELETE CASCADE,
  direcao         char(1) NOT NULL,                 -- E = compra (o fornecedor recebe líquido)
                                                    -- S = venda  (a empresa recebe líquido)
  modalidade      varchar(12) NOT NULL,
  valor_operacao  numeric(15,2) NOT NULL DEFAULT 0,
  ibs_retido      numeric(15,2) NOT NULL DEFAULT 0,
  cbs_retido      numeric(15,2) NOT NULL DEFAULT 0,
  valor_liquido   numeric(15,2) NOT NULL DEFAULT 0, -- operação − retido: o que de fato transita
  competencia     char(6) NOT NULL,                 -- a competência que a retenção abate
  liquidado       char(1) NOT NULL DEFAULT 'N',
  data_liquidacao timestamptz,
  codoperador     integer,
  dtcadastro      timestamptz DEFAULT now(),
  CONSTRAINT ck_split_direcao CHECK (direcao IN ('E', 'S'))
);
ALTER SEQUENCE seq_split_payment OWNED BY split_payment.codsplit;
CREATE UNIQUE INDEX IF NOT EXISTS ux_split_payment_nf ON split_payment (codnf, direcao);
CREATE INDEX IF NOT EXISTS ix_split_payment_comp ON split_payment (idempresa, competencia);

-- ⚠️ a apuração precisa descontar o retido, senão o contribuinte paga duas vezes
ALTER TABLE apuracao_ibscbs ADD COLUMN IF NOT EXISTS ibs_retido_split numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE apuracao_ibscbs ADD COLUMN IF NOT EXISTS cbs_retido_split numeric(15,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN apuracao_ibscbs.ibs_retido_split IS
  'IBS já retido na liquidação (split). ABATE o a recolher — sem isto o contribuinte pagaria duas vezes.';

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMAPURACAOIBSCBS', 'BTNSPLIT', 7, 1)
ON CONFLICT DO NOTHING;
