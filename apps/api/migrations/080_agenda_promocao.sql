-- 080 — AGENDA DE PROMOÇÃO (uCadAgendaPromocao) corte-1: NÚCLEO do cadastro (header + itens), SEM efeito.
--
-- O sistema REAL de promoção do legado (golden: AGENDA_PROMOCAO 2.027 / AGENDA_PROMOCAO_ITENS 23.666 —
-- vs a PROMOCAO combo, 38). Uma AGENDA é uma campanha nomeada com PERÍODO (data+hora) e N itens (produto +
-- preço promocional + ativo + preço-clube + qtd-máx + flags de mídia). A APLICAÇÃO do preço (UPDATE
-- MULTI_PRECO SET PROMOCAO/VRPROMO, uCadAgendaPromocao:247/746) é o corte-2; o efeito no PDV/etiqueta é adiado.
--
-- empresaScoped (idempresa carimbado). O escopo MULTI-EMPRESA (AGENDA_PROMOCAO_EMPRESA, item.EMPRESAS CSV) =
-- ADIADO, consistente com a decisão de adiar leitura cross-empresa (cross-docking). Soft-delete por INDR.

CREATE SEQUENCE IF NOT EXISTS seq_agenda_promocao;
CREATE TABLE IF NOT EXISTS agenda_promocao (
  codagenda          integer PRIMARY KEY DEFAULT nextval('seq_agenda_promocao'),
  idempresa          integer NOT NULL,
  nomepromo          varchar(200),
  dtiniciopromocao   timestamptz NOT NULL,           -- início (data+hora, fiel ao legado)
  dtfimpromocao      timestamptz NOT NULL,            -- fim (data+hora)
  flagpromocao       char(1) DEFAULT 'J',             -- estado do legado ('J' agendada = norma; 'N')
  opcoes             integer,
  obs                text,
  dtencerramento     timestamptz,                     -- workflow: encerrada (null = aberta)
  codoperadorenc     integer,                         -- operador que encerrou
  usucadastro        integer,
  dtcadastro         timestamptz DEFAULT now(),
  usultalteracao     integer,
  dtultimalteracao   timestamptz,
  indr               varchar(1) DEFAULT 'I',          -- soft-delete (I incluído / E excluído)
  indr_usuario       integer,
  indr_data          timestamptz
);
ALTER SEQUENCE seq_agenda_promocao OWNED BY agenda_promocao.codagenda;
CREATE INDEX IF NOT EXISTS ix_agenda_promocao_emp ON agenda_promocao (idempresa);
CREATE INDEX IF NOT EXISTS ix_agenda_promocao_periodo ON agenda_promocao (dtiniciopromocao, dtfimpromocao);

CREATE SEQUENCE IF NOT EXISTS seq_agenda_promocao_itens;
CREATE TABLE IF NOT EXISTS agenda_promocao_itens (
  codagendaitem      integer PRIMARY KEY DEFAULT nextval('seq_agenda_promocao_itens'),
  codagenda          integer NOT NULL REFERENCES agenda_promocao(codagenda),
  nroitem            integer,
  idproduto          integer NOT NULL REFERENCES produtos(idproduto),
  vlrpromocao        numeric(15,4) NOT NULL,          -- preço promocional
  vrvenda            numeric(15,4),                    -- snapshot do preço normal no momento do agendamento
  ativo              char(1) DEFAULT 'S',              -- item participa da promoção
  dtativo            timestamptz,
  vrclube_fidelidade numeric(15,4) DEFAULT 0,          -- preço clube de fidelidade
  maximo             numeric(15,3),                    -- qtd máx por venda (efeito no PDV, adiado)
  vlr_min_compra     numeric(15,2),
  tv                 char(1) DEFAULT 'N',              -- flags de mídia (publicação, adiado)
  radio              char(1) DEFAULT 'N',
  tabloide           char(1) DEFAULT 'N',
  interno            char(1) DEFAULT 'N'
);
ALTER SEQUENCE seq_agenda_promocao_itens OWNED BY agenda_promocao_itens.codagendaitem;
CREATE INDEX IF NOT EXISTS ix_agenda_promocao_itens_agenda ON agenda_promocao_itens (codagenda);
CREATE INDEX IF NOT EXISTS ix_agenda_promocao_itens_produto ON agenda_promocao_itens (idproduto);

-- View de lista/pesquisa: header + qtde de itens + SITUAÇÃO derivada (ENCERRADA / VIGENTE / AGENDADA / EXPIRADA).
CREATE OR REPLACE VIEW get_agenda_promocao AS
SELECT
  ap.codagenda AS codigo,
  ap.codagenda,
  ap.idempresa,
  ap.nomepromo,
  ap.dtiniciopromocao,
  ap.dtfimpromocao,
  ap.flagpromocao,
  ap.opcoes,
  ap.obs,
  ap.dtencerramento,
  ap.codoperadorenc,
  ap.indr,
  CASE
    WHEN ap.dtencerramento IS NOT NULL THEN 'ENCERRADA'
    WHEN now() < ap.dtiniciopromocao THEN 'AGENDADA'
    WHEN now() > ap.dtfimpromocao THEN 'EXPIRADA'
    ELSE 'VIGENTE'
  END AS situacao,
  COALESCE((SELECT COUNT(*) FROM agenda_promocao_itens i WHERE i.codagenda = ap.codagenda), 0) AS qtde_itens
FROM agenda_promocao ap;

-- RBAC (form próprio da tela).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMAGENDAPROMOCAO', 'BTNGRAVAR', 7, 1), ('FRMAGENDAPROMOCAO', 'BTNGRAVAR', 7, 2),
  ('FRMAGENDAPROMOCAO', 'BTNEXCLUIR', 7, 1), ('FRMAGENDAPROMOCAO', 'BTNEXCLUIR', 7, 2),
  ('FRMAGENDAPROMOCAO', 'BTNADICIONARREGISTRO', 7, 1), ('FRMAGENDAPROMOCAO', 'BTNADICIONARREGISTRO', 7, 2),
  ('FRMAGENDAPROMOCAO', 'BTNEDITAR', 7, 1), ('FRMAGENDAPROMOCAO', 'BTNEDITAR', 7, 2),
  ('FRMAGENDAPROMOCAO', 'BTNENCERRAR', 7, 1), ('FRMAGENDAPROMOCAO', 'BTNENCERRAR', 7, 2)
ON CONFLICT DO NOTHING;
