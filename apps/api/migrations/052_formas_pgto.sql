-- 052 — FORMAS DE PAGAMENTO (uCadFormaPgto), corte-1: cadastro (núcleo + integração + flags).
-- Modalidades por IDEMPRESA (empresaScoped no engine). Traz os 3 VÍNCULOS que destravam o Caixa
-- corte-2d: codcontacorrente (tesouraria→contas_bancarias), plccofre (cofre gerencial→plc) e
-- codplanocontas (contábil débito→plano_contas). Soft-delete via INATIVO (o legado não usa INDR aqui;
-- ATIVO/CODCONTABIL*/CFOP são colunas MORTAS no Oracle → descartadas). TEF/taxas/parcelamento/
-- condições-N:N = corte-2. Vínculos como soft-ref (sem FK) — igual ao Oracle (plccofre/codplanocontas)
-- e p/ não acoplar ao seed de contas_bancarias no corte-1.

CREATE SEQUENCE IF NOT EXISTS seq_formas_pgto_idpgto;
CREATE TABLE IF NOT EXISTS formas_pgto (
  idpgto                    integer PRIMARY KEY DEFAULT nextval('seq_formas_pgto_idpgto'),
  idempresa                 integer NOT NULL,                    -- tenant (empresaScoped)
  modalidade                varchar(30) NOT NULL,                -- nome da forma (único/empresa)
  atalho                    varchar(20) NOT NULL,                -- tecla no PDV (único/empresa)
  destino                   char(3),                             -- roteamento: CXA/RCB/CHQ/CHP/CRT/TEF/PIX/QUE/DEV/VTR
  plccofre                  integer,                             -- → plc.codplc (cofre gerencial) [soft-ref]
  codcontacorrente          integer,                             -- → contas_bancarias.codconta (tesouraria) [soft-ref]
  codplanocontas            integer,                             -- → plano_contas.codplanocontas (contábil débito) [soft-ref]
  recebe_pdv                char(1) DEFAULT 'S',                 -- aparece/recebe no PDV
  permite_sangria_pdv       char(1) DEFAULT 'N',
  lanc_movimento_individual char(1) DEFAULT 'N',                 -- tesouraria: 1 movimento por documento
  tipo                      char(1),                             -- E=entrega / N=devolução
  inativo                   char(1) DEFAULT 'N',                 -- soft-delete real do legado (INATIVO)
  data_inativo              timestamptz,
  usultalteracao            integer, dtultimalteracao timestamptz, dtcadastro timestamptz
);
ALTER SEQUENCE seq_formas_pgto_idpgto OWNED BY formas_pgto.idpgto;
-- MODALIDADE e ATALHO únicos POR EMPRESA (CK_IDEMPRESA_MODALIDADE / PGTO_IDEMPRESA_ATALHO), case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS ux_formas_pgto_modalidade ON formas_pgto (idempresa, upper(modalidade));
CREATE UNIQUE INDEX IF NOT EXISTS ux_formas_pgto_atalho     ON formas_pgto (idempresa, upper(atalho));
CREATE INDEX IF NOT EXISTS ix_formas_pgto_idempresa ON formas_pgto (idempresa);

-- Seed FIEL (empresa 1 = modalidades clássicas; empresa 2 = subset p/ teste multi-tenant). Refs
-- (plccofre/codcontacorrente/codplanocontas) = valores REAIS do Oracle (soft-ref; o corte-2d alinha
-- as contas contábeis). idpgto explícito 1..8; setval avança a sequence.
INSERT INTO formas_pgto (idpgto, idempresa, modalidade, atalho, destino, plccofre, codcontacorrente, codplanocontas, recebe_pdv, permite_sangria_pdv) VALUES
  (1, 1, 'DINHEIRO',         'D', 'CXA', 188,  21, 183, 'S', 'S'),
  (2, 1, 'CHEQUE',           'C', 'CHQ', 189,  23, 187, 'S', 'N'),
  (3, 1, 'CARTOES',          'K', 'TEF', 191,   1, 213, 'S', 'N'),
  (4, 1, 'CONVENIO',         'V', 'RCB',  96,  22, 211, 'S', 'N'),
  (5, 1, 'PIX',              'G', 'PIX', NULL, 221, 183, 'S', 'N'),
  (6, 1, 'QUEBRA DE CAIXA',  'Q', 'QUE', 2084, 21, NULL, 'N', 'N'),
  (7, 2, 'DINHEIRO',         'D', 'CXA', 188,  21, 183, 'S', 'S'),
  (8, 2, 'CARTOES',          'K', 'TEF', 191,   1, 213, 'S', 'N')
ON CONFLICT (idpgto) DO NOTHING;
SELECT setval('seq_formas_pgto_idpgto', (SELECT GREATEST(COALESCE(MAX(idpgto),1), 8) FROM formas_pgto));

-- View GET_FORMAS_PGTO — cadastro + nomes dos vínculos (LEFT JOIN, null-tolerante enquanto as contas
-- não existem no monorepo). Expõe idempresa (o engine empresaScoped filtra por ela).
CREATE OR REPLACE VIEW get_formas_pgto AS
SELECT
  f.idpgto, f.idempresa, f.modalidade, f.atalho, f.destino,
  f.plccofre, plc.descricao AS cofre,
  f.codcontacorrente, cb.titular AS conta_corrente,
  f.codplanocontas, pc.descricao AS conta_contabil,
  f.recebe_pdv, f.permite_sangria_pdv, f.lanc_movimento_individual, f.tipo,
  f.inativo, f.data_inativo
FROM formas_pgto f
LEFT JOIN plc              ON plc.codplc = f.plccofre
LEFT JOIN contas_bancarias cb ON cb.codconta = f.codcontacorrente
LEFT JOIN plano_contas     pc ON pc.codplanocontas = f.codplanocontas;

-- RBAC FRMCADFORMAPGTO (empresa 1 = smoke; 2 = teste de tenant do engine).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADFORMAPGTO', 'BTNGRAVAR',            7, 1),
  ('FRMCADFORMAPGTO', 'BTNEXCLUIR',           7, 1),
  ('FRMCADFORMAPGTO', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADFORMAPGTO', 'BTNEDITAR',            7, 1),
  ('FRMCADFORMAPGTO', 'BTNGRAVAR',            7, 2),
  ('FRMCADFORMAPGTO', 'BTNEXCLUIR',           7, 2);
