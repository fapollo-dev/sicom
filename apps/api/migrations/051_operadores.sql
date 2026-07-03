-- 051 — OPERADORES (uCadUsuarios "Cadastro de usuários"), corte-1: núcleo cadastral. Amplia o stub
-- mínimo do 049 com os campos do legado OPERADORES. O operador é GLOBAL no schema (o legado NÃO tem
-- coluna de empresa — o vínculo empresa é a ponte RELACAO_OPERADOR_EMPRESA, adiada; a coluna
-- `codempresa` do stub 049 fica vestigial/não-usada, o cadastro é global). Tudo aditivo. Senha,
-- empresas-permitidas, perfis, supervisionados e biometria = cortes seguintes; senha depende de um
-- epic de auth com HASH real (o legado usa cifra reversível — não migrar).

ALTER TABLE operadores ADD COLUMN IF NOT EXISTS login                        varchar(50);
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS tipoop                       varchar(3);  -- USU/OPE/SUP/FOR/PRO/ASU/ANS
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS idgrupo                      integer;     -- FK grupo_operador (derivado de tipoop)
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS desabilitado                 char(1) DEFAULT 'N'; -- bloqueia login
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS dtaltdesab                   timestamptz;
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS desabilita_operacoes_basicas char(1) DEFAULT 'N';
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS desabilita_desconto_pdv      char(1) DEFAULT 'N';
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS solicitar_alteracao_senha    char(1) DEFAULT 'S';
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS idsupervisor                 integer;     -- auto-ref (supervisor)
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS codigoauxiliar               integer;
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS indr                         varchar(1) DEFAULT 'I'; -- soft-delete I/E
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS indr_data                    timestamptz;
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS indr_usuario                 integer;
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS usultalteracao               integer;
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS dtultimalteracao             timestamptz;
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS dtcadastro                   timestamptz;

-- GRUPO_OPERADOR — perfil/categoria do operador (6 grupos do legado; idgrupo derivado de tipoop).
CREATE TABLE IF NOT EXISTS grupo_operador (
  idgrupo   integer PRIMARY KEY,
  descricao varchar(40) NOT NULL
);
INSERT INTO grupo_operador (idgrupo, descricao) VALUES
  (1, 'Usuário'), (2, 'Operador'), (3, 'Supervisor'), (4, 'Fornecedor'),
  (5, 'Proprietário'), (6, 'Analista de Suporte'), (7, 'Analista de Sistema')
ON CONFLICT (idgrupo) DO NOTHING;

-- LOGIN único (uCadUsuarios.pas:408 — ignora excluídos INDR='E'). Índice parcial único. ENDURECIMENTO
-- consciente: case-INsensitive (upper(login)) — o legado (RetornarValores) compara texto cru, que no
-- Oracle é case-SENSITIVE; a versão nova evita colisão "SICOM"/"sicom".
CREATE UNIQUE INDEX IF NOT EXISTS ux_operadores_login
  ON operadores (upper(login)) WHERE login IS NOT NULL AND COALESCE(indr, 'I') <> 'E';

-- enriquece o seed do stub 049 (op 7 = operador do smoke; op 8 = sem parceiro p/ a trava de quebra).
-- NÃO toca codparceiro (op7=20/op8=null preservados p/ o smoke de conferência do CAIXA).
UPDATE operadores SET login = 'SMOKE', nome = COALESCE(nome, 'OPERADOR SMOKE'), tipoop = 'OPE', idgrupo = 2, indr = 'I', ativo = COALESCE(ativo, 'S') WHERE codoperador = 7;
UPDATE operadores SET login = 'OP8',   nome = COALESCE(nome, 'OPERADOR SEM PARCEIRO'), tipoop = 'OPE', idgrupo = 2, indr = 'I' WHERE codoperador = 8;

-- View GET_OPERADORES — núcleo + JOINs de exibição (parceiro/grupo/supervisor). Expõe INDR p/ o soft-delete.
CREATE OR REPLACE VIEW get_operadores AS
SELECT
  o.codoperador, o.nome, o.login, o.tipoop, o.idgrupo, g.descricao AS grupo,
  o.codparceiro, p.razao AS parceiro, o.idsupervisor, sup.nome AS supervisor,
  o.desabilitado, o.desabilita_operacoes_basicas, o.desabilita_desconto_pdv,
  o.solicitar_alteracao_senha, o.codigoauxiliar, o.ativo,
  COALESCE(o.indr, 'I') AS indr
FROM operadores o
LEFT JOIN parceiros p       ON p.codparceiro = o.codparceiro
LEFT JOIN grupo_operador g  ON g.idgrupo = o.idgrupo
LEFT JOIN operadores sup    ON sup.codoperador = o.idsupervisor;

-- RBAC FRMCADOPERADOR (legado = FRMCADUSUARIOS; nome interno nosso). Grants op 7 empresa 1.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADOPERADOR', 'BTNGRAVAR',            7, 1),
  ('FRMCADOPERADOR', 'BTNEXCLUIR',           7, 1),
  ('FRMCADOPERADOR', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADOPERADOR', 'BTNEDITAR',            7, 1);
