-- 112 — GESTÃO DE PROMOÇÕES (UCadPromocao) corte-1: casca (header PROMOCAO + motor de detalhe CLUBE_DESCONTO)
-- + a aba mais simples (Preço Fixo). Arquitetura fiel: 1 header + 1 detalhe compartilhado discriminado por
-- ORIGEM (uma letra por mecânica de aba). O seletor PROMOCAO.TIPO escolhe a mecânica. As colunas de payload de
-- TODAS as abas já entram aqui (as próximas cortes só as usam, sem nova migration).
-- CUIDADO: no legado CLUBE_DESCONTO é compartilhado com agenda/PDV; aqui é uma tabela PRÓPRIA do monorepo,
-- escrita SÓ por esta tela (FK idpromocao). Soft-delete só no HEADER (INDR) — divergência consciente: o legado
-- não tem INDR em PROMOCAO (hard-delete real); aqui o header é preservado, MAS os itens (clube_desconto) são
-- HARD-deletados na cascata do engine (não recuperáveis). Multi-empresa: idempresa (empresaScoped) + EMPRESAS csv.
-- CUTOVER (gap consciente): a produção usa também TIPO 'S' (perfil A/B, ORIGEM='S' — a mecânica mais comum) e 'T'
-- (compra premiada); o CHECK abaixo já os aceita p/ um import de cutover, mas o form/zod ainda não os oferece.

-- ── header ──────────────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_promocao;
CREATE TABLE IF NOT EXISTS promocao (
  idpromocao          integer PRIMARY KEY DEFAULT nextval('seq_promocao'),
  idempresa           integer NOT NULL,                    -- empresaScoped
  descricao           varchar(150),
  datainicio          timestamptz,                         -- período (data + hora; UI separa)
  datafim             timestamptz,
  empresas            varchar(50),                         -- multi-empresa CSV (fiel; ex.: '1' / '1,50')
  opcao               char(1),                             -- rebaixa: V/E/A/S/I/O
  tipo                char(1) NOT NULL,                    -- MECÂNICA: C/O/A/B/F/V/D/P/G/L/R
  destino             char(1),                             -- público: C/I/U/F/P/T
  valorcombo          numeric(15,2),                       -- combo
  tipocombo           char(1),                             -- combo: C (a cada) / M (maior que)
  valor_minimo_compra numeric(15,2),
  indr                char(1),                             -- 'E' soft-delete (engine grava indr/indr_usuario/indr_data)
  indr_usuario        integer,
  indr_data           timestamptz,
  usucadastro         integer,
  dtcadastro          timestamptz DEFAULT now(),
  usultalteracao      integer,
  dtultimalteracao    timestamptz,
  CONSTRAINT ck_promocao_tipo    CHECK (tipo    IN ('C','O','A','B','F','V','D','P','G','L','R','S','T')),
  CONSTRAINT ck_promocao_destino CHECK (destino IS NULL OR destino IN ('C','I','U','F','P','T'))
);
ALTER SEQUENCE seq_promocao OWNED BY promocao.idpromocao;
CREATE INDEX IF NOT EXISTS ix_promocao_emp ON promocao (idempresa) WHERE coalesce(indr,'I') <> 'E';

-- ── detalhe (motor por ORIGEM) ──────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_clube_desconto;
CREATE TABLE IF NOT EXISTS clube_desconto (
  idclubedesconto     integer PRIMARY KEY DEFAULT nextval('seq_clube_desconto'),
  idpromocao          integer NOT NULL REFERENCES promocao(idpromocao) ON DELETE CASCADE,
  idempresa           integer,
  loja                integer,
  origem              varchar(2),                          -- C/O/A/B/F/V/D/DF/P/G/GF/L/R (mecânica/aba)
  operacao            varchar(30),                         -- rótulo texto da operação
  idorigempromocao    integer,                             -- alvo: produto / familia / parceiro / marca
  tipo                char(1),                             -- $ (valor) / % (percentual) / NULL
  subtipo             char(1),                             -- Categoria: O/D/G/S/P/F/M
  destino             char(1),
  valor               numeric(15,2),
  valorcombo          numeric(15,2),
  tipocombo           char(1),
  quantidade          numeric(15,3),
  quantidade_paga     numeric(15,3),
  minimo              numeric(15,3),
  maximo              numeric(15,3),                        -- Lim. Venda
  maximo_estoque      numeric(15,3),                        -- Lim. Promoção
  preco_grupo         char(1),                              -- S/N (grupo de preço)
  grupo               integer,
  codigo_promocional  varchar(30),
  codperfil_parceiro  varchar(255),                         -- CSV de perfis (prefixo I/E por perfil) — real VARCHAR2(255)
  codparceiro         varchar(255),                         -- real VARCHAR2(255): CSV I/E-prefixado (não é FK inteira)
  valor_minimo_compra numeric(15,2),
  id_formas_pgto      varchar(255),                         -- real VARCHAR2(255): CSV ex.: 'I200,' / 'I1,E8,'
  data_inicio         timestamptz,
  data_fim            timestamptz,
  ativo               char(1) DEFAULT 'S',
  encerrada           char(1),
  indr                char(1),
  usucadastro         integer,
  dtcadastro          timestamptz DEFAULT now(),
  usultalteracao      integer,
  dtultimalteracao    timestamptz
);
ALTER SEQUENCE seq_clube_desconto OWNED BY clube_desconto.idclubedesconto;
CREATE INDEX IF NOT EXISTS ix_clube_desconto_promo ON clube_desconto (idpromocao, origem);

-- ── views (empresaScoped expõe idempresa) ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW get_promocao AS
SELECT p.idpromocao, p.idempresa, p.descricao, p.datainicio, p.datafim, p.empresas, p.opcao, p.tipo, p.destino,
       p.valorcombo, p.tipocombo, p.valor_minimo_compra, p.indr,
       (SELECT count(*) FROM clube_desconto c WHERE c.idpromocao = p.idpromocao AND coalesce(c.indr,'I') <> 'E') AS qtde_itens,
       p.usucadastro, p.dtcadastro, p.usultalteracao, p.dtultimalteracao
  FROM promocao p;

-- RBAC FRMCADPROMOCAO (op 7 do smoke, empresas 1 e 2).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADPROMOCAO', 'BTNGRAVAR',            7, 1),
  ('FRMCADPROMOCAO', 'BTNEXCLUIR',           7, 1),
  ('FRMCADPROMOCAO', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADPROMOCAO', 'BTNEDITAR',            7, 1),
  ('FRMCADPROMOCAO', 'BTNGRAVAR',            7, 2),
  ('FRMCADPROMOCAO', 'BTNEXCLUIR',           7, 2);
