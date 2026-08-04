-- 136 — ESTRUTURA do CAIXA D.R.E. (FRMRELATORIOCAIXA, 495 acessos / 6 operadores) — etapa 1 de 2.
-- O relatório é uma DRE de CAIXA sobre o plano de contas GERENCIAL (`plc`, já migrado na mig 029 com a hierarquia
-- `desccodplc` '1.' → '1.01.' → '1.01.001'). Esta etapa traz só as ESTRUTURAS que faltavam; a DRE em si (rateio
-- das despesas + receitas + vendas à vista) é a etapa 2.
--
-- O recon mostrou que o buraco era maior que "as views que faltam": as 3 views do legado
-- (GET_ARECEBERBX/GET_CARTAOBX/GET_CHEQUEBX) **não** precisam ser portadas — a DRE usa 3-4 colunas de cada e
-- todas saem de tabelas já migradas (`areceber_bx`, `cartao`) com a lógica de juros/tolerância já feita nos
-- serviços de baixa. O que faltava de verdade eram estas 4 tabelas:
--
-- 1) CAIXA — o LIVRO-CAIXA. 121.684 linhas desde 2012-09-30, 34 das 36 colunas populadas. É tabela financeira
--    CENTRAL (não um acessório do relatório): é o razão de caixa por conta gerencial. O `caixa_mov` da mig 048 é
--    outro modelo (movimento da SESSÃO de caixa: codcaixa/especie/recurso), não substitui este.
--    MORTAS no golden, não criadas: STATUS (0) e CODMAPADESP (0).
-- 2) CX_APAGAR — 24.512 linhas: o RATEIO do título a pagar por CENTRO DE CUSTO (`codcc` → plc.codplc), com
--    23.176 grupos distintos. É o coração das DESPESAS da DRE: o valor pago é apropriado por conta na proporção
--    de C.VALOR sobre o total da NF (ou do grupo). Já estava marcada como adiada na mig 029.
-- 3) PDV (27) e 4) CONTACORRENTE (266) — o mapa PDV × forma de pagamento → conta gerencial, que é como a DRE
--    encontra as VENDAS À VISTA (o legado varre CONTACORRENTE onde formas_pgto.destino='CXA').

-- 1) PDV — os terminais. Chave natural CODPDV (digitada no legado).
CREATE TABLE IF NOT EXISTS pdv (
  codpdv           integer PRIMARY KEY,
  nropdv           integer,                       -- número do PDV (o que aparece no cupom)
  descricao        varchar(20),
  codempresa       integer,
  nroserie         varchar(30),
  modelo           varchar(50),
  codcontabil_deb  integer,                       -- contas contábeis do terminal (integração)
  codcontabil_cred integer,
  codplanocontas   integer,
  modelo_ecf       varchar(100),
  marca_ecf        varchar(100),
  tipo_ecf         varchar(100),
  versao_sb        varchar(10),
  versao_cniee     varchar(6),
  hashpaf          varchar(32),
  dt_inst_sb       timestamptz,
  hr_inst_sb       timestamptz,
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz
);
CREATE INDEX IF NOT EXISTS ix_pdv_empresa ON pdv (codempresa);

-- 2) CONTACORRENTE — PDV × forma de pagamento → conta gerencial. É o roteamento que a DRE usa p/ achar a venda
-- à vista (cruzando com formas_pgto.destino='CXA'). Nome do legado preservado, apesar de enganoso: não é conta
-- corrente bancária (essa é `contas_bancarias`).
CREATE TABLE IF NOT EXISTS contacorrente (
  codcontacorrente integer PRIMARY KEY,
  codpdv           integer REFERENCES pdv(codpdv),
  idpgto           integer REFERENCES formas_pgto(idpgto),
  codplc           integer REFERENCES plc(codplc)
);
CREATE INDEX IF NOT EXISTS ix_contacorrente_plc ON contacorrente (codplc);

-- 3) CX_APAGAR — rateio do título a pagar por centro de custo (plc). `tipo`/`idsituacao_nf` acompanham o legado.
CREATE TABLE IF NOT EXISTS cx_apagar (
  codcxapagar      integer PRIMARY KEY,
  codapg           integer REFERENCES apagar(codapg) ON DELETE CASCADE,
  codcc            integer REFERENCES plc(codplc),   -- = CENTRO DE CUSTO (mesma semântica de nf_contabil.codcc)
  valor            numeric(13,2),
  codgrupo         integer,                          -- agrupamento de títulos (divisor do rateio quando não há NF)
  tipo             char(1),
  idsituacao_nf    integer,
  dtultimalteracao timestamptz
);
CREATE INDEX IF NOT EXISTS ix_cx_apagar_apg    ON cx_apagar (codapg);
CREATE INDEX IF NOT EXISTS ix_cx_apagar_grupo  ON cx_apagar (codgrupo) WHERE codgrupo IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cx_apagar_cc     ON cx_apagar (codcc);

-- 4) CAIXA — o LIVRO-CAIXA (razão de caixa por conta gerencial). Sem FK nas colunas de alto volume
-- (codparceiro/codnf/codrcb): é tabela de CARGA e a ordem do cutover não é garantida; a integridade vem do ETL.
-- FK só em `codplc`, que é catálogo pequeno e é a dimensão da DRE.
CREATE TABLE IF NOT EXISTS caixa (
  codcx                  integer PRIMARY KEY,
  data                   timestamptz NOT NULL,      -- data do lançamento (a dimensão de tempo da DRE)
  valor                  numeric(13,2) NOT NULL,    -- SINAL importa: a DRE usa ABS() por perna
  vrtitulo               numeric(13,2),
  obs                    varchar(255),
  operador               integer,
  codplc                 integer REFERENCES plc(codplc),  -- conta gerencial (100% populada no golden)
  idempresa              integer NOT NULL,
  tiporecurso            char(1),                   -- espécie do recurso
  codconta               integer,                   -- conta bancária (quando o recurso é banco)
  codparceiro            integer,
  codnf                  integer,
  nrparcela              integer,
  codgrupo               integer,
  dtvenc                 date,
  gfat                   char(1),
  gerado                 char(1),
  codpdv                 integer,
  codfiscalcx            integer,
  codrcb                 integer,
  contabilizado          char(1),
  idlote                 integer,
  idlotebxcartao         integer,
  codscrap               integer,
  chave                  varchar(60),
  idsituacao_nf          integer,
  neutra                 char(1),
  cadastrado_manualmente char(1),
  codcxapagar            integer,
  bonificado             char(1),
  origem                 varchar(10),
  idorigem               integer,
  codhistsangria         integer,
  formapgto              integer,
  usultalteracao         integer,
  dtultimalteracao       timestamptz,
  dtcadastro             timestamptz
);
-- a DRE varre por (empresa, data) e agrupa por conta: o índice espelha exatamente esse caminho.
CREATE INDEX IF NOT EXISTS ix_caixa_empresa_data ON caixa (idempresa, data);
CREATE INDEX IF NOT EXISTS ix_caixa_plc          ON caixa (codplc);
CREATE INDEX IF NOT EXISTS ix_caixa_grupo        ON caixa (codgrupo) WHERE codgrupo IS NOT NULL;

-- RBAC do relatório (etapa 2 usa) — as opções reais do Oracle p/ o form.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELATORIOCAIXA', 'FRMRELATORIOCAIXA', 7, 1),
  ('FRMRELATORIOCAIXA', 'FRMRELATORIOCAIXA', 7, 2)
ON CONFLICT DO NOTHING;
