-- 142 — SANGRIAS/SUPRIMENTOS (rel 04) e HISTÓRICO/LIBERAÇÕES DO PDV (rel 05, e a base das rel 28/30/32).
--
-- 1) HIST_SANGRIA_SUPRIMENTO — o razão das sangrias e suprimentos do caixa. 34.087 linhas no golden
--    (32.511 SAN + 1.576 SUP). A rel 04 do legado tem DUAS gerações e escolhe EM RUNTIME consultando
--    USER_TAB_COLUMNS: se esta tabela existe, usa-a; senão cai no fallback via CX_VENDAS. No tenant ela EXISTE
--    ⇒ portamos SÓ a geração viva (o fallback é o caminho morto da pré-migração do próprio legado).
--    Colunas do subset da rel 04 + as de conferência/lote (FECHADO/AUTENTICADO) que o fechamento de tesouraria
--    usa — vieram porque são o ESTADO do documento, não enfeite.
CREATE TABLE IF NOT EXISTS hist_sangria_suprimento (
  codhistsangria integer PRIMARY KEY,
  idempresa      integer NOT NULL,
  data           timestamptz,
  idpgto         integer,
  codpdv         integer,          -- ⚠️ a rel 04 junta PDV por B.CODPDV = A.CODPDV (≠ da rel 07, que usa NROPDV)
  descricao      varchar(100),     -- o "motivo" digitado (DESCRICAO_HIST na grade)
  nrodocumento   varchar(100),
  valor          numeric(15,2),
  chave          varchar(14),      -- sessão de caixa (mesmo leiaute da mig 140)
  codoperador    integer,
  responsavel    integer,
  tipo           varchar(3),       -- 'SAN' | 'SUP'
  fechado        char(1),
  autenticado    char(1)
);
CREATE INDEX IF NOT EXISTS ix_hist_sangria_empresa_data ON hist_sangria_suprimento (idempresa, data);

-- 2) HISTORICO_PDV — o log de eventos do PDV: liberações de supervisor, cancelamentos (rel 28/30), descontos
--    (rel 32), troca de cliente. 284.609 linhas no golden. MOTIVO é quase todo nulo (283.998/284.609) e
--    RESPONSAVEL quase todo preenchido (14 nulos) — o COALESCE(RESPONSAVEL, USUARIO) da rel 05 existe p/ esses 14.
CREATE TABLE IF NOT EXISTS historico_pdv (
  idhistorico    integer PRIMARY KEY,
  idempresa      integer NOT NULL,
  codpdv         integer,
  historico      varchar(200),
  responsavel    varchar(60),
  usuario        varchar(60),
  codparceiro    integer,
  data           timestamptz,
  nrocupom       integer,
  old_codparceiro integer,
  chave          varchar(14),
  nroitem        integer,
  nropedido      varchar(20),
  tipo           varchar(20),
  motivo         varchar(200),
  liberadopor    char(1)
);
CREATE INDEX IF NOT EXISTS ix_historico_pdv_empresa_data ON historico_pdv (idempresa, data);
CREATE INDEX IF NOT EXISTS ix_historico_pdv_cupom        ON historico_pdv (idempresa, nrocupom);

-- Sem RBAC novo: variantes do hub (gate da mig 130).
