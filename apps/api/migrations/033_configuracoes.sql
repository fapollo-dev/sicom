-- CAMADA DE CONFIG CHAVE-VALOR por empresa (`ValorConfiguracao` do legado) — subsistema genérico
-- de parametrização. `CONFIGURACOES` = catálogo global (default por CODIGO); `CONFIGURACOES_ESPECIFICAS`
-- = overrides por escopo (Empresa/Usuario/Modulo). O `CONFIGESPECIFICASPERMITIDAS` é o whitelist de
-- TIPOs que cada chave aceita como override. É onde vivem os gates fiscais que a NF consulta.
-- Corte-1: tabelas + resolver + seed das chaves que a NF lê; WIRE só `APROVEITAMENTO_CREDITO_ICMSST_NF`
-- (gate real do zeramento de crédito da F2). O corpo do resolver legado (USessao.pas) está em submódulo
-- não clonado → precedência RECONSTRUÍDA (Usuario > Empresa > Modulo > default). UI de gestão adiada.

CREATE TABLE IF NOT EXISTS configuracoes (
  id                            integer PRIMARY KEY,             -- = CONFIGURACOES.ID (legado)
  codigo                        varchar(100) NOT NULL,           -- chave natural (ValorConfiguracao('CODIGO'))
  valor                         varchar(250),                    -- default global (nullable)
  tipovalor                     varchar(20),                     -- ex.: 'S/N', 'lista', 'numero'
  descricao                     text,
  valorespossiveis              text,                            -- ex.: 'P;H|Produção;Homologação'
  config_especificas_permitidas varchar(50) NOT NULL DEFAULT '', -- whitelist ';'-sep de TIPOs (Empresa;Modulo;Usuario)
  obsoleto                      char(1) DEFAULT 'N'
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_configuracoes_codigo ON configuracoes (codigo);

CREATE TABLE IF NOT EXISTS configuracoes_especificas (
  id    integer NOT NULL REFERENCES configuracoes(id) ON DELETE CASCADE,
  tipo  varchar(30) NOT NULL,   -- 'Empresa' | 'Usuario' | 'Modulo'
  chave varchar(30) NOT NULL,   -- Empresa→CODEMPRESA · Usuario→CODOPERADOR · Modulo→nome do módulo
  valor varchar(250) NOT NULL,
  PRIMARY KEY (id, tipo, chave)
);

-- Seed das chaves fiscais que a NF consulta. Ids/defaults = CONFIGURACOES real do legado, VERIFICADOS
-- no Oracle (só as com procedência forte entram). WIRED no corte-1: APROVEITAMENTO_CREDITO_ICMSST_NF.
-- As demais chaves de gate (PERMITE_PROC_NF_ESTOQUE_NEG/ESTORNA_FINANCEIRO_NF/UTILIZA_INTEGRACAO_CONTABIL/
-- CALCULA_ICMSST_EMISSAOPROPRIA_NF_SEM_INDEX) serão seedadas COM id/default confirmados no Oracle no
-- momento de cada wire (F3b/F4b/F5b) — o resolver e o whitelist já as suportam. Não seedar id não-verificado.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (290, 'APROVEITAMENTO_CREDITO_ICMSST_NF', 'N', 'S/N', 'Modulo;Empresa', 'Aproveita o crédito de ICMS próprio em CFOP de ST na NF (S) ou zera o crédito (N). Gate do zeramento da F2 (udmNF.pas:4231/4470).'),
  (48,  'AMBIENTE_NF', 'P', 'lista', 'Empresa', 'Ambiente de emissão NFe (P=Produção/H=Homologação). ÓRFÃO no retaguarda — o ambiente real vem de NFE.TIPONFE; NÃO consumido pela NF migrada.')
ON CONFLICT (id) DO NOTHING;
-- (overrides por empresa entram via CONFIGURACOES_ESPECIFICAS quando cadastrados; nenhum no seed —
--  todas as empresas rodam no default até haver override. O smoke exercita a precedência.)
