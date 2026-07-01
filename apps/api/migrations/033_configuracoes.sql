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

-- Seed das chaves fiscais que a NF consulta. Ids/defaults/whitelist = CONFIGURACOES real do PINHEIRAO,
-- CONFRONTADOS no Oracle (golden 2026-06-30). WIRED no corte-1:
--   APROVEITAMENTO_CREDITO_ICMSST_NF (id 290, 'N', wl 'Modulo;Empresa' — gate do zeramento de crédito de ST, F2);
--   PERMITE_PROC_NF_ESTOQUE_NEG (id 84, 'S', wl 'Modulo;Empresa;Grupo;Usuario' — gate do bloqueio de estoque
--     negativo na F3, udmNF.pas:11643; default 'S' = PERMITE, fiel ao legado);
--   AMBIENTE_NF (id 48, 'P', 'Empresa'; ÓRFÃO — o ambiente real vem de NFE.TIPONFE; override real emp.1='H').
-- As demais chaves de gate JÁ ESTÃO CONFIRMADAS no Oracle p/ o wire respectivo (não seedar às cegas):
--   ESTORNA_FINANCEIRO_NF ...................... id 4,   default 'N', wl 'Modulo;Empresa;Grupo;Usuario' (F4b)
--   UTILIZA_INTEGRACAO_CONTABIL ............... id 100, default 'N', wl 'Modulo;Empresa' (+ Modulo/Retaguarda='S') (F5b)
--   CALCULA_ICMSST_EMISSAOPROPRIA_NF_SEM_INDEX  id 291, default 'N', wl 'Modulo;Empresa' (F2b)
-- (o escopo 'Grupo' do whitelist ainda NÃO é implementado no resolver — só Usuario/Empresa/Modulo/default.)
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (290, 'APROVEITAMENTO_CREDITO_ICMSST_NF', 'N', 'S/N', 'Modulo;Empresa', 'Aproveita o crédito de ICMS próprio em CFOP de ST na NF (S) ou zera o crédito (N). Gate do zeramento da F2 (udmNF.pas:4231/4470).'),
  (84,  'PERMITE_PROC_NF_ESTOQUE_NEG', 'S', 'S/N', 'Modulo;Empresa;Grupo;Usuario', 'Permite processar/reverter NF deixando saldo de estoque NEGATIVO (S, default legado) ou bloqueia (N). Gate da F3 (udmNF.pas:11643). Override por senha (UsuarioAutorizouComSenha, uNF:11659) e escopo Grupo adiados.'),
  (48,  'AMBIENTE_NF', 'P', 'lista', 'Empresa', 'Ambiente de emissão NFe (P=Produção/H=Homologação). ÓRFÃO no retaguarda — o ambiente real vem de NFE.TIPONFE; NÃO consumido pela NF migrada.')
ON CONFLICT (id) DO NOTHING;
-- (overrides por empresa entram via CONFIGURACOES_ESPECIFICAS quando cadastrados; nenhum no seed —
--  todas as empresas rodam no default até haver override. O smoke exercita a precedência.)
