-- 126 — EXPORTAR PARA BALANÇA (FRMEXPORTABALANCA — UexportaBalanca): gera os arquivos de PLU (código+preço+
-- descrição+validade) que o software das balanças Toledo (MGV) carrega. Seleção fiel (QryBusca,
-- UexportaBalanca.dfm:494): produtos balanca='S' + MULTI_PRECO.VRVENDA>0 + CHAR_LENGTH(CODBARRA)<=6 (o PLU É o
-- codbarra curto, zero-left 6), descrição = COALESCE(descricao_balanca, descricao), preço = promo-se-ativa
-- (VRPROMO se PROMOCAO='S', senão VRVENDA — mesma regra da Etiqueta), em CENTAVOS zero-left. TENANT: as 2 configs
-- vivas são TOLEDO (Prix5-N + Prix4-N), CAMPO_SETOR='balança' (codbalanca; =1 em 2497/2498 produtos), tara/receita
-- mortos. Corte-1 = TOLEDO only: TXITENS.TXT + CADASTRO.TXT + ITENSMGV.TXT (tails Prix4-N e Prix5-N), entrega =
-- DOWNLOAD no browser (o drop em D:\DADOS\BAL + CargaBalanca.bat são host-Windows, fora do web). ADIADO: Filizola
-- (código inalcançável p/ o tenant), INFNUTRI/TXINFO (faltam INTEIRAMEDIDA/PARTEDEC/USADAMEDIDA no app novo;
-- 1259 produtos têm dado nutricional no Oracle → corte-2 com ETL), TARA (0 linhas + EXPORTA_TARA='N'),
-- REDE-MGVIII/PRIX4-R (fall-through vazio no legado = cópia-fiel), config-UI (CRUD; seed via migration).

CREATE SEQUENCE IF NOT EXISTS seq_config_balanca;
CREATE TABLE IF NOT EXISTS config_balanca (
  id                  integer PRIMARY KEY DEFAULT nextval('seq_config_balanca'),
  idempresa           integer NOT NULL,
  dir_bal             varchar(100),                 -- diretório host do legado (informativo no web; entrega=download)
  tipo_bal            varchar(50) NOT NULL DEFAULT 'TOLEDO',   -- TOLEDO | FILIZOLA | AMBAS (corte-1 só TOLEDO)
  mod_bal             varchar(50),                  -- PRIX4-N | PRIX5-N | ... (rótulos do legado; desconhecido→PRIX5-N)
  export_nutricional  char(1) DEFAULT 'N',
  export_receita      char(1) DEFAULT 'N',
  campo_setor         varchar(50) DEFAULT 'BALANCA', -- BALANCA (codbalanca) | DEPARTAMENTO (coddpto)
  exporta_tara        char(1) DEFAULT 'N',
  dtcadastro          timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_config_balanca OWNED BY config_balanca.id;

-- seed = as 2 configs VIVAS do tenant (Oracle CONFIG_BALANCA 321/341; NUTRI/RECEITA='S' lá, mas corte-1 não emite
-- INFNUTRI/TXINFO — flags mantidas fiéis p/ o corte-2 ligar sem migração).
INSERT INTO config_balanca (id, idempresa, dir_bal, tipo_bal, mod_bal, export_nutricional, export_receita, campo_setor, exporta_tara) VALUES
  (321, 1, 'D:\DADOS\BAL',  'TOLEDO', 'PRIX5-N V2', 'S', 'S', 'BALANCA', 'N'), -- rótulo REAL do Oracle (fold auditoria);
                                                                               -- GetModelBal não conhece 'V2' → else → Prix5-N (igual aqui)
  (341, 1, 'D:\DADOS\BAL2', 'TOLEDO', 'PRIX4-N', 'S', 'S', 'BALANCA', 'N')
ON CONFLICT (id) DO NOTHING;
SELECT setval('seq_config_balanca', GREATEST((SELECT COALESCE(MAX(id),1) FROM config_balanca), 341));

-- ATIVO_PELA_MULTIPRECO (fold auditoria [ALTA]): decide se a seleção filtra por MULTI_PRECO.ATIVO ('S') ou
-- PRODUTOS.ATIVO (padrão). No Oracle vivo: base 'N' + override Modulo/'Todos'='S' → EFETIVO 'S' (o legado exporta
-- 1196 produtos por m.ativo; o ramo p.ativo daria 2278 = 1091 preços desativados de volta na balança). Semeia o
-- valor EFETIVO. (id 30 = id real do Oracle.)
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (30, 'ATIVO_PELA_MULTIPRECO', 'S', 'S/N', 'Modulo;Empresa', 'Filtra produto ativo pela MULTI_PRECO.ATIVO (S) ou PRODUTOS.ATIVO (N). Oracle: base N + override Modulo/Todos=S → efetivo S. Usado pela balança (UexportaBalanca.pas:90) e inventário.')
ON CONFLICT (id) DO NOTHING;

-- RBAC (operador 7, empresas 1+2).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMEXPORTABALANCA', 'BTNGRAVAR', 7, 1),
  ('FRMEXPORTABALANCA', 'BTNGRAVAR', 7, 2)
ON CONFLICT DO NOTHING;
